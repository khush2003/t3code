import type { AtlasTask, AtlasTaskStatus } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { taskTone, type AtlasTone } from "./atlasTaskListLogic";
import { TONE_DOT } from "./atlasTone";

const TASK_STATUS_TONE: Record<AtlasTaskStatus, string> = {
  proposed: "bg-muted-foreground/30",
  running: "bg-info",
  needs_review: "bg-warning",
  changes_requested: "bg-warning/55",
  approved: "bg-success",
  failed: "bg-destructive",
};

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

const STRIP_TONES: ReadonlyArray<{ readonly tone: AtlasTone; readonly label: string }> = [
  { tone: "done", label: "done" },
  { tone: "attention", label: "need you" },
  { tone: "waiting", label: "rate limited" },
  { tone: "running", label: "running" },
  { tone: "ready", label: "up next" },
  { tone: "blocked", label: "blocked" },
];

/** Finished work fills from the left, so the strip reads as progress. */
export function AtlasProgressStrip({
  tasks,
  size = "default",
  legend = false,
}: {
  readonly tasks: ReadonlyArray<AtlasTask>;
  readonly size?: "default" | "sm" | "lg";
  readonly legend?: boolean;
}) {
  const tones = tasks.map((task) => ({ task, tone: taskTone(task) }));
  const present = STRIP_TONES.flatMap(({ tone, label }) => {
    const count = tones.filter((entry) => entry.tone === tone).length;
    return count > 0 ? [{ tone, label, count }] : [];
  });
  const summary =
    present.length === 0
      ? "No tasks"
      : present.map(({ label, count }) => `${count} ${label}`).join(", ");

  return (
    <div className="min-w-0 space-y-2.5">
      <div
        role="img"
        aria-label={summary}
        className={cn(
          "flex w-full overflow-hidden rounded-full bg-muted/64",
          size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2",
        )}
      >
        {present.map(({ tone, count }) => (
          <span
            key={tone}
            className={cn("h-full border-atlas-surface border-e-2 last:border-e-0", TONE_DOT[tone])}
            style={{ flexGrow: count, flexBasis: 0 }}
          />
        ))}
      </div>
      {legend && present.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
          {present.map(({ tone, label, count }) => (
            <li key={tone} className="flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2 rounded-full", TONE_DOT[tone])} />
              <span className="font-medium text-atlas-ink tabular-nums">{count}</span>
              {label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
