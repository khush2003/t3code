import type { AtlasTask, AtlasTaskId } from "@t3tools/contracts";
import {
  ArrowRightLeftIcon,
  CheckIcon,
  CircleDotIcon,
  EyeIcon,
  FileIcon,
  FileTextIcon,
  GitBranchIcon,
  GlobeIcon,
  ImageIcon,
  LinkIcon,
  ListChecksIcon,
  PackageIcon,
  PlayIcon,
  RotateCwIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import type { AtlasTaskDialogKind, AtlasTaskPermissions } from "./AtlasTaskActions";
import {
  summarizeArtifacts,
  taskPrimaryAction,
  taskStatusPill,
  type AtlasArtifactGroup,
  type AtlasPillTone,
} from "./atlasArtifactLogic";
import { runFailure } from "./atlasLogic";
import { taskTone, type AtlasTaskReason } from "./atlasTaskListLogic";
import { TONE_DOT, TONE_SOFT } from "./atlasTone";

export const REASON_TONE: Record<AtlasTaskReason["tone"], string> = {
  muted: "text-muted-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive-foreground",
  success: "text-success-foreground",
};

const PILL_VARIANT: Record<AtlasPillTone, "secondary" | "info" | "warning" | "success" | "error"> =
  {
    neutral: "secondary",
    info: "info",
    warning: "warning",
    success: "success",
    error: "error",
  };

export const ARTIFACT_GROUP_ICON: Record<AtlasArtifactGroup, LucideIcon> = {
  doc: FileTextIcon,
  image: ImageIcon,
  page: GlobeIcon,
  link: LinkIcon,
  file: FileIcon,
};

export function AtlasTaskStatusPill({ task }: { readonly task: AtlasTask }) {
  const pill = taskStatusPill(task);
  return <Badge variant={PILL_VARIANT[pill.tone]}>{pill.label}</Badge>;
}

/** A quieter status mark for dense surfaces: a dot and a label, no chip. */
export function AtlasTaskStatusLabel({ task }: { readonly task: AtlasTask }) {
  return (
    <span className="flex items-center gap-1.5 font-medium text-xs">
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[taskTone(task)])}
      />
      {taskStatusPill(task).label}
    </span>
  );
}

function ArtifactSummary({ task }: { readonly task: AtlasTask }) {
  const execution = task.execution;
  if (execution === null || execution.status === "running") return null;
  const groups = summarizeArtifacts(execution.artifacts);
  if (groups.length === 0) {
    return <span className="text-muted-foreground">Summary and code changes</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
      {groups.map(({ group, label }) => {
        const Icon = ARTIFACT_GROUP_ICON[group];
        return (
          <span key={group} className="flex items-center gap-1 text-foreground">
            <Icon aria-hidden className="size-3.5 text-muted-foreground" />
            {label}
          </span>
        );
      })}
    </span>
  );
}

/**
 * One task as a card. The whole card opens the task sheet; the checkbox, issue
 * link, and primary action sit above that hit area.
 */
export function AtlasTaskCard({
  task,
  byId,
  reason,
  selected,
  selecting = false,
  permissions,
  onSelectedChange,
  onOpen,
  onAction,
}: {
  readonly task: AtlasTask;
  readonly byId: ReadonlyMap<AtlasTaskId, AtlasTask>;
  readonly reason: AtlasTaskReason;
  readonly selected: boolean;
  /** Any task is selected, so every checkbox stays visible. */
  readonly selecting?: boolean;
  readonly permissions: AtlasTaskPermissions;
  readonly onSelectedChange: (taskId: AtlasTaskId, selected: boolean) => void;
  readonly onOpen: (taskId: AtlasTaskId) => void;
  readonly onAction: (taskId: AtlasTaskId, kind: AtlasTaskDialogKind) => void;
}) {
  const action = taskPrimaryAction(task);
  const pill = taskStatusPill(task);
  const rateLimited = runFailure(task)?.kind === "rate_limit";
  const dependencies = task.dependsOn.flatMap((id) => {
    const dependency = byId.get(id);
    return dependency ? [dependency] : [];
  });

  const primary =
    action === "review" ? (
      <Button size="xs" onClick={() => onOpen(task.id)}>
        <EyeIcon />
        Review
      </Button>
    ) : action === "approve" ? (
      <Button size="xs" disabled={!permissions.decide} onClick={() => onAction(task.id, "approve")}>
        <CheckIcon />
        Approve
      </Button>
    ) : action === "continue" ? (
      <Button
        size="xs"
        variant={rateLimited ? "default" : "outline"}
        disabled={!permissions.continue}
        onClick={() => onAction(task.id, "continue")}
      >
        {rateLimited ? <ArrowRightLeftIcon /> : <RotateCwIcon />}
        {rateLimited ? "Switch model" : "Continue"}
      </Button>
    ) : action === "run" || action === "rerun" ? (
      <Button
        size="xs"
        variant="outline"
        disabled={!permissions.execute}
        onClick={() => onAction(task.id, "run")}
      >
        <PlayIcon />
        {action === "rerun" ? "Re-run" : "Run"}
      </Button>
    ) : null;

  const tone = taskTone(task);
  return (
    <li
      className={cn(
        "group relative flex min-w-0 flex-col gap-3.5 rounded-2xl bg-atlas-surface p-4 text-atlas-ink shadow-xs/5 ring-1 ring-border/70 transition-[translate,box-shadow] hover:-translate-y-0.5 hover:shadow-lg/8",
        selected && "ring-2 ring-atlas-brand/60",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs",
            TONE_SOFT[tone],
          )}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
          {pill.label}
        </span>
        <span className="truncate text-muted-foreground text-xs">{task.specialty}</span>
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          #{task.ordinal + 1}
        </span>
        <span
          className={cn(
            "relative z-1 flex transition-opacity",
            !selected &&
              !selecting &&
              "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
          )}
        >
          <Checkbox
            aria-label={`Select ${task.title}`}
            checked={selected}
            onCheckedChange={(next) => onSelectedChange(task.id, next === true)}
          />
        </span>
      </div>

      <div className="min-w-0 space-y-1.5">
        <h3 className="font-semibold text-base leading-snug tracking-tight">
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className="line-clamp-2 text-left outline-none wrap-anywhere after:absolute after:inset-0 after:rounded-2xl focus-visible:after:ring-2 focus-visible:after:ring-atlas-brand focus-visible:after:ring-inset"
          >
            {task.title}
          </button>
        </h3>
        <p
          className={cn(
            "line-clamp-2 text-sm leading-relaxed wrap-anywhere",
            REASON_TONE[reason.tone],
          )}
        >
          {reason.text}
        </p>
      </div>

      {task.deliverable ? (
        <p className="flex min-w-0 items-start gap-2 rounded-xl bg-atlas-canvas px-3 py-2 text-muted-foreground text-xs leading-relaxed">
          <PackageIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="line-clamp-2 wrap-anywhere">
            <span className="sr-only">Deliverable: </span>
            {task.deliverable}
          </span>
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <ArtifactSummary task={task} />
        <span className="flex items-center gap-1 text-muted-foreground">
          <ListChecksIcon aria-hidden className="size-3.5" />
          {task.acceptanceCriteria.length}
          <span className="sr-only">
            {task.acceptanceCriteria.length === 1 ? " criterion" : " criteria"}
          </span>
        </span>
        {dependencies.length > 0 && task.blockedBy.length === 0 ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <GitBranchIcon aria-hidden className="size-3.5" />
            After {dependencies.map((dependency) => `#${dependency.ordinal + 1}`).join(", ")}
          </span>
        ) : null}
        <span className="relative z-1 ml-auto flex items-center gap-1.5">
          {task.issue ? (
            <Button
              size="xs"
              variant="ghost-muted"
              aria-label={`Issue #${task.issue.number}${task.issue.needsSync === true ? ", needs update" : ""}`}
              render={<a href={task.issue.url} target="_blank" rel="noreferrer" />}
            >
              <CircleDotIcon />
              {task.issue.number}
              {task.issue.needsSync === true ? (
                <span aria-hidden className="size-1.5 rounded-full bg-atlas-waiting" />
              ) : null}
            </Button>
          ) : null}
          {primary}
        </span>
      </div>
    </li>
  );
}
