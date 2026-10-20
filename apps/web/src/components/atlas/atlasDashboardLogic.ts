import type { AtlasInitiative, AtlasTask, ProjectId, ThreadId } from "@t3tools/contracts";

import { collectAtlasAgentRows } from "./atlasControlLogic";
import { reviewLaunchError, taskIsRunning } from "./atlasLogic";

export type AtlasAttentionKind =
  | "input"
  | "plan_ready"
  | "adjustment"
  | "planner_failed"
  | "review"
  | "review_failed"
  | "failed";

export interface AtlasAttentionItem {
  readonly key: string;
  readonly kind: AtlasAttentionKind;
  readonly initiative: AtlasInitiative;
  readonly task: AtlasTask | null;
  readonly label: string;
}

/** Ordered by how blocking each kind is: an agent waiting on input stalls work right now. */
const ATTENTION_RANK: Record<AtlasAttentionKind, number> = {
  input: 0,
  review: 1,
  adjustment: 2,
  plan_ready: 3,
  review_failed: 4,
  failed: 5,
  planner_failed: 6,
};

export function initiativeIsActive(initiative: AtlasInitiative): boolean {
  return (
    initiative.status === "planning" ||
    initiative.status === "plan_ready" ||
    initiative.status === "in_progress"
  );
}

/** Threads that can still raise approvals or questions, grouped by initiative. */
export function runningAgentThreads(
  initiatives: ReadonlyArray<AtlasInitiative>,
): ReadonlyArray<readonly [string, ReadonlyArray<ThreadId>]> {
  return initiatives.flatMap((initiative) => {
    const threads = collectAtlasAgentRows(initiative)
      .filter((row) => row.running)
      .map((row) => row.threadId);
    return threads.length > 0 ? [[initiative.id, threads] as const] : [];
  });
}

export function countRunningAgents(initiatives: ReadonlyArray<AtlasInitiative>): number {
  let running = 0;
  for (const initiative of initiatives) {
    for (const row of collectAtlasAgentRows(initiative)) if (row.running) running += 1;
  }
  return running;
}

export function collectAttentionItems(
  initiatives: ReadonlyArray<AtlasInitiative>,
  waitingByInitiative: ReadonlyMap<string, number>,
): ReadonlyArray<AtlasAttentionItem> {
  const items: AtlasAttentionItem[] = [];
  for (const initiative of initiatives) {
    const waiting = waitingByInitiative.get(initiative.id) ?? 0;
    if (waiting > 0) {
      items.push({
        key: `${initiative.id}:input`,
        kind: "input",
        initiative,
        task: null,
        label:
          waiting === 1 ? "An agent is waiting on you" : `${waiting} agents are waiting on you`,
      });
    }
    const { planner } = initiative;
    if (planner.status === "completed" && planner.mode === "adjust" && planner.adjustment) {
      items.push({
        key: `${initiative.id}:adjustment`,
        kind: "adjustment",
        initiative,
        task: null,
        label: "Plan adjustment proposed",
      });
    } else if (planner.status === "completed" && initiative.tasks.length === 0) {
      items.push({
        key: `${initiative.id}:plan`,
        kind: "plan_ready",
        initiative,
        task: null,
        label: "Plan ready to import",
      });
    } else if (planner.status === "failed") {
      items.push({
        key: `${initiative.id}:planner`,
        kind: "planner_failed",
        initiative,
        task: null,
        label: planner.mode === "adjust" ? "Plan adjustment failed" : "Planning failed",
      });
    }
    for (const task of initiative.tasks) {
      if (taskIsRunning(task)) continue;
      if (reviewLaunchError(task) !== null) {
        items.push({
          key: `${task.id}:review-launch`,
          kind: "review_failed",
          initiative,
          task,
          label: "Review could not start",
        });
      } else if (task.status === "needs_review") {
        items.push({
          key: `${task.id}:review`,
          kind: "review",
          initiative,
          task,
          label: "Ready for review",
        });
      } else if (task.status === "failed") {
        items.push({ key: `${task.id}:failed`, kind: "failed", initiative, task, label: "Failed" });
      }
    }
  }
  return items.toSorted(
    (left, right) =>
      ATTENTION_RANK[left.kind] - ATTENTION_RANK[right.kind] ||
      right.initiative.updatedAt.localeCompare(left.initiative.updatedAt),
  );
}

export interface AtlasProjectSummary {
  readonly initiatives: ReadonlyArray<AtlasInitiative>;
  readonly active: number;
  readonly running: number;
  readonly approved: number;
  readonly total: number;
  readonly lastActivityAt: string | null;
}

const EMPTY_SUMMARY: AtlasProjectSummary = {
  initiatives: [],
  active: 0,
  running: 0,
  approved: 0,
  total: 0,
  lastActivityAt: null,
};

export function summarizeProject(
  initiatives: ReadonlyArray<AtlasInitiative>,
  projectId: ProjectId,
): AtlasProjectSummary {
  const own = initiatives.filter((initiative) => initiative.projectId === projectId);
  if (own.length === 0) return EMPTY_SUMMARY;
  let active = 0;
  let approved = 0;
  let total = 0;
  let lastActivityAt: string | null = null;
  for (const initiative of own) {
    if (initiativeIsActive(initiative)) active += 1;
    total += initiative.tasks.length;
    approved += initiative.tasks.filter((task) => task.status === "approved").length;
    if (lastActivityAt === null || initiative.updatedAt > lastActivityAt) {
      lastActivityAt = initiative.updatedAt;
    }
  }
  return {
    initiatives: own,
    active,
    running: countRunningAgents(own),
    approved,
    total,
    lastActivityAt,
  };
}

/** Projects with Atlas work come first, most recent activity on top; the rest by name. */
export function orderProjectsByActivity<
  P extends { readonly id: ProjectId; readonly title: string },
>(
  projects: ReadonlyArray<P>,
  summaries: ReadonlyMap<ProjectId, AtlasProjectSummary>,
): ReadonlyArray<P> {
  return projects.toSorted((left, right) => {
    const leftAt = summaries.get(left.id)?.lastActivityAt ?? null;
    const rightAt = summaries.get(right.id)?.lastActivityAt ?? null;
    if (leftAt !== rightAt) {
      if (leftAt === null) return 1;
      if (rightAt === null) return -1;
      return rightAt.localeCompare(leftAt);
    }
    return left.title.localeCompare(right.title);
  });
}

export function describeProjectSummary(summary: AtlasProjectSummary): string {
  const count = summary.initiatives.length;
  if (count === 0) return "No initiatives yet";
  const parts = [`${count} initiative${count === 1 ? "" : "s"}`];
  if (summary.running > 0) parts.push(`${summary.running} running`);
  else if (summary.active > 0) parts.push(`${summary.active} active`);
  return parts.join(" · ");
}

export type AtlasInitiativeFilter = "all" | "active" | "draft" | "completed";

export function initiativeMatchesFilter(
  initiative: AtlasInitiative,
  filter: AtlasInitiativeFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "active":
      return initiativeIsActive(initiative);
    case "draft":
      return initiative.status === "draft";
    case "completed":
      return initiative.status === "completed";
  }
}

export function filterInitiatives(
  initiatives: ReadonlyArray<AtlasInitiative>,
  filter: AtlasInitiativeFilter,
  query: string,
): ReadonlyArray<AtlasInitiative> {
  const needle = query.trim().toLowerCase();
  return initiatives.filter(
    (initiative) =>
      initiativeMatchesFilter(initiative, filter) &&
      (needle.length === 0 ||
        initiative.title.toLowerCase().includes(needle) ||
        initiative.brief.toLowerCase().includes(needle)),
  );
}

export function overviewHeadline(input: {
  readonly waiting: number;
  readonly running: number;
  readonly active: number;
}): string {
  if (input.waiting > 0 && input.running > 0) {
    return `${input.running} agent${input.running === 1 ? " is" : "s are"} working and ${input.waiting} thing${input.waiting === 1 ? " needs" : "s need"} your attention.`;
  }
  if (input.waiting > 0) {
    return `${input.waiting} thing${input.waiting === 1 ? " needs" : "s need"} your attention.`;
  }
  if (input.running > 0) {
    return `${input.running} agent${input.running === 1 ? " is" : "s are"} working. Nothing needs you right now.`;
  }
  if (input.active > 0) return "Nothing is running. Pick up where you left off.";
  return "Everything is wrapped up. Start something new.";
}
