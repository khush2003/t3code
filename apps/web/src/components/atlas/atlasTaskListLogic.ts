import type { AtlasTask, AtlasTaskId } from "@t3tools/contracts";

import {
  canDecideOnTask,
  canExecuteTask,
  reviewLaunchError,
  taskIsRunning,
  taskStatusLabel,
} from "./atlasLogic";

/**
 * Lanes answer "what do I do with this task next", not "what status is it in".
 * Every task lands in exactly one lane, in this order of precedence.
 */
export type AtlasTaskLane = "attention" | "ready" | "running" | "blocked" | "done";

export const ATLAS_TASK_LANES: ReadonlyArray<{
  readonly lane: AtlasTaskLane;
  readonly label: string;
}> = [
  { lane: "attention", label: "Needs you" },
  { lane: "ready", label: "Ready to run" },
  { lane: "running", label: "Running" },
  { lane: "blocked", label: "Blocked" },
  { lane: "done", label: "Approved" },
];

export function taskLane(task: AtlasTask): AtlasTaskLane {
  if (taskIsRunning(task)) return "running";
  if (task.status === "approved") return "done";
  if (task.status === "needs_review" || task.status === "failed") return "attention";
  if (task.blockedBy.length > 0) return "blocked";
  if (canExecuteTask(task)) return "ready";
  return "attention";
}

/**
 * Dependency depth: tasks with no dependencies are wave 1, and every other task
 * runs one wave after its deepest dependency. Tasks in the same wave can run in
 * parallel once the earlier waves are approved. Cycles (rejected by the server)
 * are cut rather than looping.
 */
export function taskWaves(tasks: ReadonlyArray<AtlasTask>): ReadonlyMap<AtlasTaskId, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const waves = new Map<AtlasTaskId, number>();
  const visiting = new Set<AtlasTaskId>();
  const visit = (task: AtlasTask): number => {
    const known = waves.get(task.id);
    if (known !== undefined) return known;
    if (visiting.has(task.id)) return 1;
    visiting.add(task.id);
    let wave = 1;
    for (const id of task.dependsOn) {
      const dependency = byId.get(id);
      if (dependency) wave = Math.max(wave, visit(dependency) + 1);
    }
    visiting.delete(task.id);
    waves.set(task.id, wave);
    return wave;
  };
  for (const task of tasks) visit(task);
  return waves;
}

export interface AtlasTaskReason {
  readonly text: string;
  readonly tone: "muted" | "warning" | "error" | "info" | "success";
}

/** One line explaining why a task sits in its lane and what unblocks it. */
export function taskReason(
  task: AtlasTask,
  byId: ReadonlyMap<AtlasTaskId, AtlasTask>,
): AtlasTaskReason {
  if (task.agentReview?.status === "running") return { text: "Agent reviewing", tone: "info" };
  if (taskIsRunning(task)) return { text: "Agent implementing", tone: "info" };
  if (task.status === "failed") {
    return task.execution?.status === "failed" || task.execution === null
      ? { text: "Run failed. Re-run or inspect the thread", tone: "error" }
      : { text: `Run ${task.execution.status}. Re-run when ready`, tone: "error" };
  }
  if (task.status === "needs_review") {
    if (reviewLaunchError(task) !== null)
      return { text: "Agent review could not start. Retry it", tone: "warning" };
    if (task.agentReview?.outcome === "approved")
      return { text: "Reviewer suggests approval", tone: "success" };
    if (task.agentReview?.outcome === "changes_requested")
      return { text: "Reviewer suggests changes", tone: "warning" };
    if (task.agentReview?.status === "failed")
      return { text: "Agent review failed. Review it yourself", tone: "warning" };
    return { text: "Waiting for your review", tone: "warning" };
  }
  if (task.blockedBy.length > 0) {
    const blockers = task.blockedBy.flatMap((id) => {
      const blocker = byId.get(id);
      return blocker
        ? [`#${blocker.ordinal + 1} ${taskStatusLabel(blocker.status).toLowerCase()}`]
        : [];
    });
    return {
      text: blockers.length > 0 ? `Waiting on ${blockers.join(", ")}` : "Waiting on dependencies",
      tone: "muted",
    };
  }
  if (task.status === "changes_requested") {
    return { text: "Changes requested. Re-run with feedback", tone: "warning" };
  }
  if (task.status === "approved") {
    return task.humanDecision.decidedBy === "agent"
      ? { text: "Approved by review agent", tone: "muted" }
      : { text: "Approved", tone: "muted" };
  }
  return task.execution === null
    ? { text: "Dependencies approved", tone: "muted" }
    : { text: "Ready to re-run", tone: "muted" };
}

/**
 * Tasks that are not approved yet but directly gate others, ordered by how many
 * tasks each one holds back. This surfaces the review or run that would unlock
 * the most parallel work next.
 */
export function blockingTasks(
  tasks: ReadonlyArray<AtlasTask>,
): ReadonlyArray<{ readonly task: AtlasTask; readonly blocks: number }> {
  const counts = new Map<AtlasTaskId, number>();
  for (const task of tasks) {
    for (const id of task.blockedBy) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return tasks
    .flatMap((task) => {
      const blocks = counts.get(task.id) ?? 0;
      return blocks > 0 && task.status !== "approved" ? [{ task, blocks }] : [];
    })
    .toSorted(
      (left, right) => right.blocks - left.blocks || left.task.ordinal - right.task.ordinal,
    );
}

export function taskMatchesQuery(task: AtlasTask, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  if (needle === `#${task.ordinal + 1}`) return true;
  return task.title.toLowerCase().includes(needle) || task.specialty.toLowerCase().includes(needle);
}

// ── Bulk actions ────────────────────────────────────────────────────────────

export type AtlasBulkAction = "publish" | "run" | "approve";

export interface AtlasBulkCandidate {
  readonly task: AtlasTask;
  /** Null when the action applies; otherwise why the task is skipped. */
  readonly skipReason: string | null;
  /** Whether the preview starts with this task checked. Never true when skipped. */
  readonly preselected: boolean;
  /** Extra context shown next to an eligible task in the preview. */
  readonly note: string | null;
}

function skip(task: AtlasTask, reason: string): AtlasBulkCandidate {
  return { task, skipReason: reason, preselected: false, note: null };
}

export function bulkCandidate(action: AtlasBulkAction, task: AtlasTask): AtlasBulkCandidate {
  // Publishing never touches a workspace, so it covers the whole plan,
  // including running and blocked tasks.
  if (action === "publish") {
    if (task.issue === null) return { task, skipReason: null, preselected: true, note: null };
    return task.issue.needsSync === true
      ? { task, skipReason: null, preselected: true, note: `Update #${task.issue.number}` }
      : skip(task, `Published as #${task.issue.number}`);
  }
  if (taskIsRunning(task)) return skip(task, "Running");
  switch (action) {
    case "approve": {
      if (task.status === "approved") return skip(task, "Already approved");
      if (task.status !== "needs_review" || !canDecideOnTask(task))
        return skip(task, `${taskStatusLabel(task.status)}, not awaiting review`);
      const verdict = task.agentReview?.outcome ?? null;
      // A reviewer that asked for changes must be overridden deliberately.
      return {
        task,
        skipReason: null,
        preselected: verdict !== "changes_requested",
        note:
          verdict === "approved"
            ? "Reviewer suggests approval"
            : verdict === "changes_requested"
              ? "Reviewer suggests changes"
              : "No agent review",
      };
    }
    case "run": {
      if (task.status === "approved") return skip(task, "Already approved");
      if (task.blockedBy.length > 0) return skip(task, "Blocked by unapproved dependencies");
      if (!canExecuteTask(task)) return skip(task, `${taskStatusLabel(task.status)}`);
      // A fresh worktree would drop the previous run's changes, so re-runs stay
      // a per-task decision where the workspace can be reused.
      if (task.execution !== null) return skip(task, "Has a previous run. Re-run it individually");
      return { task, skipReason: null, preselected: true, note: null };
    }
  }
}

/**
 * The tasks an action is offered for: the user's selection when there is one,
 * otherwise every task. Eligible candidates come first.
 */
export function bulkCandidates(
  action: AtlasBulkAction,
  tasks: ReadonlyArray<AtlasTask>,
  selection: ReadonlySet<AtlasTaskId>,
): ReadonlyArray<AtlasBulkCandidate> {
  const scope = selection.size > 0 ? tasks.filter((task) => selection.has(task.id)) : tasks;
  const candidates = scope.map((task) => bulkCandidate(action, task));
  return [
    ...candidates.filter((candidate) => candidate.skipReason === null),
    ...candidates.filter((candidate) => candidate.skipReason !== null),
  ];
}

export function eligibleCount(candidates: ReadonlyArray<AtlasBulkCandidate>): number {
  let count = 0;
  for (const candidate of candidates) if (candidate.skipReason === null) count += 1;
  return count;
}

/**
 * Runs `run` over `items` with at most `limit` calls in flight, reporting each
 * settled result as it lands. One failure never stops the rest.
 */
export async function runBounded<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  run: (item: T) => Promise<R>,
  onSettled?: (item: T, result: { ok: true; value: R } | { ok: false; error: unknown }) => void,
): Promise<ReadonlyArray<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index]!;
      let result: { ok: true; value: R } | { ok: false; error: unknown };
      try {
        result = { ok: true, value: await run(item) };
      } catch (error) {
        result = { ok: false, error };
      }
      results[index] = result;
      onSettled?.(item, result);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
