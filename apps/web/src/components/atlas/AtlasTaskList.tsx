import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, AtlasTaskId, EnvironmentId } from "@t3tools/contracts";
import {
  CheckIcon,
  GitBranchIcon,
  ChevronRightIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";

import { atlasEnvironment } from "../../state/atlas";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { autoReviewLabel } from "./AtlasAutoReviewDialog";
import { AtlasBulkActionDialog } from "./AtlasBulkActionDialog";
import { AtlasTaskRow, type AtlasTaskPermissions } from "./AtlasTaskRow";
import {
  ATLAS_TASK_LANES,
  blockingTasks,
  bulkCandidates,
  eligibleCount,
  taskLane,
  taskMatchesQuery,
  taskReason,
  taskWaves,
  type AtlasBulkAction,
  type AtlasTaskLane,
} from "./atlasTaskListLogic";

export function AtlasTaskList({
  environmentId,
  initiative,
  onAdjust,
  onConfigureAutoReview,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly onAdjust: (taskId: AtlasTaskId | null) => void;
  readonly onConfigureAutoReview: () => void;
}) {
  const permissions: AtlasTaskPermissions = {
    execute: useAtomValue(atlasEnvironment.executeTask.permissionAtom(environmentId)),
    decide: useAtomValue(atlasEnvironment.approveTask.permissionAtom(environmentId)),
    review: useAtomValue(atlasEnvironment.startAgentReview.permissionAtom(environmentId)),
    publish: useAtomValue(atlasEnvironment.publishTaskIssue.permissionAtom(environmentId)),
    adjust: useAtomValue(atlasEnvironment.applyPlanAdjustment.permissionAtom(environmentId)),
  };
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<AtlasTaskId>>(new Set());
  const [collapsed, setCollapsed] = useState<ReadonlySet<AtlasTaskLane>>(new Set(["done"]));
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

  return (
    <section className="@container space-y-3" aria-label="Tasks">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 font-semibold text-base">
          Tasks{" "}
          <span className="font-normal text-muted-foreground tabular-nums">{tasks.length}</span>
        </h2>
        <div className="min-w-40 flex-1 @2xl:max-w-64">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              size="sm"
              type="search"
              aria-label="Filter tasks"
              placeholder="Filter by title, specialty, or #"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        </div>
        <Button size="sm" variant="ghost-muted" onClick={onConfigureAutoReview}>
          <ShieldCheckIcon />
          {autoReviewLabel(initiative)}
        </Button>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/32 px-2 py-1.5"
        role="toolbar"
        aria-label="Bulk actions"
      >
        <span className="px-1 text-muted-foreground text-xs" aria-live="polite">
          {selection.size > 0 ? (
            <>
              <span className="font-medium text-foreground tabular-nums">{selection.size}</span>{" "}
              selected
            </>
          ) : (
            "All tasks"
          )}
        </span>
        {selection.size > 0 ? (
          <Button size="xs" variant="ghost-muted" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            size="xs"
            variant="outline"
            disabled={counts.run === 0 || !permissions.execute}
            onClick={() => setBulk({ action: "run", selection })}
          >
            <PlayIcon />
            Run ready
            <span className="tabular-nums text-muted-foreground">{counts.run}</span>
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={counts.publish === 0 || !permissions.publish}
            onClick={() => setBulk({ action: "publish", selection })}
          >
            <SendIcon />
            {onlySyncs ? "Update issues" : "Publish issues"}
            <span className="tabular-nums text-muted-foreground">{counts.publish}</span>
          </Button>
          {counts.approve > 0 ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!permissions.decide}
              onClick={() => setBulk({ action: "approve", selection })}
            >
              <CheckIcon />
              Approve reviewed
              <span className="tabular-nums text-muted-foreground">{counts.approve}</span>
            </Button>
          ) : null}
        </span>
        <span className="sr-only">Actions apply to {scope} tasks.</span>
      </div>

      {bottleneck && bottleneck.blocks > 1 ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs">
          <GitBranchIcon className="size-3.5" />
          <span>
            <span className="font-medium text-foreground">
              #{bottleneck.task.ordinal + 1} {bottleneck.task.title}
            </span>{" "}
            holds back {bottleneck.blocks} tasks.
          </span>
          <Button size="xs" variant="link" onClick={() => onAdjust(null)}>
            Dependencies too strict? Adjust plan
          </Button>
        </p>
      ) : null}

      {lanes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
          No tasks match “{query}”.
        </p>
      ) : (
        <div className="overflow-clip rounded-lg border">
          {lanes.map(({ lane, label, tasks: laneTasks }) => {
            const isCollapsed = collapsed.has(lane) && query.trim().length === 0;
            const laneIds = laneTasks.map((task) => task.id);
            const selectedInLane = laneIds.filter((id) => selection.has(id)).length;
            return (
              <div key={lane} className="border-b last:border-b-0">
                <div className="sticky top-0 z-1 flex items-center gap-2.5 bg-muted px-3 py-1.5">
                  <Checkbox
                    aria-label={`Select all ${label.toLowerCase()} tasks`}
                    checked={selectedInLane > 0 && selectedInLane === laneIds.length}
                    indeterminate={selectedInLane > 0 && selectedInLane < laneIds.length}
                    onCheckedChange={(next) => setSelected(laneIds, next === true)}
                  />
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((previous) => {
                        const updated = new Set(previous);
                        if (updated.has(lane)) updated.delete(lane);
                        else updated.add(lane);
                        return updated;
                      })
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className={cn(
                        "size-3.5 text-muted-foreground transition-transform",
                        !isCollapsed && "rotate-90",
                      )}
                    />
                    <span
                      className={cn(
                        "font-medium text-xs",
                        lane === "attention" ? "text-warning-foreground" : "text-foreground",
                      )}
                    >
                      {label}
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {laneTasks.length}
                    </span>
                  </button>
                </div>
                {isCollapsed ? null : (
                  <ul className="divide-y">
                    {laneTasks.map((task) => (
                      <AtlasTaskRow
                        key={task.id}
                        environmentId={environmentId}
                        initiativeId={initiative.id}
                        projectId={initiative.projectId}
                        task={task}
                        byId={byId}
                        wave={waves.get(task.id) ?? 1}
                        reason={taskReason(task, byId)}
                        selected={selection.has(task.id)}
                        permissions={permissions}
                        onSelectedChange={onSelectedChange}
                        onAdjust={onAdjust}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

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
