import type { AtlasInitiative, AtlasTaskId, EnvironmentId } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  CheckIcon,
  CheckCheckIcon,
  EyeIcon,
  GaugeIcon,
  GitBranchIcon,
  ListChecksIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { autoReviewLabel } from "./AtlasAutoReviewDialog";
import { AtlasBulkActionDialog } from "./AtlasBulkActionDialog";
import {
  AtlasTaskActionDialog,
  useAtlasTaskPermissions,
  type AtlasTaskDialogKind,
} from "./AtlasTaskActions";
import { AtlasTaskCard } from "./AtlasTaskCard";
import { AtlasTaskDrawer } from "./AtlasTaskDrawer";
import {
  ATLAS_TASK_LANES,
  LANE_TONE,
  blockingTasks,
  bulkCandidates,
  eligibleCount,
  nextStep,
  taskLane,
  taskMatchesQuery,
  taskReason,
  taskWaves,
  type AtlasBulkAction,
  type AtlasTaskLane,
  type AtlasTone,
} from "./atlasTaskListLogic";
import { TONE_DOT, TONE_RING, TONE_SOFT } from "./atlasTone";

const EMPTY_LANE: Record<AtlasTaskLane, string> = {
  attention: "Nothing needs you. Reviews, failures, and agent questions land here.",
  running: "No agents are working right now.",
  ready: "Nothing is ready to start. Tasks arrive here once their dependencies are approved.",
  blocked: "Nothing is blocked.",
  done: "No approved tasks yet.",
};

function NextStepIcon({ tone }: { readonly tone: AtlasTone }) {
  const Icon =
    tone === "waiting"
      ? GaugeIcon
      : tone === "attention"
        ? EyeIcon
        : tone === "ready"
          ? PlayIcon
          : tone === "done"
            ? CheckCheckIcon
            : tone === "blocked"
              ? TriangleAlertIcon
              : SparklesIcon;
  return <Icon className="size-5" />;
}

export function AtlasTaskList({
  environmentId,
  initiative,
  openTaskId,
  onOpenTask,
  onAdjust,
  onConfigureAutoReview,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  /** The task whose sheet is open; it lives in the URL so links and back work. */
  readonly openTaskId: string | null;
  readonly onOpenTask: (taskId: AtlasTaskId | null) => void;
  readonly onAdjust: (taskId: AtlasTaskId | null) => void;
  readonly onConfigureAutoReview: () => void;
}) {
  const permissions = useAtlasTaskPermissions(environmentId);
  const [pendingAction, setPendingAction] = useState<{
    readonly taskId: AtlasTaskId;
    readonly kind: AtlasTaskDialogKind;
  } | null>(null);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<AtlasTaskId>>(new Set());
  const [activeLane, setActiveLane] = useState<AtlasTaskLane | null>(null);
  const [bulk, setBulk] = useState<{
    readonly action: AtlasBulkAction;
    readonly selection: ReadonlySet<AtlasTaskId>;
  } | null>(null);

  const tasks = initiative.tasks;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  // Selection survives polling but drops tasks a plan adjustment removed.
  const selection = new Set([...selectedIds].filter((id) => byId.has(id)));
  const waves = taskWaves(tasks);
  const visible = tasks.filter((task) => taskMatchesQuery(task, query));
  const lanes = ATLAS_TASK_LANES.flatMap(({ lane, label }) => {
    const laneTasks = visible
      .filter((task) => taskLane(task) === lane)
      .toSorted(
        (left, right) =>
          (waves.get(left.id) ?? 1) - (waves.get(right.id) ?? 1) || left.ordinal - right.ordinal,
      );
    return laneTasks.length > 0 ? [{ lane, label, tasks: laneTasks }] : [];
  });
  const bottleneck = blockingTasks(tasks)[0] ?? null;

  const setSelected = (ids: ReadonlyArray<AtlasTaskId>, next: boolean) =>
    setSelectedIds((previous) => {
      const updated = new Set(previous);
      for (const id of ids) {
        if (next) updated.add(id);
        else updated.delete(id);
      }
      return updated;
    });
  const onSelectedChange = (taskId: AtlasTaskId, next: boolean) => setSelected([taskId], next);
  const onAction = (taskId: AtlasTaskId, kind: AtlasTaskDialogKind) =>
    setPendingAction({ taskId, kind });

  const openTask = openTaskId === null ? null : (byId.get(openTaskId as AtlasTaskId) ?? null);
  const actionTask = pendingAction ? (byId.get(pendingAction.taskId) ?? null) : null;
  const actionDialog =
    pendingAction && actionTask ? (
      <AtlasTaskActionDialog
        key={`${actionTask.id}:${pendingAction.kind}`}
        environmentId={environmentId}
        initiativeId={initiative.id}
        projectId={initiative.projectId}
        task={actionTask}
        kind={pendingAction.kind}
        onClose={() => setPendingAction(null)}
      />
    ) : null;

  const publishCandidates = bulkCandidates("publish", tasks, selection).filter(
    (candidate) => candidate.skipReason === null,
  );
  const onlySyncs =
    publishCandidates.length > 0 && publishCandidates.every((candidate) => candidate.task.issue);
  const counts = {
    run: eligibleCount(bulkCandidates("run", tasks, selection)),
    publish: publishCandidates.length,
    approve: eligibleCount(bulkCandidates("approve", tasks, selection)),
  };
  const scope = selection.size > 0 ? "selected" : "all";

  const step = nextStep(tasks);
  const laneCounts = new Map(
    ATLAS_TASK_LANES.map(({ lane }) => [
      lane,
      visible.filter((task) => taskLane(task) === lane).length,
    ]),
  );
  const firstFilled = ATLAS_TASK_LANES.find(({ lane }) => (laneCounts.get(lane) ?? 0) > 0)?.lane;
  // An explicit tab wins; otherwise land on the most urgent group that has work.
  const lane = activeLane ?? firstFilled ?? "attention";
  const laneTasks = lanes.find((candidate) => candidate.lane === lane)?.tasks ?? [];
  const laneIds = laneTasks.map((task) => task.id);
  const selectedInLane = laneIds.filter((id) => selection.has(id)).length;

  const runStep = () => {
    if (!step?.action) return;
    if (step.action === "run_ready") setBulk({ action: "run", selection: new Set() });
    else if (step.task && step.action === "continue") onAction(step.task.id, "continue");
    else if (step.task && step.action === "rerun") onAction(step.task.id, "run");
    else if (step.task) onOpenTask(step.task.id);
  };

  return (
    <section className="@container space-y-5" aria-label="Tasks">
      {step ? (
        <div
          className={cn(
            "flex flex-col gap-4 rounded-3xl p-5 ring-1 sm:flex-row sm:items-center sm:p-6",
            TONE_SOFT[step.tone],
            TONE_RING[step.tone],
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-2xl text-atlas-surface shadow-sm/10",
              TONE_DOT[step.tone],
            )}
          >
            <NextStepIcon tone={step.tone} />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-pretty font-semibold text-atlas-ink text-lg leading-snug tracking-tight">
              {step.title}
            </p>
            <p className="line-clamp-2 text-atlas-ink/72 text-sm leading-relaxed wrap-anywhere">
              {step.detail}
            </p>
          </div>
          {step.action && step.actionLabel ? (
            <button
              type="button"
              onClick={runStep}
              disabled={
                (step.action === "continue" && !permissions.continue) ||
                (step.action === "rerun" && !permissions.execute) ||
                (step.action === "run_ready" && !permissions.execute)
              }
              className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-full bg-atlas-ink px-5 py-2.5 font-semibold text-atlas-surface text-sm shadow-md/12 outline-none transition-[translate,box-shadow,scale] hover:-translate-y-px hover:shadow-lg/14 focus-visible:ring-2 focus-visible:ring-atlas-brand focus-visible:ring-inset active:translate-y-0 active:scale-97 disabled:pointer-events-none disabled:opacity-50 sm:self-center"
            >
              {step.actionLabel}
              <ArrowRightIcon aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="Task groups"
          className="flex max-w-full gap-1 overflow-x-auto rounded-2xl bg-atlas-surface p-1 shadow-xs/4 ring-1 ring-border/70"
        >
          {ATLAS_TASK_LANES.map(({ lane: id, label }) => {
            const count = laneCounts.get(id) ?? 0;
            const selected = id === lane;
            const tone = LANE_TONE[id];
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveLane(id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-atlas-brand focus-visible:ring-inset",
                  selected
                    ? cn("text-atlas-ink", TONE_SOFT[tone])
                    : "text-muted-foreground hover:bg-muted/56 hover:text-foreground",
                  count === 0 && !selected && "opacity-60",
                )}
              >
                <span aria-hidden className={cn("size-2 rounded-full", TONE_DOT[tone])} />
                {label}
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums",
                    selected ? "bg-atlas-surface/80" : "bg-muted/64",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">
          <div className="w-48 max-w-full">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                size="sm"
                type="search"
                aria-label="Filter tasks"
                placeholder="Find a task"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </InputGroup>
          </div>
          <Button size="sm" variant="ghost-muted" onClick={onConfigureAutoReview}>
            <ShieldCheckIcon />
            <span className="max-sm:sr-only">{autoReviewLabel(initiative)}</span>
          </Button>
          <Menu>
            <MenuTrigger render={<Button size="sm" variant="outline" />}>
              <ListChecksIcon />
              {selection.size > 0 ? `${selection.size} selected` : "Bulk actions"}
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem
                disabled={counts.run === 0 || !permissions.execute}
                onClick={() => setBulk({ action: "run", selection })}
              >
                <PlayIcon />
                Run ready tasks
                <span className="ml-auto ps-4 text-muted-foreground tabular-nums">
                  {counts.run}
                </span>
              </MenuItem>
              <MenuItem
                disabled={counts.approve === 0 || !permissions.decide}
                onClick={() => setBulk({ action: "approve", selection })}
              >
                <CheckIcon />
                Approve reviewed
                <span className="ml-auto ps-4 text-muted-foreground tabular-nums">
                  {counts.approve}
                </span>
              </MenuItem>
              <MenuItem
                disabled={counts.publish === 0 || !permissions.publish}
                onClick={() => setBulk({ action: "publish", selection })}
              >
                <SendIcon />
                {onlySyncs ? "Update GitHub issues" : "Publish GitHub issues"}
                <span className="ml-auto ps-4 text-muted-foreground tabular-nums">
                  {counts.publish}
                </span>
              </MenuItem>
              {selection.size > 0 ? (
                <MenuItem onClick={() => setSelectedIds(new Set())}>
                  <XIcon />
                  Clear selection
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
        </div>
        <span className="sr-only" aria-live="polite">
          Bulk actions apply to {scope} tasks.
        </span>
      </div>

      {bottleneck && bottleneck.blocks > 1 && lane === "blocked" ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-sm">
          <GitBranchIcon aria-hidden className="size-4" />
          <span>
            <span className="font-medium text-foreground">
              #{bottleneck.task.ordinal + 1} {bottleneck.task.title}
            </span>{" "}
            holds back {bottleneck.blocks} tasks.
          </span>
          <Button size="xs" variant="link" onClick={() => onAdjust(null)}>
            Loosen dependencies
          </Button>
        </p>
      ) : null}

      {laneTasks.length === 0 ? (
        <div className="rounded-3xl border border-dashed px-6 py-10 text-center">
          <p className="font-medium text-sm">
            {query.trim().length > 0
              ? `No ${ATLAS_TASK_LANES.find((entry) => entry.lane === lane)?.label.toLowerCase()} tasks match “${query}”.`
              : EMPTY_LANE[lane]}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <label className="flex w-fit items-center gap-2 px-1 text-muted-foreground text-xs">
            <Checkbox
              aria-label="Select every task in this group"
              checked={selectedInLane > 0 && selectedInLane === laneIds.length}
              indeterminate={selectedInLane > 0 && selectedInLane < laneIds.length}
              onCheckedChange={(next) => setSelected(laneIds, next === true)}
            />
            Select all
          </label>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3.5">
            {laneTasks.map((task) => (
              <AtlasTaskCard
                key={task.id}
                task={task}
                byId={byId}
                reason={taskReason(task, byId)}
                selected={selection.has(task.id)}
                selecting={selection.size > 0}
                permissions={permissions}
                onSelectedChange={onSelectedChange}
                onOpen={onOpenTask}
                onAction={onAction}
              />
            ))}
          </ul>
        </div>
      )}

      <AtlasTaskDrawer
        environmentId={environmentId}
        initiativeId={initiative.id}
        projectId={initiative.projectId}
        task={openTask}
        byId={byId}
        reason={openTask ? taskReason(openTask, byId) : null}
        permissions={permissions}
        onClose={() => onOpenTask(null)}
        onOpenTask={onOpenTask}
        onAction={onAction}
        onAdjust={(taskId) => {
          onOpenTask(null);
          onAdjust(taskId);
        }}
      >
        {openTask ? actionDialog : null}
      </AtlasTaskDrawer>
      {openTask ? null : actionDialog}

      {bulk ? (
        <AtlasBulkActionDialog
          environmentId={environmentId}
          initiative={initiative}
          action={bulk.action}
          selection={bulk.selection}
          onClose={() => setBulk(null)}
          onConfigureAutoReview={onConfigureAutoReview}
        />
      ) : null}
    </section>
  );
}
