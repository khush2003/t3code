import type { AtlasTask, AtlasTaskId } from "@t3tools/contracts";
import {
  CheckIcon,
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
import type { AtlasTaskReason } from "./atlasTaskListLogic";

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
  permissions,
  onSelectedChange,
  onOpen,
  onAction,
}: {
  readonly task: AtlasTask;
  readonly byId: ReadonlyMap<AtlasTaskId, AtlasTask>;
  readonly reason: AtlasTaskReason;
  readonly selected: boolean;
  readonly permissions: AtlasTaskPermissions;
  readonly onSelectedChange: (taskId: AtlasTaskId, selected: boolean) => void;
  readonly onOpen: (taskId: AtlasTaskId) => void;
  readonly onAction: (taskId: AtlasTaskId, kind: AtlasTaskDialogKind) => void;
}) {
  const action = taskPrimaryAction(task);
  const needsYou = task.status === "needs_review" || task.status === "failed";
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

  return (
    <li
      className={cn(
        "relative flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground transition-colors hover:border-foreground/20",
        needsYou && "border-warning/45 bg-warning/5",
        task.status === "failed" && "border-destructive/35 bg-destructive/4",
        selected && "ring-2 ring-primary/40",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="relative z-1 flex">
          <Checkbox
            aria-label={`Select ${task.title}`}
            checked={selected}
            onCheckedChange={(next) => onSelectedChange(task.id, next === true)}
          />
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">#{task.ordinal + 1}</span>
        <AtlasTaskStatusPill task={task} />
        <span className="ml-auto min-w-0 truncate text-muted-foreground text-xs">
          {task.specialty}
        </span>
      </div>

      <div className="min-w-0 space-y-1">
        <h3 className="font-medium text-sm leading-snug">
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className="line-clamp-2 text-left outline-none wrap-anywhere after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            {task.title}
          </button>
        </h3>
        <p className={cn("line-clamp-1 text-xs", REASON_TONE[reason.tone])}>{reason.text}</p>
      </div>

      {task.deliverable ? (
        <p className="flex min-w-0 items-start gap-2 rounded-lg bg-muted/48 px-2.5 py-2 text-xs">
          <PackageIcon aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
          <span className="line-clamp-1 wrap-anywhere">
            <span className="sr-only">Deliverable: </span>
            {task.deliverable}
          </span>
        </p>
      ) : (
        <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed wrap-anywhere">
          {task.description}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <ArtifactSummary task={task} />
        <span className="flex items-center gap-1 text-muted-foreground">
          <ListChecksIcon aria-hidden className="size-3.5" />
          {task.acceptanceCriteria.length}
          {task.acceptanceCriteria.length === 1 ? " criterion" : " criteria"}
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
              render={<a href={task.issue.url} target="_blank" rel="noreferrer" />}
            >
              #{task.issue.number}
              {task.issue.needsSync === true ? (
                <span aria-hidden className="size-1.5 rounded-full bg-warning" />
              ) : null}
              {task.issue.needsSync === true ? (
                <span className="sr-only">, needs update</span>
              ) : null}
            </Button>
          ) : null}
          {primary}
        </span>
      </div>
    </li>
  );
}
