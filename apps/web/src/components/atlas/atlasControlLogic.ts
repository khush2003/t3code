import type { AtlasInitiative, ThreadId } from "@t3tools/contracts";
import type { PendingThreadRequests } from "@t3tools/client-runtime/state/thread-requests";
import { agentReviewStatusLabel, taskStatusLabel } from "./atlasLogic";

export interface AtlasAgentRow {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly running: boolean;
  readonly failed: boolean;
  readonly startedAt: string;
  readonly threadId: ThreadId;
}

export function collectAtlasAgentRows(initiative: AtlasInitiative): AtlasAgentRow[] {
  const rows: AtlasAgentRow[] = [];
  if (initiative.planner.threadId)
    rows.push({
      key: "planner",
      kind: "Planner",
      title: initiative.title,
      status:
        initiative.planner.status === "running"
          ? "Running"
          : initiative.planner.status === "completed"
            ? "Completed"
            : "Failed",
      running: initiative.planner.status === "running",
      failed: initiative.planner.status === "failed",
      startedAt: initiative.updatedAt,
      threadId: initiative.planner.threadId,
    });
  for (const task of initiative.tasks) {
    if (task.execution)
      rows.push({
        key: `${task.id}-exec`,
        kind: task.specialty,
        title: task.title,
        status: taskStatusLabel(task.status),
        running: task.execution.status === "running",
        failed: task.execution.status === "failed",
        startedAt: task.execution.startedAt,
        threadId: task.execution.threadId,
      });
    if (task.agentReview)
      rows.push({
        key: `${task.id}-review`,
        kind: "Reviewer",
        title: task.title,
        status: agentReviewStatusLabel(task.agentReview.status),
        running: task.agentReview.status === "running",
        failed: task.agentReview.status === "failed",
        startedAt: task.agentReview.startedAt,
        threadId: task.agentReview.threadId,
      });
  }
  return rows;
}

export function atlasAgentPriority(
  row: Pick<AtlasAgentRow, "running" | "failed">,
  pending: PendingThreadRequests | null,
): number {
  if (pending && pending.approvals.length + pending.userInputs.length > 0) return 0;
  if (row.running) return 1;
  return row.failed ? 2 : 3;
}
