import type { AtlasInitiative, EnvironmentId } from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { agentReviewStatusLabel, taskStatusLabel } from "./atlasLogic";

interface AgentRow {
  readonly key: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly badge: "info" | "success" | "error" | "warning" | "outline";
  readonly startedAt: string;
  readonly threadId: string;
}

function collectAgentRows(initiative: AtlasInitiative): ReadonlyArray<AgentRow> {
  const rows: AgentRow[] = [];
  if (initiative.planner.threadId) {
    rows.push({
      key: "planner",
      kind: "Planner",
      title: initiative.title,
      status:
        initiative.planner.status === "running"
          ? "Running"
          : initiative.planner.status === "completed"
            ? "Completed"
            : initiative.planner.status === "failed"
              ? "Failed"
              : "Idle",
      badge:
        initiative.planner.status === "failed"
          ? "error"
          : initiative.planner.status === "completed"
            ? "success"
            : "info",
      startedAt: initiative.updatedAt,
      threadId: initiative.planner.threadId,
    });
  }
  for (const task of initiative.tasks) {
    if (task.execution) {
      rows.push({
        key: `${task.id}-exec`,
        kind: "Task run",
        title: task.title,
        status: taskStatusLabel(task.status),
        badge:
          task.execution.status === "failed"
            ? "error"
            : task.execution.status === "completed"
              ? "success"
              : "info",
        startedAt: task.execution.startedAt,
        threadId: task.execution.threadId,
      });
    }
    if (task.agentReview) {
      rows.push({
        key: `${task.id}-review`,
        kind: "Agent review",
        title: task.title,
        status: agentReviewStatusLabel(task.agentReview.status),
        badge:
          task.agentReview.status === "failed"
            ? "error"
            : task.agentReview.outcome === "changes_requested"
              ? "warning"
              : task.agentReview.status === "completed"
                ? "success"
                : "info",
        startedAt: task.agentReview.startedAt,
        threadId: task.agentReview.threadId,
      });
    }
  }
  return rows;
}

/**
 * The real agents working on this initiative. Every row is a linked provider
 * thread launched by the server; there is no synthesized activity.
 */
export function AtlasAgentControlPane({
  environmentId,
  initiative,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
}) {
  const rows = collectAgentRows(initiative);
  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <p className="font-medium text-sm">Agent control</p>
        <p className="text-muted-foreground text-xs">Follow agent progress and review results.</p>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-muted-foreground text-sm">
          No agents have run for this initiative yet.
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={row.key} className="space-y-1 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">{row.kind}</span>
                <Badge variant={row.badge}>{row.status}</Badge>
              </div>
              <p className="truncate text-sm">{row.title}</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs">
                  {formatRelativeTimeLabel(row.startedAt)}
                </span>
                <Button
                  size="sm"
                  variant="link"
                  render={
                    <Link
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: row.threadId }}
                    />
                  }
                >
                  Open
                  <ExternalLinkIcon />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
