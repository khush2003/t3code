import {
  AtlasPlanDraft,
  type AtlasAgentReviewStatus,
  type AtlasInitiative,
  type AtlasTask,
  type AtlasTaskStatus,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export type AtlasBadgeVariant =
  | "default"
  | "secondary"
  | "outline"
  | "success"
  | "error"
  | "warning"
  | "info"
  | "destructive";

export function taskStatusBadgeVariant(status: AtlasTaskStatus): AtlasBadgeVariant {
  switch (status) {
    case "proposed":
      return "secondary";
    case "running":
      return "info";
    case "needs_review":
      return "warning";
    case "changes_requested":
      return "warning";
    case "approved":
      return "success";
    case "failed":
      return "error";
  }
}

export function taskStatusLabel(status: AtlasTaskStatus): string {
  switch (status) {
    case "proposed":
      return "Proposed";
    case "running":
      return "Running";
    case "needs_review":
      return "Needs review";
    case "changes_requested":
      return "Changes requested";
    case "approved":
      return "Approved";
    case "failed":
      return "Failed";
  }
}

export function taskIsRunning(task: AtlasTask): boolean {
  return (
    task.status === "running" ||
    task.execution?.status === "running" ||
    task.agentReview?.status === "running"
  );
}

/**
 * A task can be executed when nothing is in flight, its dependencies are all
 * approved, and it is not already approved. The server enforces this too; the
 * client only decides what to offer.
 */
export function canExecuteTask(task: AtlasTask): boolean {
  if (taskIsRunning(task) || task.blockedBy.length > 0 || task.status === "approved") return false;
  return (
    task.status === "proposed" || task.status === "failed" || task.status === "changes_requested"
  );
}

export function canDecideOnTask(task: AtlasTask): boolean {
  if (taskIsRunning(task)) return false;
  return (
    task.status === "needs_review" ||
    task.status === "changes_requested" ||
    task.status === "approved"
  );
}

export function canStartAgentReview(task: AtlasTask): boolean {
  if (taskIsRunning(task)) return false;
  return (
    task.execution !== null &&
    task.execution.status === "completed" &&
    task.status !== "approved" &&
    task.status !== "failed"
  );
}

/**
 * Publishing never touches a workspace, so any task qualifies while it has no
 * issue or its plan edits have outdated the published one.
 */
/**
 * A reviewer that failed to launch leaves no thread behind, only the error on
 * the launch attempt. The task stays in review until someone retries.
 */
export function reviewLaunchError(task: AtlasTask): string | null {
  if (task.launch?.operation !== "review") return null;
  const error = task.launch.error?.trim();
  return error ? error : null;
}

export function canPublishTaskIssue(task: AtlasTask): boolean {
  return task.issue === null || task.issue.needsSync === true;
}

export function initiativeHasActiveWork(initiative: AtlasInitiative): boolean {
  if (initiative.planner.status === "running") return true;
  return initiative.tasks.some(taskIsRunning);
}

export function taskCounts(tasks: ReadonlyArray<AtlasTask>): {
  readonly total: number;
  readonly approved: number;
  readonly running: number;
  readonly ready: number;
} {
  let approved = 0;
  let running = 0;
  let ready = 0;
  for (const task of tasks) {
    if (task.status === "approved") approved += 1;
    if (taskIsRunning(task)) running += 1;
    if (canExecuteTask(task) && task.blockedBy.length === 0) ready += 1;
  }
  return { total: tasks.length, approved, running, ready };
}

export function agentReviewStatusLabel(status: AtlasAgentReviewStatus): string {
  switch (status) {
    case "none":
      return "No agent review";
    case "running":
      return "Agent review running";
    case "completed":
      return "Agent review complete";
    case "failed":
      return "Agent review failed";
  }
}

export function initiativeStatusLabel(initiative: AtlasInitiative): string {
  switch (initiative.status) {
    case "draft":
      return "Draft";
    case "planning":
      return "Planning";
    case "plan_ready":
      return "Plan ready";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
  }
}

export type AtlasPlanParseResult =
  | { readonly ok: true; readonly plan: AtlasPlanDraft }
  | { readonly ok: false; readonly error: string };

const decodeAtlasPlanDraft = Schema.decodeUnknownResult(AtlasPlanDraft);

/**
 * Parses a pasted plan for `importPlan` using the shared `AtlasPlanDraft`
 * schema, so required fields (including a non-empty description) are enforced
 * the same way the server does. Dependency-graph validation stays authoritative
 * on the server.
 */
export function parseAtlasPlanJson(text: string): AtlasPlanParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "That is not valid JSON." };
  }
  const decoded = decodeAtlasPlanDraft(parsed);
  if (Result.isFailure(decoded)) {
    return { ok: false, error: decoded.failure.message };
  }
  return { ok: true, plan: decoded.success };
}

/** `dependencies` are local plan keys, shown for a task the planner is still proposing. */
export function formatTaskDependencies(
  task: AtlasTask,
  tasks: ReadonlyArray<AtlasTask>,
): ReadonlyArray<string> {
  const byId = new Map(tasks.map((entry) => [entry.id, entry]));
  return task.dependsOn
    .map((id) => byId.get(id)?.title ?? null)
    .filter((title): title is string => title !== null);
}
