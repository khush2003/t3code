import {
  AtlasAgentReviewOutcome,
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
  AtlasPlanDraft,
  AtlasPlanImportError,
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
const isPlanValidationError = Schema.is(AtlasPlanValidationError);
const decodeReviewVerdict = Schema.decodeUnknownSync(
  Schema.Struct({ outcome: AtlasAgentReviewOutcome, feedback: Schema.String }),
);

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

  const byKey = new Map(plan.tasks.map((task) => [task.key, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new AtlasPlanValidationError({ reason: `Dependencies form a cycle at "${key}".` });
    }
    visiting.add(key);
    for (const dependency of byKey.get(key)?.dependsOn ?? []) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const task of plan.tasks) visit(task.key);

  return plan;
};

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

const PLANNER_FORMAT = `Return ONLY a final JSON object with this exact shape (no markdown prose around it):
{
  "summary": "short plan summary",
  "tasks": [
    {
      "key": "stable-local-key",
      "title": "task title",
      "description": "implementation details",
      "specialty": "frontend | backend | tests | docs | ...",
      "acceptanceCriteria": ["observable criterion"],
      "dependsOn": ["another-local-key"]
    }
  ]
}
Keys must be unique. dependsOn may only reference keys in this plan and must be acyclic.
Every task must have at least one acceptance criterion. Keep tasks independently executable.`;

const plannerPrompt = (initiative: AtlasInitiative): string =>
  formatPrompt([
    "You are the Atlas planning agent. Turn this initiative into an executable task plan.",
    `Project id: ${initiative.projectId}`,
    `Initiative: ${initiative.title}`,
    `Brief:\n${initiative.brief}`,
    initiative.deliverables.length === 0
      ? ""
      : `Deliverables:\n${initiative.deliverables.map((item) => `- ${item}`).join("\n")}`,
    "Decompose the work into small, reviewable tasks. Capture every dependency explicitly.",
    "Do not edit files, create commits, or run mutating commands. Produce a plan only.",
    PLANNER_FORMAT,
  ]);

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
  ]);

const reviewPrompt = (initiative: AtlasInitiative, task: AtlasTask): string =>
  formatPrompt([
    "You are the Atlas review agent. Review the implementation against its acceptance criteria.",
    `Initiative: ${initiative.title}\n${initiative.brief}`,
    `Task: ${task.title}\n${task.description}`,
    `Acceptance criteria:\n${task.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
    `Implementation result:\n${task.execution?.result ?? "(no result recorded)"}`,
    "Inspect the workspace when needed. Do not edit files, create commits, or run mutating commands. Review only.",
    "Be strict about unmet criteria.",
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
          Effect.map((run) =>
            run === null
              ? execution
              : {
                  ...execution,
                  status: run.status,
                  startedAt: run.startedAt,
                  finishedAt: isTerminal(run.status) ? run.finishedAt : null,
                  result: run.result,
                  workspaceStrategy:
                    run.status === "running" &&
                    run.workspaceStrategy?.type === "root" &&
                    execution.workspaceStrategy?.type === "worktree"
                      ? execution.workspaceStrategy
                      : (run.workspaceStrategy ?? execution.workspaceStrategy),
                },
          ),
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
        plannerRun === null
          ? initiative.planner
          : {
              ...initiative.planner,
              status: mapPlannerStatus(plannerRun.status),
              error:
                plannerRun.status === "failed"
                  ? (plannerRun.result ?? "The planning run failed.")
                  : null,
            };

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
        planner: { status: "idle", threadId: null, runId: null, error: null, launch: null },
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

  const startPlanning: AtlasService["Service"]["startPlanning"] = (input) =>
    initiativeLocks.withLock(
      input.initiativeId,
      Effect.gen(function* () {
        const current = yield* load(input.initiativeId);
        const initiative = yield* syncInitiative(current);
        if (initiative.planner.status === "running") return initiative;
        yield* requireProject(initiative.projectId);
        const attempt =
          initiative.planner.launch?.operation === "planner"
            ? initiative.planner.launch
            : yield* makeLaunchAttempt("planner");
        if (initiative.planner.launch === null) {
          yield* store.save(
            withComputedView({
              ...initiative,
              planner: { ...initiative.planner, launch: attempt },
              updatedAt: yield* nowIso,
            }),
          );
        }
        const launched = yield* launch(
          "planner",
          initiative,
          `Atlas plan: ${initiative.title}`,
          plannerPrompt(initiative),
          runOptionsFor(input),
          attempt,
        ).pipe(
          Effect.tapError(() =>
            Effect.gen(function* () {
              const now = yield* nowIso;
              yield* store
                .save(
                  withComputedView({
                    ...initiative,
                    planner: {
                      ...initiative.planner,
                      status: "failed",
                      error: "Launch failed.",
                      launch: attempt,
                    },
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
            status: "running",
            threadId: launched.threadId,
            runId: launched.runId,
            error: null,
            launch: null,
          },
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
        if (task.issue !== null) return withComputedView(initiative);

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
