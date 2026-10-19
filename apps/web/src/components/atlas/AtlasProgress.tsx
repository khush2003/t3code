import type { AtlasTask, AtlasTaskStatus } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { taskStatusLabel } from "./atlasLogic";

const TASK_STATUS_TONE: Record<AtlasTaskStatus, string> = {
  proposed: "bg-muted-foreground/30",
  running: "bg-info",
  needs_review: "bg-warning",
  changes_requested: "bg-warning/55",
  approved: "bg-success",
  failed: "bg-destructive",
};

// Finished work fills from the left so the strip reads as progress.
const STRIP_ORDER: ReadonlyArray<AtlasTaskStatus> = [
  "approved",
  "needs_review",
  "changes_requested",
  "running",
  "proposed",
  "failed",
];

export function AtlasStatusDot({
  status,
  className,
}: {
  readonly status: AtlasTaskStatus;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        TASK_STATUS_TONE[status],
        className,
      )}
    />
  );
}

export function AtlasProgressStrip({
  tasks,
  size = "default",
  legend = false,
}: {
  readonly tasks: ReadonlyArray<AtlasTask>;
  readonly size?: "default" | "sm";
  readonly legend?: boolean;
}) {
  const ordered = STRIP_ORDER.flatMap((status) => tasks.filter((task) => task.status === status));
  const present = STRIP_ORDER.flatMap((status) => {
    const count = tasks.filter((task) => task.status === status).length;
    return count > 0 ? [{ status, count }] : [];
  });
  const summary =
    present.length === 0
      ? "No tasks"
      : present.map(({ status, count }) => `${count} ${taskStatusLabel(status)}`).join(", ");

  return (
    <div className="min-w-0 space-y-2">
      <div
        role="img"
        aria-label={summary}
        className={cn("flex w-full gap-px", size === "sm" ? "h-1" : "h-2")}
      >
        {ordered.length === 0 ? (
          <span className="h-full flex-1 rounded-full bg-muted-foreground/15" />
        ) : (
          ordered.map((task) => (
            <span
              key={task.id}
              className={cn(
                "h-full min-w-0 flex-1 first:rounded-l-full last:rounded-r-full",
                TASK_STATUS_TONE[task.status],
              )}
            />
          ))
        )}
      </div>
      {legend && present.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          {present.map(({ status, count }) => (
            <li key={status} className="flex items-center gap-1.5">
              <AtlasStatusDot status={status} />
              <span className="tabular-nums text-foreground">{count}</span>
              {taskStatusLabel(status).toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
