import {
  AtlasAgentReviewOutcome,
  AtlasArtifact,
  AtlasDependencyNotApprovedError,
  AtlasExecutionNotFinishedError,
  AtlasGitHubRepositoryError,
  AtlasImportPlanInput,
  AtlasInitiative,
  AtlasInitiativeBusyError,
  AtlasInitiativeNotFoundError,
  AtlasInitiativeId,
  AtlasIssuePublishError,
  AtlasPersistenceError,
  AtlasPlanAdjustment,
  AtlasPlanDraft,
  AtlasPlanImportError,
  AtlasPlanRevisionConflictError,
  AtlasPlanValidationError,
  AtlasProjectBusyError,
  AtlasProjectNotFoundError,
  AtlasProviderLaunchError,
  AtlasStartAgentReviewInput,
  AtlasStartPlanningInput,
  AtlasTask,
  AtlasTaskId,
  AtlasTaskNotFoundError,
  AtlasTaskNotRunnableError,
  AtlasTaskStatus,
  type AtlasAgentReview,
  type AtlasApplyPlanAdjustmentInput,
  type AtlasStartPlanAdjustmentInput,
  type AtlasCreateInitiativeInput,
  type AtlasDeleteInitiativeInput,
  type AtlasDeleteInitiativeResult,
  type AtlasExecuteTaskInput,
  type AtlasGetInitiativeInput,
  type AtlasListInitiativesInput,
  type AtlasListInitiativesResult,
  type AtlasPublishTaskIssueInput,
  type AtlasRefreshInitiativeInput,
  type AtlasRequestChangesInput,
  type AtlasLaunchAttempt,
  type AtlasRunOptions,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  type AtlasTaskExecution,
  type AtlasUpdateInitiativeInput,
  CommandId,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { delegatedTaskProgress } from "@t3tools/provider-core/server/subagentProjection";
import { parseGitHubRepositoryNameWithOwnerFromRemoteUrl } from "@t3tools/shared/git";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { ProjectionStoreThreadNotFoundError } from "../orchestration-v2/ProjectionStore.ts";
import * as AtlasStore from "./AtlasStore.ts";

const MAX_TASKS_PER_PLAN = 100;

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const isMissingProjection = Schema.is(ProjectionStoreThreadNotFoundError);
const decodePlan = Schema.decodeUnknownEffect(AtlasPlanDraft);
const decodeAdjustment = Schema.decodeUnknownEffect(AtlasPlanAdjustment);
const decodeAdjustmentSync = Schema.decodeUnknownSync(AtlasPlanAdjustment);
const isPlanValidationError = Schema.is(AtlasPlanValidationError);
const decodeReviewVerdict = Schema.decodeUnknownSync(
  Schema.Struct({ outcome: AtlasAgentReviewOutcome, feedback: Schema.String }),
);

const decodeArtifact = Schema.decodeUnknownOption(AtlasArtifact);

type PlannerStatus = AtlasInitiative["planner"]["status"];
type ReviewStatus = NonNullable<AtlasTask["agentReview"]>["status"];

interface LinkedRun {
  readonly status: "running" | "completed" | "failed" | "interrupted" | "cancelled";
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly result: string | null;
  readonly workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy | null;
}

const isTerminal = (status: string): boolean =>
  status === "completed" ||
  status === "failed" ||
  status === "interrupted" ||
  status === "cancelled" ||
  status === "rolled_back";

const mapRunStatus = (status: string): LinkedRun["status"] => {
  switch (status) {
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "cancelled":
    case "rolled_back":
      return "cancelled";
    default:
      return "running";
  }
};

const mapPlannerStatus = (status: LinkedRun["status"]): PlannerStatus =>
  status === "completed" ? "completed" : status === "running" ? "running" : "failed";

const mapReviewStatus = (status: LinkedRun["status"]): ReviewStatus =>
  status === "completed" ? "completed" : status === "running" ? "running" : "failed";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const formatPrompt = (sections: ReadonlyArray<string>): string =>
  sections.filter((section) => section.trim().length > 0).join("\n\n");

const parseJsonObject = (text: string): unknown => {
  const candidate = text.trim();
  const fenced = [...candidate.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].at(-1)?.[1]?.trim();
  const attempts = [fenced, candidate].filter((value): value is string => value !== undefined);
  const braces = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (braces !== -1 && lastBrace > braces) attempts.push(candidate.slice(braces, lastBrace + 1));

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("No JSON object was found in the model output.");
};

const MAX_ARTIFACTS = 24;
const ARTIFACT_BLOCK = /```atlas-artifacts[^\S\n]*\n([\s\S]*?)```/g;

// Artifact paths are opened relative to the task workspace, so anything that could escape it is dropped.
const normalizeArtifactPath = (path: string): string | null => {
  const normalized = path.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");
  if (normalized.length === 0 || /^(?:\/|~|[a-z]:)/i.test(normalized)) return null;
  return normalized.split("/").includes("..") ? null : normalized;
};

const isHttpUrl = (url: string): boolean => {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const toArtifact = (entry: unknown): AtlasArtifact | null => {
  const decoded = decodeArtifact(entry);
  if (Option.isNone(decoded)) return null;
  const { path, url, ...rest } = decoded.value;
  const safePath = path === undefined ? null : normalizeArtifactPath(path);
  const safeUrl = url !== undefined && isHttpUrl(url) ? url : null;
  if (rest.kind === "link" ? safeUrl === null : safePath === null) return null;
  return {
    ...rest,
    ...(safePath === null ? {} : { path: safePath }),
    ...(safeUrl === null ? {} : { url: safeUrl }),
  };
};

/**
 * Splits an implementation agent's final message into the artifacts it reported in its last
 * `atlas-artifacts` block and the remaining human-facing summary. Invalid entries are dropped
 * individually so one bad entry never hides the rest or fails the task.
 */
export const parseAtlasArtifacts = (
  result: string,
): { readonly artifacts: ReadonlyArray<AtlasArtifact>; readonly summary: string } => {
  const match = [...result.matchAll(ARTIFACT_BLOCK)].at(-1);
  if (match === undefined) return { artifacts: [], summary: result };
  const before = result.slice(0, match.index).trimEnd();
  const after = result.slice(match.index + match[0].length).trimStart();
  const summary =
    before.length === 0 || after.length === 0 ? before + after : `${before}\n\n${after}`;

  let entries: unknown;
  try {
    entries = JSON.parse(match[1]!);
  } catch {
    return { artifacts: [], summary };
  }
  if (!Array.isArray(entries)) return { artifacts: [], summary };

  const seen = new Set<string>();
  const artifacts: AtlasArtifact[] = [];
  for (const entry of entries) {
    const artifact = toArtifact(entry);
    if (artifact === null) continue;
    const key = `${artifact.path ?? ""}\u0000${artifact.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    artifacts.push(artifact);
    if (artifacts.length === MAX_ARTIFACTS) break;
  }
  return { artifacts, summary };
};

const validatePlan = (plan: AtlasPlanDraft): AtlasPlanDraft => {
  if (plan.tasks.length > MAX_TASKS_PER_PLAN) {
    throw new AtlasPlanValidationError({
      reason: `A plan may contain at most ${MAX_TASKS_PER_PLAN} tasks.`,
    });
  }

  const keys = new Set<string>();
  for (const task of plan.tasks) {
    if (keys.has(task.key)) {
      throw new AtlasPlanValidationError({ reason: `Duplicate task key "${task.key}".` });
    }
    keys.add(task.key);
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      throw new AtlasPlanValidationError({
        reason: `Task "${task.key}" lists the same dependency more than once.`,
      });
    }
    for (const dependency of task.dependsOn) {
      if (dependency === task.key) {
        throw new AtlasPlanValidationError({ reason: `Task "${task.key}" depends on itself.` });
      }
      if (!keys.has(dependency) && !plan.tasks.some((candidate) => candidate.key === dependency)) {
        throw new AtlasPlanValidationError({
          reason: `Task "${task.key}" depends on unknown task "${dependency}".`,
        });
      }
    }
  }

  assertAcyclic(new Map(plan.tasks.map((task) => [task.key, task.dependsOn])));
  return plan;
};

const assertAcyclic = (dependencies: ReadonlyMap<string, ReadonlyArray<string>>) => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new AtlasPlanValidationError({ reason: `Dependencies form a cycle at "${key}".` });
    }
    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of dependencies.keys()) visit(key);
};

// Anything that has launched, run, or been reviewed carries history the user relies on, so
// adjustments may only add follow-ups around it. Publication alone does not freeze a task.
const isStartedTask = (task: AtlasTask): boolean =>
  task.status !== "proposed" ||
  task.execution !== null ||
  task.agentReview !== null ||
  task.launch !== null;

const applyAdjustment = (
  tasks: ReadonlyArray<AtlasTask>,
  adjustment: AtlasPlanAdjustment,
  newIds: ReadonlyArray<AtlasTaskId>,
  now: string,
): ReadonlyArray<AtlasTask> => {
  const reject = (reason: string) => new AtlasPlanValidationError({ reason });
  const byId = new Map(tasks.map((task) => [task.id as string, task]));
  const requireUnstarted = (taskId: string, action: string) => {
    const task = byId.get(taskId);
    if (task === undefined) throw reject(`Cannot ${action} unknown task "${taskId}".`);
    if (isStartedTask(task)) {
      throw reject(
        `Task "${task.title}" has already started; add a follow-up task instead of trying to ${action} it.`,
      );
    }
    return task;
  };

  const removed = new Set<string>();
  for (const taskId of adjustment.removals) {
    if (removed.has(taskId)) throw reject(`Task "${taskId}" is removed more than once.`);
    const task = requireUnstarted(taskId, "remove");
    // Removing would orphan the GitHub issue, which Atlas cannot close on the user's behalf.
    if (task.issue !== null) {
      throw reject(
        `Task "${task.title}" is published as issue #${task.issue.number}; edit it instead of removing it.`,
      );
    }
    removed.add(taskId);
  }

  const updates = new Map<string, AtlasPlanAdjustment["updates"][number]>();
  for (const update of adjustment.updates) {
    if (updates.has(update.taskId)) throw reject(`Task "${update.taskId}" is updated twice.`);
    if (removed.has(update.taskId)) {
      throw reject(`Task "${update.taskId}" cannot be both updated and removed.`);
    }
    requireUnstarted(update.taskId, "edit");
    updates.set(update.taskId, update);
  }

  const idByKey = new Map<string, AtlasTaskId>();
  adjustment.additions.forEach((addition, index) => {
    if (idByKey.has(addition.key)) throw reject(`Duplicate new task key "${addition.key}".`);
    if (byId.has(addition.key)) {
      throw reject(`New task key "${addition.key}" collides with an existing task id.`);
    }
    idByKey.set(addition.key, newIds[index]!);
  });

  const resolve = (owner: string, reference: string): AtlasTaskId => {
    const added = idByKey.get(reference);
    if (added !== undefined) return added;
    if (removed.has(reference)) {
      throw reject(`Task "${owner}" still depends on removed task "${reference}".`);
    }
    const existing = byId.get(reference);
    if (existing === undefined) {
      throw reject(`Task "${owner}" depends on unknown task "${reference}".`);
    }
    return existing.id;
  };

  const kept = tasks
    .filter((task) => !removed.has(task.id))
    .map((task): AtlasTask => {
      const update = updates.get(task.id);
      if (update === undefined) return task;
      return {
        ...task,
        title: update.title ?? task.title,
        description: update.description ?? task.description,
        specialty: update.specialty ?? task.specialty,
        deliverable: update.deliverable ?? task.deliverable,
        acceptanceCriteria: update.acceptanceCriteria ?? task.acceptanceCriteria,
        dependsOn:
          update.dependsOn?.map((reference) => resolve(task.title, reference)) ?? task.dependsOn,
        issue: task.issue === null ? null : { ...task.issue, needsSync: true },
        updatedAt: now,
      };
    });

  const nextOrdinal = tasks.reduce((max, task) => Math.max(max, task.ordinal + 1), 0);
  const added = adjustment.additions.map((addition, index): AtlasTask => ({
    id: idByKey.get(addition.key)!,
    ordinal: nextOrdinal + index,
    title: addition.title,
    description: addition.description,
    specialty: addition.specialty,
    deliverable: addition.deliverable ?? null,
    acceptanceCriteria: addition.acceptanceCriteria,
    dependsOn: addition.dependsOn.map((reference) => resolve(addition.key, reference)),
    blockedBy: [],
    status: "proposed",
    issue: null,
    execution: null,
    agentReview: null,
    humanDecision: { outcome: "pending", feedback: null, decidedAt: null },
    launch: null,
    createdAt: now,
    updatedAt: now,
  }));

  const next = [...kept, ...added];
  if (next.length === 0) throw reject("An adjustment cannot remove every task.");
  if (next.length > MAX_TASKS_PER_PLAN) {
    throw reject(`A plan may contain at most ${MAX_TASKS_PER_PLAN} tasks.`);
  }
  const finalIds = new Set(next.map((task) => task.id as string));
  for (const task of next) {
    const dangling = task.dependsOn.find((dependency) => !finalIds.has(dependency));
    if (dangling !== undefined) {
      throw reject(
        removed.has(dangling)
          ? `Task "${task.title}" still depends on removed task "${dangling}".`
          : `Task "${task.title}" depends on unknown task "${dangling}".`,
      );
    }
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      throw reject(`Task "${task.title}" lists the same dependency more than once.`);
    }
    if (task.dependsOn.includes(task.id)) throw reject(`Task "${task.title}" depends on itself.`);
  }
  assertAcyclic(new Map(next.map((task) => [task.id as string, task.dependsOn])));
  return next;
};

const toValidationError = (cause: unknown) =>
  isPlanValidationError(cause)
    ? cause
    : new AtlasPlanValidationError({ reason: String(cause).slice(0, 2_000) });

const runOptions = (input: AtlasRunOptions) => ({
  modelSelection: input.modelSelection,
  runtimeMode: input.runtimeMode,
  interactionMode: input.interactionMode,
  workspaceStrategy: input.workspaceStrategy ?? { type: "root" as const },
});

const computeTaskStatus = (task: AtlasTask): AtlasTaskStatus => {
  if (task.humanDecision.outcome === "approved") return "approved";
  if (task.humanDecision.outcome === "changes_requested") return "changes_requested";
  const execution = task.execution?.status;
  if (execution === "running") return "running";
  if (execution === "completed") return "needs_review";
  if (execution !== undefined) return "failed";
  return task.status;
};

const computeInitiativeStatus = (initiative: AtlasInitiative): AtlasInitiative["status"] => {
  if (initiative.tasks.length === 0) {
    if (initiative.planner.status === "running") return "planning";
    if (initiative.planner.status === "completed") return "plan_ready";
    return "draft";
  }
  if (initiative.tasks.every((task) => task.status === "approved")) return "completed";
  if (initiative.tasks.some((task) => task.status !== "proposed")) return "in_progress";
  return "plan_ready";
};

const blockedByFor = (
  task: AtlasTask,
  tasks: ReadonlyArray<AtlasTask>,
): ReadonlyArray<AtlasTaskId> =>
  task.dependsOn.filter((dependencyId) => {
    const dependency = tasks.find((candidate) => candidate.id === dependencyId);
    return dependency === undefined || dependency.status !== "approved";
  });

const withComputedView = (initiative: AtlasInitiative): AtlasInitiative => {
  const tasks = initiative.tasks.map((task) => ({
    ...task,
    blockedBy: blockedByFor(task, initiative.tasks),
  }));
  const next = { ...initiative, tasks };
  return { ...next, status: computeInitiativeStatus(next) };
};

const DELIVERABLE_GUIDANCE = `Every task must have a deliverable: one sentence naming the concrete thing a human will open to review it. Prefer something viewable: a markdown doc in the repo, a screenshot image, an HTML preview page, or a test report. Use "code change" only when the diff is genuinely all there is to review.`;

const PLANNER_FORMAT = `Return ONLY a final JSON object with this exact shape (no markdown prose around it):
{
  "summary": "short plan summary",
  "tasks": [
    {
      "key": "stable-local-key",
      "title": "task title",
      "description": "implementation details",
      "specialty": "frontend | backend | tests | docs | ...",
      "deliverable": "one sentence naming what a reviewer will open, e.g. a doc path or screenshot",
      "acceptanceCriteria": ["observable criterion"],
      "dependsOn": ["another-local-key"]
    }
  ]
}
Keys must be unique. dependsOn may only reference keys in this plan and must be acyclic.
Every task must have at least one acceptance criterion.
${DELIVERABLE_GUIDANCE}`;

// Each dependency serializes work, so the planner is pushed toward a wide DAG instead of a chain.
const DEPENDENCY_GUIDANCE = `Dependencies:
- Add a dependency only when a task cannot start without an artifact another task produces (a file, schema, API, or asset it must read or build on). Sequencing preference, topic similarity, or "it would be nicer first" is not a dependency.
- Split work by specialty (for example backend, frontend, assets, tests, docs) so separate agents can run in parallel.
- When several tasks need a shared interface, make one small early task that fixes that contract (types, schema, API shape, file layout) and let the specialty tasks depend only on it.
- Do not chain every task after the previous one. Most tasks should be runnable in parallel once their real prerequisites are approved.
- Keep each task independently reviewable against its acceptance criteria.`;

const plannerPrompt = (initiative: AtlasInitiative): string =>
  formatPrompt([
    "You are the Atlas planning agent. Turn this initiative into an executable task plan.",
    `Project id: ${initiative.projectId}`,
    `Initiative: ${initiative.title}`,
    `Brief:\n${initiative.brief}`,
    initiative.deliverables.length === 0
      ? ""
      : `Deliverables:\n${initiative.deliverables.map((item) => `- ${item}`).join("\n")}`,
    "Decompose the work into small, reviewable tasks.",
    DEPENDENCY_GUIDANCE,
    "Do not edit files, create commits, or run mutating commands. Produce a plan only.",
    PLANNER_FORMAT,
  ]);

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit)}\n…(truncated)`;

const ADJUSTMENT_FORMAT = `Return ONLY a final JSON object with this exact shape (no markdown prose around it):
{
  "summary": "what changes and why",
  "updates": [
    {
      "taskId": "existing NOT-STARTED task id",
      "title": "optional new title",
      "description": "optional new description",
      "specialty": "optional new specialty",
      "deliverable": "optional new deliverable",
      "acceptanceCriteria": ["optional replacement criteria"],
      "dependsOn": ["optional replacement list of task ids or new task keys"]
    }
  ],
  "additions": [
    {
      "key": "new-local-key",
      "title": "task title",
      "description": "implementation details",
      "specialty": "frontend | backend | tests | docs | ...",
      "deliverable": "what a reviewer will look at",
      "acceptanceCriteria": ["observable criterion"],
      "dependsOn": ["existing task id or another new key"]
    }
  ],
  "removals": ["existing NOT-STARTED task id"]
}
Omit fields you do not change. Leave arrays empty when there is nothing to do. Dependencies must stay acyclic.
${DELIVERABLE_GUIDANCE} When updating a task without a deliverable, add one.`;

const adjustmentTaskSummary = (task: AtlasTask): string =>
  [
    `### ${task.id} — ${task.title}`,
    `State: ${
      isStartedTask(task)
        ? `STARTED (${task.status}), read-only`
        : task.issue !== null
          ? `not started, editable but NOT removable (published as issue #${task.issue.number}${task.issue.needsSync === true ? ", issue out of date" : ""})`
          : "not started, editable"
    }`,
    `Exact taskId for JSON: ${JSON.stringify(task.id)} (include the atlas-task: prefix)`,
    `Specialty: ${task.specialty}`,
    `Deliverable: ${task.deliverable ?? "(none)"}`,
    `Depends on: ${task.dependsOn.length === 0 ? "(none)" : task.dependsOn.join(", ")}`,
    `Description:\n${truncate(task.description, 2_000)}`,
    `Acceptance criteria:\n${task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
    task.execution?.result == null
      ? ""
      : `Latest implementation result:\n${truncate(task.execution.result, 3_000)}`,
    task.humanDecision.feedback === null
      ? ""
      : `Reviewer feedback (${task.humanDecision.outcome}):\n${truncate(task.humanDecision.feedback, 2_000)}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");

const adjustmentPrompt = (initiative: AtlasInitiative, instructions: string): string =>
  formatPrompt([
    "You are the Atlas planning agent. Propose an incremental adjustment to an existing task plan. A human will preview and apply your patch; you do not replace the plan.",
    `Project id: ${initiative.projectId}`,
    `Initiative: ${initiative.title}`,
    `Brief:\n${initiative.brief}`,
    initiative.planSummary === null ? "" : `Current plan summary:\n${initiative.planSummary}`,
    `Requested change:\n${instructions}`,
    `Current tasks:\n\n${initiative.tasks.map(adjustmentTaskSummary).join("\n\n")}`,
    "Rules:\n- STARTED tasks are history: never update or remove them. If their outcome needs more work, add a follow-up task that depends on them.\n- Only update or remove tasks that have not started.\n- A not-started task published as a GitHub issue may be updated, but never removed; the user will sync its issue explicitly after applying.\n- Reuse existing task ids exactly as written above. Keep the patch minimal and do not rewrite tasks that do not need to change.\n- Base decisions on the recorded results and feedback, and inspect the workspace if needed.",
    DEPENDENCY_GUIDANCE,
    "Do not edit files, create commits, or run mutating commands. Produce a patch only.",
    ADJUSTMENT_FORMAT,
  ]);

const ARTIFACT_INSTRUCTIONS = `Produce the deliverable as real files in the workspace where it makes sense (docs as .md, screenshots as .png, previews as .html). End your final message with a fenced block listing them as a JSON array. kind is one of document, image, html, link, file; path is workspace-relative and required except for link, which needs an http(s) url instead; description is optional:
\`\`\`atlas-artifacts
[{"kind":"document","title":"Auth flow","path":"docs/auth-flow.md","description":"Sequence and edge cases"},{"kind":"link","title":"Preview","url":"https://example.com/preview"}]
\`\`\`
Do not list code changes; Atlas shows the diff automatically. Use [] when there is nothing else to show.`;

const formatArtifacts = (artifacts: ReadonlyArray<AtlasArtifact>): string =>
  artifacts
    .map(
      (artifact) =>
        `- [${artifact.kind}] ${artifact.title}: ${artifact.path ?? artifact.url}${
          artifact.description === undefined ? "" : ` (${artifact.description})`
        }`,
    )
    .join("\n");

const taskPrompt = (
  initiative: AtlasInitiative,
  task: AtlasTask,
  dependencies: ReadonlyArray<AtlasTask>,
): string =>
  formatPrompt([
    "You are the Atlas implementation agent for one task in a larger initiative.",
    `Initiative: ${initiative.title}\n${initiative.brief}`,
    `Task: ${task.title}\n${task.description}`,
    `Specialty: ${task.specialty}`,
    task.deliverable === null ? "" : `Deliverable:\n${task.deliverable}`,
    `Acceptance criteria:\n${task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
    dependencies.length === 0
      ? ""
      : `Completed dependencies:\n${dependencies
          .map(
            (dependency) =>
              `- ${dependency.title}\n${dependency.execution?.result ?? "(no result recorded)"}`,
          )
          .join("\n")}`,
    task.execution?.result === null || task.execution?.result === undefined
      ? ""
      : `Your previous implementation result:\n${task.execution.result}`,
    task.humanDecision.outcome === "changes_requested" && task.humanDecision.feedback !== null
      ? `A human requested these changes:\n${task.humanDecision.feedback}\nAddress every point in this retry.`
      : "",
    "Implement the task in this project. Run the relevant checks. Finish with a concise summary of what changed and how you verified it. Do not claim checks you did not run.",
    ARTIFACT_INSTRUCTIONS,
  ]);

const reviewPrompt = (initiative: AtlasInitiative, task: AtlasTask): string =>
  formatPrompt([
    "You are the Atlas review agent. Review the implementation against its acceptance criteria.",
    `Initiative: ${initiative.title}\n${initiative.brief}`,
    `Task: ${task.title}\n${task.description}`,
    task.deliverable === null ? "" : `Deliverable:\n${task.deliverable}`,
    `Acceptance criteria:\n${task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
    `Implementation result:\n${task.execution?.result ?? "(no result recorded)"}`,
    `Reported artifacts (paths are relative to the workspace):\n${
      task.execution === null || task.execution.artifacts.length === 0
        ? "(none reported)"
        : formatArtifacts(task.execution.artifacts)
    }`,
    "Open and inspect the deliverable and every reported artifact, and inspect the workspace when needed. Do not edit files, create commits, or run mutating commands. Review only.",
    "Be strict about unmet criteria. A missing or unviewable deliverable is an unmet criterion.",
    `Finish with ONLY a final JSON object: {"outcome":"approved"|"changes_requested","feedback":"specific feedback"}`,
  ]);

const issueMarker = (taskId: AtlasTaskId): string => `Atlas task marker: ${taskId}`;

const issueBody = (initiative: AtlasInitiative, task: AtlasTask): string =>
  [
    `Part of Atlas initiative: ${initiative.title}`,
    "",
    "## Brief",
    initiative.brief,
    "",
    "## Task",
    task.description,
    "",
    "## Specialty",
    task.specialty,
    "",
    ...(task.deliverable === null ? [] : ["## Deliverable", task.deliverable, ""]),
    "## Acceptance criteria",
    ...task.acceptanceCriteria.map((criterion) => `- [ ] ${criterion}`),
    ...(task.dependsOn.length === 0
      ? []
      : [
          "",
          "## Depends on",
          ...task.dependsOn.map((dependencyId) => {
            const dependency = initiative.tasks.find((candidate) => candidate.id === dependencyId);
            return `- ${dependency?.title ?? dependencyId}`;
          }),
        ]),
    ...(task.execution?.result === null || task.execution?.result === undefined
      ? []
      : ["", "## Latest implementation result", task.execution.result]),
    "",
    issueMarker(task.id),
  ].join("\n");

export class AtlasService extends Context.Service<
  AtlasService,
  {
    readonly listInitiatives: (
      input: AtlasListInitiativesInput,
    ) => Effect.Effect<AtlasListInitiativesResult, AtlasPersistenceError>;
    readonly getInitiative: (
      input: AtlasGetInitiativeInput,
    ) => Effect.Effect<AtlasInitiative, AtlasInitiativeNotFoundError | AtlasPersistenceError>;
    readonly createInitiative: (
      input: AtlasCreateInitiativeInput,
    ) => Effect.Effect<AtlasInitiative, AtlasProjectNotFoundError | AtlasPersistenceError>;
    readonly updateInitiative: (
      input: AtlasUpdateInitiativeInput,
    ) => Effect.Effect<AtlasInitiative, AtlasInitiativeNotFoundError | AtlasPersistenceError>;
    readonly deleteInitiative: (
      input: AtlasDeleteInitiativeInput,
    ) => Effect.Effect<
      AtlasDeleteInitiativeResult,
      AtlasInitiativeNotFoundError | AtlasInitiativeBusyError | AtlasPersistenceError
    >;
    readonly startPlanning: (
      input: AtlasStartPlanningInput,
    ) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasProjectNotFoundError
      | AtlasPersistenceError
      | AtlasProviderLaunchError
    >;
    readonly importPlan: (
      input: AtlasImportPlanInput,
    ) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasPersistenceError
      | AtlasPlanImportError
      | AtlasPlanValidationError
      | AtlasExecutionNotFinishedError
    >;
    readonly startPlanAdjustment: (
      input: AtlasStartPlanAdjustmentInput,
    ) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasProjectNotFoundError
      | AtlasPlanValidationError
      | AtlasPersistenceError
      | AtlasProviderLaunchError
    >;
    readonly applyPlanAdjustment: (
      input: AtlasApplyPlanAdjustmentInput,
    ) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasPersistenceError
      | AtlasPlanImportError
      | AtlasPlanValidationError
      | AtlasPlanRevisionConflictError
      | AtlasExecutionNotFinishedError
    >;
    readonly refreshInitiative: (
      input: AtlasRefreshInitiativeInput,
    ) => Effect.Effect<AtlasInitiative, AtlasInitiativeNotFoundError | AtlasPersistenceError>;
    readonly executeTask: (
      input: AtlasExecuteTaskInput,
    ) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasTaskNotFoundError
      | AtlasProjectNotFoundError
      | AtlasDependencyNotApprovedError
      | AtlasTaskNotRunnableError
      | AtlasProjectBusyError
      | AtlasPersistenceError
      | AtlasProviderLaunchError
    >;
    readonly approveTask: (input: {
      readonly initiativeId: AtlasInitiative["id"];
      readonly taskId: AtlasTaskId;
      readonly feedback?: string | undefined;
    }) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasTaskNotFoundError
      | AtlasTaskNotRunnableError
      | AtlasExecutionNotFinishedError
      | AtlasPersistenceError
    >;
    readonly requestChanges: (
      input: AtlasRequestChangesInput,
    ) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasTaskNotFoundError
      | AtlasTaskNotRunnableError
      | AtlasExecutionNotFinishedError
      | AtlasPersistenceError
    >;
    readonly startAgentReview: (
      input: AtlasStartAgentReviewInput,
    ) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasTaskNotFoundError
      | AtlasProjectNotFoundError
      | AtlasTaskNotRunnableError
      | AtlasExecutionNotFinishedError
      | AtlasPersistenceError
      | AtlasProviderLaunchError
    >;
    readonly publishTaskIssue: (
      input: AtlasPublishTaskIssueInput,
    ) => Effect.Effect<
      AtlasInitiative,
      | AtlasInitiativeNotFoundError
      | AtlasTaskNotFoundError
      | AtlasProjectNotFoundError
      | AtlasGitHubRepositoryError
      | AtlasIssuePublishError
      | AtlasPersistenceError
    >;
  }
>()("t3/atlas/AtlasService") {}

const make = Effect.gen(function* () {
  const store = yield* AtlasStore.AtlasStore;
  const projects = yield* ProjectService.ProjectService;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const crypto = yield* Crypto.Crypto;
  const path = yield* Path.Path;
  const initiativeLocks = yield* KeyedLock.make<AtlasInitiative["id"]>();
  const projectExecutionLocks = yield* KeyedLock.make<ProjectId>();

  const load = (initiativeId: AtlasInitiative["id"]) =>
    store
      .get(initiativeId)
      .pipe(
        Effect.flatMap((initiative) =>
          Option.isNone(initiative)
            ? Effect.fail(new AtlasInitiativeNotFoundError({ initiativeId }))
            : Effect.succeed(initiative.value),
        ),
      );

  const requireProject = (projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      Effect.mapError((cause) => new AtlasPersistenceError({ operation: "get", cause })),
      Effect.flatMap((project) =>
        Option.isNone(project)
          ? Effect.fail(new AtlasProjectNotFoundError({ projectId }))
          : Effect.succeed(project.value),
      ),
    );

  const randomId = (prefix: string) =>
    crypto.randomUUIDv4().pipe(
      Effect.orDie,
      Effect.map((id) => `${prefix}:${id}`),
    );

  const makeLaunchAttempt = (
    operation: AtlasLaunchAttempt["operation"],
  ): Effect.Effect<AtlasLaunchAttempt, never> =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      return {
        operation,
        commandId: CommandId.make(yield* randomId(`atlas-${operation}`)),
        messageId: MessageId.make(yield* randomId(`atlas-${operation}-message`)),
        createdAt: now,
      };
    });

  const resolvedWorkspace = (thread: {
    readonly worktreePath: string | null;
    readonly branch: string | null;
  }): OrchestrationV2ThreadLaunchWorkspaceStrategy =>
    thread.worktreePath === null
      ? { type: "root" }
      : {
          type: "existing_worktree",
          worktreePath: thread.worktreePath,
          ...(thread.branch === null ? {} : { branch: thread.branch }),
        };

  const launch = (
    operation: AtlasProviderLaunchError["operation"],
    initiative: AtlasInitiative,
    title: string,
    text: string,
    options: AtlasRunOptions,
    attempt: AtlasLaunchAttempt,
  ) =>
    Effect.gen(function* () {
      const result = yield* threadLaunch
        .launch({
          commandId: attempt.commandId,
          projectId: initiative.projectId,
          title,
          ...runOptions(options),
          initialMessage: { messageId: attempt.messageId, text, attachments: [] },
          createdBy: "user",
          creationSource: "server",
        })
        .pipe(Effect.mapError((cause) => new AtlasProviderLaunchError({ operation, cause })));
      const run = result.projection.runs.toSorted((a, b) => b.ordinal - a.ordinal)[0];
      if (run === undefined) {
        return yield* Effect.fail(
          new AtlasProviderLaunchError({
            operation,
            cause: new Error("The launched thread has no run."),
          }),
        );
      }
      const currentProjection = yield* threadManagement.getThreadProjection(result.threadId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Atlas could not re-read the launched thread", {
            threadId: result.threadId,
            cause,
          }).pipe(Effect.as(result.projection)),
        ),
      );
      return {
        threadId: result.threadId,
        runId: run.id,
        startedAt: DateTime.formatIso(run.startedAt ?? run.requestedAt),
        workspaceStrategy:
          currentProjection.thread.worktreePath === null &&
          options.workspaceStrategy?.type === "worktree"
            ? options.workspaceStrategy
            : resolvedWorkspace(currentProjection.thread),
      };
    });

  const missingRun = (threadId: ThreadId, now: string): LinkedRun => ({
    status: "failed",
    startedAt: now,
    finishedAt: now,
    result: `The linked thread ${threadId} is missing or inaccessible.`,
    workspaceStrategy: null,
  });

  const readRun = (threadId: ThreadId, runId: RunId): Effect.Effect<LinkedRun | null, never> =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      const loaded = yield* threadManagement.getThreadProjection(threadId).pipe(
        Effect.map((projection) => ({ type: "ok" as const, projection })),
        Effect.catchTags({
          OrchestratorProjectionError: (error) =>
            isMissingProjection(error.cause)
              ? Effect.succeed({ type: "missing" as const })
              : Effect.logWarning("Atlas could not load a linked projection", {
                  threadId,
                  error,
                }).pipe(Effect.as({ type: "unavailable" as const })),
        }),
        Effect.catchCause((cause) =>
          Effect.logWarning("Atlas could not read a linked thread", { threadId, cause }).pipe(
            Effect.as({ type: "unavailable" as const }),
          ),
        ),
      );
      if (loaded.type === "unavailable") return null;
      if (loaded.type === "missing") return missingRun(threadId, now);
      const projection = loaded.projection;
      const originalRun = projection.runs.find((candidate) => candidate.id === runId);
      if (originalRun === undefined) return missingRun(threadId, now);
      // A turn can finish while its children are still working or owe a parent wake.
      // Use the same completion rule as delegated tasks before exposing reviewable work.
      const progress = delegatedTaskProgress({
        ...projection,
        runs: projection.runs.filter((run) => run.ordinal >= originalRun.ordinal),
      });
      const run = progress.resultRun ?? originalRun;
      const result =
        projection.messages.findLast(
          (message) =>
            message.runId === run.id &&
            message.role === "assistant" &&
            message.text.trim().length > 0,
        )?.text ?? null;
      return {
        status: progress.state === "result_available" ? mapRunStatus(run.status) : "running",
        startedAt: DateTime.formatIso(originalRun.startedAt ?? originalRun.requestedAt),
        finishedAt:
          progress.state !== "result_available" || run.completedAt === null
            ? null
            : DateTime.formatIso(run.completedAt),
        result,
        workspaceStrategy: resolvedWorkspace(projection.thread),
      };
    });

  const syncExecution = (
    execution: AtlasTaskExecution | null,
  ): Effect.Effect<AtlasTaskExecution | null, never> =>
    execution === null
      ? Effect.succeed(null)
      : readRun(execution.threadId, execution.runId).pipe(
          Effect.map((run) => {
            if (run === null) return execution;
            const parsed = run.result === null ? null : parseAtlasArtifacts(run.result);
            return {
              ...execution,
              status: run.status,
              startedAt: run.startedAt,
              finishedAt: isTerminal(run.status) ? run.finishedAt : null,
              result: parsed === null || parsed.summary.length === 0 ? null : parsed.summary,
              artifacts: parsed?.artifacts ?? [],
              workspaceStrategy:
                run.status === "running" &&
                run.workspaceStrategy?.type === "root" &&
                execution.workspaceStrategy?.type === "worktree"
                  ? execution.workspaceStrategy
                  : (run.workspaceStrategy ?? execution.workspaceStrategy),
            };
          }),
        );

  const syncAgentReview = (
    review: AtlasAgentReview | null,
  ): Effect.Effect<AtlasAgentReview | null, never> =>
    review === null
      ? Effect.succeed(null)
      : readRun(review.threadId, review.runId).pipe(
          Effect.map((run) => {
            if (run === null) return review;
            const verdict =
              run.status === "completed" && run.result !== null
                ? (() => {
                    try {
                      const parsed = decodeReviewVerdict(parseJsonObject(run.result));
                      return parsed;
                    } catch {
                      return null;
                    }
                  })()
                : null;
            return {
              ...review,
              status: mapReviewStatus(run.status),
              startedAt: run.startedAt,
              finishedAt: isTerminal(run.status) ? run.finishedAt : null,
              result: run.result,
              outcome: verdict?.outcome ?? null,
              feedback: verdict?.feedback ?? null,
            };
          }),
        );

  const syncInitiative = (
    initiative: AtlasInitiative,
  ): Effect.Effect<AtlasInitiative, AtlasPersistenceError> =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      const plannerRun =
        initiative.planner.threadId === null || initiative.planner.runId === null
          ? null
          : yield* readRun(initiative.planner.threadId, initiative.planner.runId);
      const planner =
        plannerRun === null ? initiative.planner : syncPlanner(initiative, plannerRun, now);

      const tasks = yield* Effect.forEach(
        initiative.tasks,
        (task) =>
          Effect.gen(function* () {
            const execution = yield* syncExecution(task.execution);
            const agentReview = yield* syncAgentReview(task.agentReview);
            const humanDecision =
              agentReview?.status === "completed" &&
              agentReview.autoApplyVerdict &&
              agentReview.outcome !== null &&
              task.humanDecision.outcome === "pending"
                ? {
                    outcome:
                      agentReview.outcome === "approved"
                        ? ("approved" as const)
                        : ("changes_requested" as const),
                    feedback: agentReview.feedback,
                    decidedAt: now,
                    decidedBy: "agent" as const,
                  }
                : task.humanDecision;
            const next = { ...task, execution, agentReview, humanDecision };
            return { ...next, status: computeTaskStatus(next) };
          }),
        { concurrency: 4 },
      );

      const next = withComputedView({ ...initiative, planner, tasks, updatedAt: now });
      yield* store.save(next);
      return next;
    });

  const runOptionsFor = (input: AtlasRunOptions) => input;

  const syncPlanner = (
    initiative: AtlasInitiative,
    run: LinkedRun,
    now: string,
  ): AtlasInitiative["planner"] => {
    const status = mapPlannerStatus(run.status);
    const base = { ...initiative.planner, status };
    if (run.status === "failed") {
      return { ...base, error: run.result ?? "The planning run failed.", adjustment: null };
    }
    if (status !== "completed" || initiative.planner.mode !== "adjust") {
      return { ...base, error: null };
    }
    if (initiative.planner.adjustment !== null) return { ...base, error: null };
    // The run's output stays readable after its proposal was applied or overtaken by another
    // plan change, so only a run based on the current revision may produce a proposal.
    if (initiative.planner.baseRevision !== initiative.planRevision) {
      return { ...base, error: null, adjustment: null };
    }
    if (run.result === null) {
      return { ...base, error: "The planner produced no assistant output." };
    }
    try {
      const adjustment = decodeAdjustmentSync(parseJsonObject(run.result));
      // Dry-run against the current tasks so an unusable patch surfaces before preview.
      applyAdjustment(
        initiative.tasks,
        adjustment,
        adjustment.additions.map((addition) => AtlasTaskId.make(`preview:${addition.key}`)),
        now,
      );
      return { ...base, error: null, adjustment };
    } catch (cause) {
      return {
        ...base,
        error: isPlanValidationError(cause)
          ? cause.reason
          : "The planner output did not contain a valid plan adjustment.",
      };
    }
  };

  const listInitiatives: AtlasService["Service"]["listInitiatives"] = (input) =>
    store.list(input.projectId).pipe(
      Effect.map((initiatives) => ({
        initiatives: initiatives.map(withComputedView),
      })),
    );

  const getInitiative: AtlasService["Service"]["getInitiative"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      load(input.initiativeId).pipe(Effect.map(withComputedView)),
    );

  const createInitiative: AtlasService["Service"]["createInitiative"] = (input) =>
    Effect.gen(function* () {
      yield* requireProject(input.projectId);
      const now = yield* nowIso;
      const initiative: AtlasInitiative = {
        id: AtlasInitiativeId.make(yield* randomId("atlas-initiative")),
        projectId: input.projectId,
        title: input.title,
        brief: input.brief,
        deliverables: input.deliverables,
        status: "draft",
        planSummary: null,
        planRevision: 0,
        planner: {
          status: "idle",
          threadId: null,
          runId: null,
          error: null,
          launch: null,
          mode: "plan",
          baseRevision: null,
          instructions: null,
          adjustment: null,
        },
        autoReview: null,
        tasks: [],
        createdAt: now,
        updatedAt: now,
      };
      yield* store.save(initiative);
      return withComputedView(initiative);
    });

  const updateInitiative: AtlasService["Service"]["updateInitiative"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const initiative = yield* load(input.initiativeId);
        const now = yield* nowIso;
        const next = withComputedView({
          ...initiative,
          title: input.title ?? initiative.title,
          brief: input.brief ?? initiative.brief,
          deliverables: input.deliverables ?? initiative.deliverables,
          autoReview: input.autoReview === undefined ? initiative.autoReview : input.autoReview,
          updatedAt: now,
        });
        yield* store.save(next);
        return next;
      }),
    );

  const deleteInitiative: AtlasService["Service"]["deleteInitiative"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const current = yield* load(input.initiativeId);
        const initiative = yield* syncInitiative(current);
        const active =
          initiative.planner.status === "running"
            ? ("planner" as const)
            : initiative.tasks.some((task) => task.execution?.status === "running")
              ? ("task" as const)
              : initiative.tasks.some((task) => task.agentReview?.status === "running")
                ? ("review" as const)
                : null;
        if (active !== null) {
          return yield* Effect.fail(
            new AtlasInitiativeBusyError({ initiativeId: input.initiativeId, active }),
          );
        }
        const removed = yield* store.remove(input.initiativeId);
        if (!removed) {
          return yield* Effect.fail(
            new AtlasInitiativeNotFoundError({ initiativeId: input.initiativeId }),
          );
        }
        return { deleted: true as const };
      }),
    );

  const launchPlanner = (
    initiative: AtlasInitiative,
    options: AtlasRunOptions,
    request: Pick<AtlasInitiative["planner"], "mode" | "baseRevision" | "instructions">,
    title: string,
    prompt: string,
  ) =>
    Effect.gen(function* () {
      yield* requireProject(initiative.projectId);
      const previous = initiative.planner;
      // A launch attempt is only retried for the same request; otherwise its command id
      // would resolve to the thread of a different planning request.
      const reusable =
        previous.launch?.operation === "planner" &&
        previous.mode === request.mode &&
        previous.instructions === request.instructions
          ? previous.launch
          : null;
      const attempt = reusable ?? (yield* makeLaunchAttempt("planner"));
      // Drop the previous run link: once baseRevision moves, refresh would otherwise re-read
      // that run and resurrect its already-applied proposal.
      const pending = {
        ...previous,
        ...request,
        status: "idle" as const,
        threadId: null,
        runId: null,
        error: null,
        adjustment: null,
        launch: attempt,
      };
      if (reusable === null) {
        yield* store.save(
          withComputedView({ ...initiative, planner: pending, updatedAt: yield* nowIso }),
        );
      }
      const launched = yield* launch(
        "planner",
        initiative,
        title,
        prompt,
        runOptionsFor(options),
        attempt,
      ).pipe(
        Effect.tapError(() =>
          Effect.gen(function* () {
            const now = yield* nowIso;
            yield* store
              .save(
                withComputedView({
                  ...initiative,
                  planner: { ...pending, status: "failed", error: "Launch failed." },
                  updatedAt: now,
                }),
              )
              .pipe(Effect.ignore);
          }),
        ),
      );
      const now = yield* nowIso;
      const next = withComputedView({
        ...initiative,
        planner: {
          ...request,
          status: "running",
          threadId: launched.threadId,
          runId: launched.runId,
          error: null,
          launch: null,
          adjustment: null,
        },
        updatedAt: now,
      });
      yield* store.save(next);
      return next;
    });

  const startPlanning: AtlasService["Service"]["startPlanning"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const current = yield* load(input.initiativeId);
        const initiative = yield* syncInitiative(current);
        if (initiative.planner.status === "running") return initiative;
        return yield* launchPlanner(
          initiative,
          input,
          { mode: "plan", baseRevision: null, instructions: null },
          `Atlas plan: ${initiative.title}`,
          plannerPrompt(initiative),
        );
      }),
    );

  const startPlanAdjustment: AtlasService["Service"]["startPlanAdjustment"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const current = yield* load(input.initiativeId);
        const initiative = yield* syncInitiative(current);
        if (initiative.planner.status === "running") return initiative;
        if (initiative.tasks.length === 0) {
          return yield* Effect.fail(
            new AtlasPlanValidationError({
              reason: "There is no plan to adjust yet. Plan or import the initiative first.",
            }),
          );
        }
        return yield* launchPlanner(
          initiative,
          input,
          {
            mode: "adjust",
            baseRevision: initiative.planRevision,
            instructions: input.instructions,
          },
          `Atlas plan adjustment: ${initiative.title}`,
          adjustmentPrompt(initiative, input.instructions),
        );
      }),
    );

  const applyPlanAdjustment: AtlasService["Service"]["applyPlanAdjustment"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const current = yield* load(input.initiativeId);
        const initiative = yield* syncInitiative(current);
        const conflict = (expectedPlanRevision: number) =>
          new AtlasPlanRevisionConflictError({
            initiativeId: initiative.id,
            expectedPlanRevision,
            actualPlanRevision: initiative.planRevision,
          });
        if (input.expectedPlanRevision !== initiative.planRevision) {
          return yield* Effect.fail(conflict(input.expectedPlanRevision));
        }

        let adjustment: AtlasPlanAdjustment;
        if (input.adjustment !== undefined) {
          adjustment = yield* decodeAdjustment(input.adjustment).pipe(
            Effect.mapError(toValidationError),
          );
        } else {
          const planner = initiative.planner;
          if (planner.mode !== "adjust" || planner.threadId === null) {
            return yield* Effect.fail(
              new AtlasPlanImportError({ reason: "No plan adjustment run is linked." }),
            );
          }
          if (planner.status === "running") {
            return yield* Effect.fail(
              new AtlasExecutionNotFinishedError({ threadId: planner.threadId, status: "running" }),
            );
          }
          if (planner.baseRevision !== initiative.planRevision) {
            return yield* Effect.fail(conflict(planner.baseRevision ?? 0));
          }
          if (planner.adjustment === null) {
            return yield* Effect.fail(
              new AtlasPlanImportError({
                reason: (planner.error ?? "The planner has not proposed an adjustment.").slice(
                  0,
                  2_000,
                ),
              }),
            );
          }
          adjustment = planner.adjustment;
        }

        const now = yield* nowIso;
        const ids = yield* Effect.forEach(
          adjustment.additions,
          () => randomId("atlas-task").pipe(Effect.map(AtlasTaskId.make)),
          { concurrency: 1 },
        );
        const tasks = yield* Effect.try({
          try: () => applyAdjustment(initiative.tasks, adjustment, ids, now),
          catch: toValidationError,
        });
        const next = withComputedView({
          ...initiative,
          tasks,
          planRevision: initiative.planRevision + 1,
          planner: { ...initiative.planner, adjustment: null },
          updatedAt: now,
        });
        yield* store.save(next);
        return next;
      }),
    );

  const importPlan: AtlasService["Service"]["importPlan"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const initiative = yield* load(input.initiativeId);
        if (
          initiative.tasks.some(
            (task) =>
              task.execution !== null ||
              task.issue !== null ||
              task.agentReview !== null ||
              task.launch !== null,
          )
        ) {
          return yield* Effect.fail(
            new AtlasPlanImportError({
              reason:
                "Tasks already have launch, execution, review, or issue history; clear that history before re-importing a plan.",
            }),
          );
        }
        let plan: AtlasPlanDraft;

        if (input.plan !== undefined) {
          plan = yield* decodePlan(input.plan).pipe(
            Effect.mapError((cause) => new AtlasPlanValidationError({ reason: String(cause) })),
          );
        } else {
          if (initiative.planner.mode === "adjust") {
            return yield* Effect.fail(
              new AtlasPlanImportError({
                reason:
                  "The latest planner run proposed an adjustment; apply it instead of importing it.",
              }),
            );
          }
          if (initiative.planner.threadId === null || initiative.planner.runId === null) {
            return yield* Effect.fail(
              new AtlasPlanImportError({ reason: "No completed planner run is linked." }),
            );
          }
          const run = yield* readRun(initiative.planner.threadId, initiative.planner.runId);
          if (run === null) {
            return yield* Effect.fail(
              new AtlasPlanImportError({ reason: "The linked planner run was not found." }),
            );
          }
          if (run.status !== "completed") {
            return yield* Effect.fail(
              new AtlasExecutionNotFinishedError({
                threadId: initiative.planner.threadId,
                status: run.status,
              }),
            );
          }
          if (run.result === null) {
            return yield* Effect.fail(
              new AtlasPlanImportError({ reason: "The planner produced no assistant output." }),
            );
          }
          let parsed: unknown;
          try {
            parsed = parseJsonObject(run.result);
          } catch {
            return yield* Effect.fail(
              new AtlasPlanImportError({
                reason: "The planner output did not contain a JSON plan.",
              }),
            );
          }
          plan = yield* decodePlan(parsed).pipe(
            Effect.mapError((cause) => new AtlasPlanValidationError({ reason: String(cause) })),
          );
        }

        const validated = yield* Effect.try({
          try: () => validatePlan(plan),
          catch: (cause) =>
            isPlanValidationError(cause)
              ? cause
              : new AtlasPlanValidationError({ reason: String(cause) }),
        });

        const now = yield* nowIso;
        const ids = yield* Effect.forEach(
          validated.tasks,
          () => randomId("atlas-task").pipe(Effect.map(AtlasTaskId.make)),
          { concurrency: 1 },
        );
        const idByKey = new Map(validated.tasks.map((task, index) => [task.key, ids[index]!]));
        const tasks: ReadonlyArray<AtlasTask> = validated.tasks.map((draft, ordinal) => ({
          id: idByKey.get(draft.key)!,
          ordinal,
          title: draft.title,
          description: draft.description,
          specialty: draft.specialty,
          deliverable: draft.deliverable ?? null,
          acceptanceCriteria: draft.acceptanceCriteria,
          dependsOn: draft.dependsOn.map((key) => idByKey.get(key)!),
          blockedBy: [],
          status: "proposed",
          issue: null,
          execution: null,
          agentReview: null,
          humanDecision: { outcome: "pending", feedback: null, decidedAt: null },
          launch: null,
          createdAt: now,
          updatedAt: now,
        }));

        const next = withComputedView({
          ...initiative,
          planSummary: validated.summary,
          planRevision: initiative.planRevision + 1,
          planner: { ...initiative.planner, adjustment: null },
          tasks,
          updatedAt: now,
        });
        yield* store.save(next);
        return next;
      }),
    );

  const refreshInitiative: AtlasService["Service"]["refreshInitiative"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      load(input.initiativeId).pipe(Effect.flatMap(syncInitiative)),
    );

  const findTask = (initiative: AtlasInitiative, taskId: AtlasTaskId) => {
    const task = initiative.tasks.find((candidate) => candidate.id === taskId);
    return task === undefined
      ? Effect.fail(new AtlasTaskNotFoundError({ initiativeId: initiative.id, taskId }))
      : Effect.succeed(task);
  };

  const ensureNoOtherActiveExecution = (
    initiative: AtlasInitiative,
    taskId: AtlasTaskId,
    workspace: OrchestrationV2ThreadLaunchWorkspaceStrategy,
    projectRoot: string,
  ): Effect.Effect<void, AtlasProjectBusyError | AtlasPersistenceError> =>
    Effect.gen(function* () {
      const initiatives = yield* store.list(initiative.projectId);
      for (const candidate of initiatives) {
        for (const candidateTask of candidate.tasks) {
          if (
            candidateTask.execution?.status !== "running" ||
            (candidate.id === initiative.id && candidateTask.id === taskId)
          ) {
            continue;
          }
          const run = yield* readRun(
            candidateTask.execution.threadId,
            candidateTask.execution.runId,
          );
          const savedWorkspace = candidateTask.execution.workspaceStrategy ?? {
            type: "root" as const,
          };
          const activeWorkspace =
            savedWorkspace.type === "worktree" && run?.workspaceStrategy?.type === "root"
              ? savedWorkspace
              : (run?.workspaceStrategy ?? savedWorkspace);
          const pathOf = (strategy: OrchestrationV2ThreadLaunchWorkspaceStrategy) =>
            strategy.type === "worktree"
              ? null
              : path.resolve(strategy.type === "root" ? projectRoot : strategy.worktreePath);
          const targetPath = pathOf(workspace);
          const activePath = pathOf(activeWorkspace);
          const sameBranch =
            workspace.type !== "root" &&
            activeWorkspace.type !== "root" &&
            workspace.branch !== undefined &&
            workspace.branch === activeWorkspace.branch;
          const overlaps = sameBranch || (targetPath !== null && targetPath === activePath);
          // An unreadable run keeps its workspace reserved until the next reconciliation.
          if (overlaps && (run === null || run.status === "running")) {
            return yield* Effect.fail(
              new AtlasProjectBusyError({
                projectId: initiative.projectId,
                activeInitiativeId: candidate.id,
                activeTaskId: candidateTask.id,
              }),
            );
          }
        }
      }
      return undefined;
    });

  const replaceTask = (
    initiative: AtlasInitiative,
    taskId: AtlasTaskId,
    update: (task: AtlasTask) => AtlasTask,
  ) =>
    withComputedView({
      ...initiative,
      tasks: initiative.tasks.map((task) => (task.id === taskId ? update(task) : task)),
    });

  const executeTask: AtlasService["Service"]["executeTask"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const current = yield* load(input.initiativeId);
        const initiative = yield* syncInitiative(current);
        const task = yield* findTask(initiative, input.taskId);
        const dependencies = task.dependsOn
          .map((dependencyId) =>
            initiative.tasks.find((candidate) => candidate.id === dependencyId),
          )
          .filter((candidate): candidate is AtlasTask => candidate !== undefined);
        const blockedBy = dependencies
          .filter((dependency) => dependency.status !== "approved")
          .map((dependency) => dependency.id);
        if (blockedBy.length > 0) {
          return yield* Effect.fail(
            new AtlasDependencyNotApprovedError({ taskId: task.id, blockedBy }),
          );
        }
        if (
          task.agentReview?.status === "running" ||
          (task.status !== "proposed" &&
            task.status !== "failed" &&
            task.status !== "changes_requested")
        ) {
          return yield* Effect.fail(
            new AtlasTaskNotRunnableError({ taskId: task.id, status: task.status }),
          );
        }
        const project = yield* requireProject(initiative.projectId);
        return yield* projectExecutionLocks.withLock(
          initiative.projectId,
          Effect.gen(function* () {
            const requestedWorkspace = input.workspaceStrategy ??
              task.execution?.workspaceStrategy ?? { type: "root" as const };
            const attempt =
              task.launch?.operation === "execution"
                ? task.launch
                : {
                    ...(yield* makeLaunchAttempt("execution")),
                    workspaceStrategy: requestedWorkspace,
                  };
            // Retried commands may already own a thread, so reserve their original workspace.
            const executionWorkspace = attempt.workspaceStrategy ?? { type: "root" as const };
            yield* ensureNoOtherActiveExecution(
              initiative,
              task.id,
              executionWorkspace,
              project.workspaceRoot,
            );
            if (task.launch?.operation !== "execution") {
              const now = yield* nowIso;
              yield* store.save(
                replaceTask(initiative, task.id, (previous) => ({
                  ...previous,
                  launch: attempt,
                  updatedAt: now,
                })),
              );
            }

            const launched = yield* launch(
              "task",
              initiative,
              `Atlas: ${task.title}`,
              taskPrompt(initiative, task, dependencies),
              { ...input, workspaceStrategy: executionWorkspace },
              attempt,
            ).pipe(
              Effect.tapError(() =>
                Effect.gen(function* () {
                  const now = yield* nowIso;
                  yield* store
                    .save(
                      replaceTask(initiative, task.id, (previous) => ({
                        ...previous,
                        status:
                          previous.humanDecision.outcome === "changes_requested"
                            ? "changes_requested"
                            : "failed",
                        execution: previous.execution,
                        agentReview: previous.agentReview,
                        humanDecision: previous.humanDecision,
                        launch: attempt,
                        updatedAt: now,
                      })),
                    )
                    .pipe(Effect.ignore);
                }),
              ),
            );

            const now = yield* nowIso;
            const next = replaceTask(initiative, task.id, (previous) => ({
              ...previous,
              status: "running",
              execution: {
                threadId: launched.threadId,
                runId: launched.runId,
                status: "running",
                startedAt: launched.startedAt,
                finishedAt: null,
                result: null,
                workspaceStrategy: launched.workspaceStrategy,
                artifacts: [],
              },
              agentReview: null,
              humanDecision: { outcome: "pending", feedback: null, decidedAt: null },
              launch: null,
              updatedAt: now,
            }));
            yield* store.save(next);
            return next;
          }),
        );
      }),
    );

  const decide = (
    input: { readonly initiativeId: AtlasInitiative["id"]; readonly taskId: AtlasTaskId },
    outcome: "approved" | "changes_requested",
    feedback: string | null,
  ) =>
    Effect.gen(function* () {
      const current = yield* load(input.initiativeId);
      const initiative = yield* syncInitiative(current);
      const task = yield* findTask(initiative, input.taskId);
      if (task.execution === null) {
        return yield* Effect.fail(
          new AtlasTaskNotRunnableError({ taskId: task.id, status: task.status }),
        );
      }
      if (task.execution.status !== "completed") {
        return yield* Effect.fail(
          new AtlasExecutionNotFinishedError({
            threadId: task.execution.threadId,
            status: task.execution.status,
          }),
        );
      }
      const now = yield* nowIso;
      const next = replaceTask(initiative, task.id, (previous) => ({
        ...previous,
        status: outcome,
        humanDecision: { outcome, feedback, decidedAt: now, decidedBy: "human" as const },
        updatedAt: now,
      }));
      const withStatus = withComputedView({ ...next, updatedAt: now });
      yield* store.save(withStatus);
      return withStatus;
    });

  const approveTask: AtlasService["Service"]["approveTask"] = (input) =>
    initiativeLocks.withLock(input.initiativeId, decide(input, "approved", input.feedback ?? null));

  const requestChanges: AtlasService["Service"]["requestChanges"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      decide(input, "changes_requested", input.feedback),
    );

  const startAgentReview: AtlasService["Service"]["startAgentReview"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const current = yield* load(input.initiativeId);
        const initiative = yield* syncInitiative(current);
        const task = yield* findTask(initiative, input.taskId);
        if (task.agentReview?.status === "running") return initiative;
        if (task.execution === null) {
          return yield* Effect.fail(
            new AtlasTaskNotRunnableError({ taskId: task.id, status: task.status }),
          );
        }
        if (task.execution.status !== "completed") {
          return yield* Effect.fail(
            new AtlasExecutionNotFinishedError({
              threadId: task.execution.threadId,
              status: task.execution.status,
            }),
          );
        }
        yield* requireProject(initiative.projectId);
        const reviewOptions =
          input.workspaceStrategy === undefined && task.execution.workspaceStrategy !== undefined
            ? { ...input, workspaceStrategy: task.execution.workspaceStrategy }
            : input;
        const attempt =
          task.launch?.operation === "review" ? task.launch : yield* makeLaunchAttempt("review");
        if (task.launch === null || task.launch.operation !== "review") {
          const savedAt = yield* nowIso;
          yield* store.save(
            replaceTask(initiative, task.id, (previous) => ({
              ...previous,
              launch: attempt,
              updatedAt: savedAt,
            })),
          );
        }
        const launched = yield* launch(
          "review",
          initiative,
          `Atlas review: ${task.title}`,
          reviewPrompt(initiative, task),
          reviewOptions,
          attempt,
        ).pipe(
          Effect.tapError((error) =>
            Effect.gen(function* () {
              const now = yield* nowIso;
              yield* store
                .save(
                  replaceTask(initiative, task.id, (previous) => ({
                    ...previous,
                    launch: { ...attempt, error: error.message },
                    updatedAt: now,
                  })),
                )
                .pipe(Effect.ignore);
            }),
          ),
        );
        const now = yield* nowIso;
        const next = replaceTask(initiative, task.id, (previous) => ({
          ...previous,
          agentReview: {
            threadId: launched.threadId,
            runId: launched.runId,
            status: "running",
            outcome: null,
            feedback: null,
            startedAt: launched.startedAt,
            finishedAt: null,
            result: null,
            autoApplyVerdict: input.autoApplyVerdict ?? false,
          },
          launch: null,
          updatedAt: now,
        }));
        yield* store.save(next);
        return next;
      }),
    );

  const publishTaskIssue: AtlasService["Service"]["publishTaskIssue"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const initiative = yield* load(input.initiativeId);
        const task = yield* findTask(initiative, input.taskId);
        if (task.issue !== null && task.issue.needsSync !== true) {
          return withComputedView(initiative);
        }

        const project = yield* requireProject(initiative.projectId);
        const remote = yield* processRunner
          .run({
            command: "git",
            args: ["config", "--get", "remote.origin.url"],
            cwd: project.workspaceRoot,
            timeout: "15 seconds",
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new AtlasIssuePublishError({
                  taskId: task.id,
                  operation: "create",
                  exitCode: null,
                  cause,
                }),
            ),
          );
        const repository = parseGitHubRepositoryNameWithOwnerFromRemoteUrl(remote.stdout);
        if (remote.code !== 0 || remote.stdout.trim().length === 0) {
          return yield* Effect.fail(
            new AtlasGitHubRepositoryError({
              projectId: initiative.projectId,
              reason: "missing_remote",
            }),
          );
        }
        if (repository === null) {
          return yield* Effect.fail(
            new AtlasGitHubRepositoryError({
              projectId: initiative.projectId,
              reason: "unsupported_remote",
            }),
          );
        }

        if (task.issue !== null) {
          const issue = task.issue;
          const updateFailure = (exitCode: number | null, cause: unknown) =>
            new AtlasIssuePublishError({ taskId: task.id, operation: "update", exitCode, cause });
          const edited = yield* processRunner
            .run({
              command: "gh",
              args: [
                "issue",
                "edit",
                String(issue.number),
                "--repo",
                repository,
                "--title",
                `[Atlas] ${task.title}`,
                "--body",
                issueBody(initiative, task),
              ],
              cwd: project.workspaceRoot,
              timeout: "60 seconds",
            })
            .pipe(Effect.mapError((cause) => updateFailure(null, cause)));
          if (edited.code !== 0) {
            return yield* Effect.fail(updateFailure(edited.code, edited.stderr));
          }
          const now = yield* nowIso;
          const synced = replaceTask(initiative, task.id, (previous) => ({
            ...previous,
            issue: { number: issue.number, url: issue.url, publishedAt: issue.publishedAt },
            updatedAt: now,
          }));
          yield* store.save(synced);
          return synced;
        }

        const marker = issueMarker(task.id);
        const existing = yield* processRunner
          .run({
            command: "gh",
            args: [
              "issue",
              "list",
              "--repo",
              repository,
              "--state",
              "all",
              "--json",
              "number,url,body",
              "--limit",
              "200",
            ],
            cwd: project.workspaceRoot,
            timeout: "30 seconds",
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new AtlasIssuePublishError({
                  taskId: task.id,
                  operation: "create",
                  exitCode: null,
                  cause,
                }),
            ),
          );
        if (existing.code !== 0) {
          return yield* Effect.fail(
            new AtlasIssuePublishError({
              taskId: task.id,
              operation: "create",
              exitCode: existing.code,
              cause: existing.stderr,
            }),
          );
        }
        let parsedExisting: unknown;
        try {
          parsedExisting = decodeJson(existing.stdout);
        } catch (cause) {
          return yield* Effect.fail(
            new AtlasIssuePublishError({
              taskId: task.id,
              operation: "create",
              exitCode: existing.code,
              cause: `gh issue list returned malformed JSON. ${String(cause)}`,
            }),
          );
        }
        if (!Array.isArray(parsedExisting)) {
          return yield* Effect.fail(
            new AtlasIssuePublishError({
              taskId: task.id,
              operation: "create",
              exitCode: existing.code,
              cause: "gh issue list did not return an issue array.",
            }),
          );
        }
        const existingIssue = (() => {
          for (const item of parsedExisting) {
            if (typeof item !== "object" || item === null) continue;
            const number = "number" in item ? item.number : null;
            const url = "url" in item ? item.url : null;
            const body = "body" in item ? item.body : null;
            if (
              typeof number === "number" &&
              typeof url === "string" &&
              typeof body === "string" &&
              body.split("\n").some((line) => line.trim() === marker)
            ) {
              return { number, url };
            }
          }
          return null;
        })();
        if (existingIssue !== null) {
          const now = yield* nowIso;
          const recovered = replaceTask(initiative, task.id, (previous) => ({
            ...previous,
            issue: { ...existingIssue, publishedAt: now },
            updatedAt: now,
          }));
          yield* store.save(recovered);
          return recovered;
        }

        const created = yield* processRunner
          .run({
            command: "gh",
            args: [
              "issue",
              "create",
              "--repo",
              repository,
              "--title",
              `[Atlas] ${task.title}`,
              "--body",
              issueBody(initiative, task),
            ],
            cwd: project.workspaceRoot,
            timeout: "60 seconds",
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new AtlasIssuePublishError({
                  taskId: task.id,
                  operation: "create",
                  exitCode: null,
                  cause,
                }),
            ),
          );
        if (created.code !== 0) {
          return yield* Effect.fail(
            new AtlasIssuePublishError({
              taskId: task.id,
              operation: "create",
              exitCode: created.code,
              cause: created.stderr,
            }),
          );
        }
        const match = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/(\d+)/.exec(created.stdout);
        if (match === null) {
          return yield* Effect.fail(
            new AtlasIssuePublishError({
              taskId: task.id,
              operation: "create",
              exitCode: created.code,
              cause: "gh issue create did not return an issue URL.",
            }),
          );
        }
        const now = yield* nowIso;
        const next = replaceTask(initiative, task.id, (previous) => ({
          ...previous,
          issue: {
            number: Number(match[1]),
            url: match[0],
            publishedAt: now,
          },
          updatedAt: now,
        }));
        const withStatus = withComputedView({ ...next, updatedAt: now });
        yield* store.save(withStatus);
        return withStatus;
      }),
    );

  return AtlasService.of({
    listInitiatives,
    getInitiative,
    createInitiative,
    updateInitiative,
    deleteInitiative,
    startPlanning,
    startPlanAdjustment,
    applyPlanAdjustment,
    importPlan,
    refreshInitiative,
    executeTask,
    approveTask,
    requestChanges,
    startAgentReview,
    publishTaskIssue,
  });
});

export const layer = Layer.effect(AtlasService, make);
