import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { AtlasInitiative, AtlasInitiativeStatus, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import { AtlasProgressStrip } from "./AtlasProgress";
import { initiativeStatusLabel, taskCounts } from "./atlasLogic";

const INITIATIVE_STATUS_TONE: Record<AtlasInitiativeStatus, string> = {
  draft: "bg-muted-foreground/40",
  planning: "bg-info",
  plan_ready: "bg-warning",
  in_progress: "bg-info",
  completed: "bg-success",
};

export function AtlasInitiativeStatusLabel({
  initiative,
}: {
  readonly initiative: AtlasInitiative;
}) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", INITIATIVE_STATUS_TONE[initiative.status])}
      />
      {initiativeStatusLabel(initiative)}
    </span>
  );
}

export function AtlasInitiativeCard({
  environmentId,
  initiative,
  project,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  /** Shown when the card appears outside its project's own view. */
  readonly project?: EnvironmentProject | undefined;
}) {
  const counts = taskCounts(initiative.tasks);
  return (
    <Link
      to="/atlas"
      search={{ environmentId, projectId: initiative.projectId, initiativeId: initiative.id }}
      className="group flex w-full min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground outline-none transition-colors hover:border-foreground/20 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <div className="flex items-center justify-between gap-3">
        <AtlasInitiativeStatusLabel initiative={initiative} />
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {formatRelativeTimeLabel(initiative.updatedAt)}
        </span>
      </div>
      <div className="min-w-0 space-y-1">
        <h3 className="line-clamp-2 font-medium text-sm leading-snug wrap-anywhere">
          {initiative.title}
        </h3>
        <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed wrap-anywhere">
          {initiative.brief}
        </p>
      </div>
      <div className="mt-auto space-y-2 pt-1">
        <AtlasProgressStrip tasks={initiative.tasks} size="sm" />
        <div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
          {project ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <ProjectFavicon project={project} className="size-3.5 shrink-0" />
              <span className="truncate">{project.title}</span>
            </span>
          ) : (
            <span>
              {counts.total === 0
                ? "No tasks yet"
                : `${counts.total} task${counts.total === 1 ? "" : "s"}`}
            </span>
          )}
          <span className="flex shrink-0 items-center gap-2 tabular-nums">
            {counts.running > 0 ? (
              <span className="text-info-foreground">{counts.running} running</span>
            ) : null}
            {counts.total > 0 ? (
              <span>
                {counts.approved}/{counts.total}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </Link>
  );
}
