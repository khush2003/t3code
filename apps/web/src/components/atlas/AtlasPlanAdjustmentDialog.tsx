import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, AtlasTaskId, EnvironmentId } from "@t3tools/contracts";
import {
  ListPlusIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { atlasEnvironment } from "../../state/atlas";
import { useAtomCommand } from "../../state/use-atom-command";
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { AtlasStatusDot } from "./AtlasProgress";
import {
  adjustmentFromDraft,
  adjustmentIsEmpty,
  draftFromAdjustment,
  EMPTY_ADJUSTMENT_DRAFT,
  formatAdjustmentCounts,
  nextAdditionKey,
  taskFields,
  taskIsEditable,
  taskIsRemovable,
  validateDraft,
  type AtlasAdjustmentDraft,
  type AtlasDraftFields,
} from "./atlasAdjustmentLogic";

export type AtlasAdjustmentSource =
  | { readonly kind: "manual"; readonly focusTaskId: AtlasTaskId | null }
  | { readonly kind: "proposal" };

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  description: "description",
  specialty: "specialty",
  acceptanceCriteria: "criteria",
  dependsOn: "dependencies",
};

function initialDraft(
  initiative: AtlasInitiative,
  source: AtlasAdjustmentSource,
): AtlasAdjustmentDraft {
  if (source.kind === "proposal") {
    return initiative.planner.adjustment
      ? draftFromAdjustment(initiative, initiative.planner.adjustment)
      : EMPTY_ADJUSTMENT_DRAFT;
  }
  const focus = initiative.tasks.find((task) => task.id === source.focusTaskId);
  if (!focus) return EMPTY_ADJUSTMENT_DRAFT;
  if (taskIsEditable(focus)) {
    return { ...EMPTY_ADJUSTMENT_DRAFT, edits: { [focus.id]: taskFields(focus) } };
  }
  return {
    ...EMPTY_ADJUSTMENT_DRAFT,
    summary: `Follow-up to #${focus.ordinal + 1} ${focus.title}`,
    additions: [
      {
        key: "new-1",
        title: "",
        description: "",
        specialty: focus.specialty,
        acceptanceCriteria: [],
        dependsOn: [focus.id],
      },
    ],
  };
}

function DraftFieldsEditor({
  idPrefix,
  value,
  onChange,
  dependencyOptions,
}: {
  readonly idPrefix: string;
  readonly value: AtlasDraftFields;
  readonly onChange: (next: AtlasDraftFields) => void;
  readonly dependencyOptions: ReadonlyArray<{ readonly ref: string; readonly label: string }>;
}) {
  const labelFor = new Map(dependencyOptions.map((option) => [option.ref, option.label]));
  const addable = dependencyOptions.filter((option) => !value.dependsOn.includes(option.ref));
  return (
    <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_12rem]">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-title`}>Title</Label>
        <Input
          id={`${idPrefix}-title`}
          size="sm"
          value={value.title}
          onChange={(event) => onChange({ ...value, title: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-specialty`}>Specialty</Label>
        <Input
          id={`${idPrefix}-specialty`}
          size="sm"
          value={value.specialty}
          onChange={(event) => onChange({ ...value, specialty: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5 @lg:col-span-2">
        <Label htmlFor={`${idPrefix}-description`}>Description</Label>
        <Textarea
          id={`${idPrefix}-description`}
          value={value.description}
          onChange={(event) => onChange({ ...value, description: event.target.value })}
        />
      </div>
      <div className="flex flex-col gap-1.5 @lg:col-span-2">
        <Label htmlFor={`${idPrefix}-criteria`}>Acceptance criteria, one per line</Label>
        <Textarea
          id={`${idPrefix}-criteria`}
          value={value.acceptanceCriteria.join("\n")}
          onChange={(event) =>
            onChange({ ...value, acceptanceCriteria: event.target.value.split("\n") })
          }
        />
      </div>
      <div className="flex flex-col gap-1.5 @lg:col-span-2">
        <span className="font-medium text-sm">Needs approved first</span>
        <p className="text-muted-foreground text-xs">
          Only list tasks whose output this one cannot start without. Fewer edges, more parallel
          work.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {value.dependsOn.map((ref) => (
            <Badge key={ref} variant="outline">
              {labelFor.get(ref) ?? "Removed task"}
              <button
                type="button"
                aria-label={`Remove dependency ${labelFor.get(ref) ?? ref}`}
                className="-mr-1 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onClick={() =>
                  onChange({
                    ...value,
                    dependsOn: value.dependsOn.filter((entry) => entry !== ref),
                  })
                }
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
          {addable.length > 0 ? (
            <Select
              value={null}
              onValueChange={(ref) => {
                if (typeof ref === "string")
                  onChange({ ...value, dependsOn: [...value.dependsOn, ref] });
              }}
            >
              <SelectTrigger size="compact" variant="ghost" aria-label="Add dependency">
                <SelectValue placeholder="Add dependency" />
              </SelectTrigger>
              <SelectPopup>
                {addable.map((option) => (
                  <SelectItem key={option.ref} value={option.ref}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null}
          {value.dependsOn.length === 0 ? (
            <span className="text-muted-foreground text-xs">None. Can start right away.</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Edits the remaining plan as a patch: change unstarted tasks, add follow-ups,
 * remove untouched work. The initiative is snapshotted when the dialog opens so
 * polling never shifts what the user is editing; the revision captured then is
 * what the server checks on apply.
 */
export function AtlasPlanAdjustmentDialog({
  environmentId,
  initiative: liveInitiative,
  source,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly source: AtlasAdjustmentSource;
  readonly onClose: () => void;
}) {
  const applyPlanAdjustment = useAtomCommand(atlasEnvironment.applyPlanAdjustment, {
    reportFailure: false,
  });
  const canApply = useAtomValue(atlasEnvironment.applyPlanAdjustment.permissionAtom(environmentId));
  const [snapshot, setSnapshot] = useState(liveInitiative);
  const [baseRevision, setBaseRevision] = useState(
    source.kind === "proposal"
      ? (liveInitiative.planner.baseRevision ?? liveInitiative.planRevision)
      : liveInitiative.planRevision,
  );
  const [draft, setDraft] = useState(() => initialDraft(liveInitiative, source));
  const [editing, setEditing] = useState<ReadonlySet<string>>(
    () =>
      new Set(source.kind === "manual" && source.focusTaskId !== null ? [source.focusTaskId] : []),
  );
  const [onlyChanges, setOnlyChanges] = useState(source.kind === "proposal");
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stale = liveInitiative.planRevision !== baseRevision;
  const adjustment = adjustmentFromDraft(snapshot, draft);
  const problems = validateDraft(snapshot, draft);
  const changedFields = new Map(
    adjustment.updates.map((update) => [
      update.taskId as string,
      Object.keys(update)
        .filter((key) => key !== "taskId")
        .map((key) => FIELD_LABELS[key] ?? key),
    ]),
  );
  const removed = new Set<string>(draft.removals);

  const dependencyOptions = (self: string) => [
    ...snapshot.tasks
      .filter((task) => task.id !== self && !removed.has(task.id))
      .map((task) => ({
        ref: task.id as string,
        label: `#${task.ordinal + 1} ${draft.edits[task.id]?.title.trim() || task.title}`,
      })),
    ...draft.additions
      .filter((addition) => addition.key !== self)
      .map((addition, index) => ({
        ref: addition.key,
        label: `New: ${addition.title.trim() || `task ${index + 1}`}`,
      })),
  ];

  const setEdit = (taskId: string, fields: AtlasDraftFields) =>
    setDraft((previous) => ({ ...previous, edits: { ...previous.edits, [taskId]: fields } }));
  const discardEdit = (taskId: string) => {
    setDraft((previous) => {
      const edits = { ...previous.edits };
      delete edits[taskId];
      return { ...previous, edits };
    });
    setEditing((previous) => {
      const updated = new Set(previous);
      updated.delete(taskId);
      return updated;
    });
  };
  const toggleRemoval = (taskId: AtlasTaskId) =>
    setDraft((previous) => ({
      ...previous,
      removals: previous.removals.includes(taskId)
        ? previous.removals.filter((id) => id !== taskId)
        : [...previous.removals, taskId],
    }));
  const addTask = (dependsOn: ReadonlyArray<string>, specialty = "") =>
    setDraft((previous) => ({
      ...previous,
      additions: [
        ...previous.additions,
        {
          key: nextAdditionKey(previous),
          title: "",
          description: "",
          specialty,
          acceptanceCriteria: [],
          dependsOn,
        },
      ],
    }));
  const removeAddition = (key: string) =>
    setDraft((previous) => ({
      ...previous,
      additions: previous.additions
        .filter((addition) => addition.key !== key)
        .map((addition) => ({
          ...addition,
          dependsOn: addition.dependsOn.filter((ref) => ref !== key),
        })),
      edits: Object.fromEntries(
        Object.entries(previous.edits).map(([id, fields]) => [
          id,
          { ...fields, dependsOn: fields.dependsOn.filter((ref) => ref !== key) },
        ]),
      ),
    }));

  const restartFromLatest = () => {
    setSnapshot(liveInitiative);
    setBaseRevision(liveInitiative.planRevision);
    setDraft(EMPTY_ADJUSTMENT_DRAFT);
    setEditing(new Set());
    setError(null);
  };

  const apply = async () => {
    setApplying(true);
    setError(null);
    const result = await applyPlanAdjustment({
      environmentId,
      input: { initiativeId: snapshot.id, expectedPlanRevision: baseRevision, adjustment },
    });
    setApplying(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(
          failure instanceof Error && failure.message.trim().length > 0
            ? failure.message
            : "The request failed.",
        );
      }
      return;
    }
    onClose();
  };

  const rows = snapshot.tasks.filter(
    (task) =>
      !onlyChanges || changedFields.has(task.id) || removed.has(task.id) || editing.has(task.id),
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !applying) onClose();
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {source.kind === "proposal" ? "Review plan adjustment" : "Adjust plan"}
          </DialogTitle>
          <DialogDescription>
            Change the remaining work without replanning. Started tasks keep their results and
            history; add a follow-up to change their scope.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="@container flex flex-col gap-5">
            {stale ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/8 px-3 py-2 text-sm"
              >
                <TriangleAlertIcon className="size-4 shrink-0 text-warning-foreground" />
                <span className="min-w-0 flex-1">
                  {source.kind === "proposal"
                    ? "The plan changed after this proposal was prepared. Ask the planning agent again before applying."
                    : "The plan changed while you were editing. Start again from the latest plan to apply."}
                </span>
                {source.kind === "manual" ? (
                  <Button size="xs" variant="outline" onClick={restartFromLatest}>
                    <RotateCcwIcon />
                    Start from latest
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="atlas-adjust-summary">Why is the plan changing?</Label>
              <Textarea
                id="atlas-adjust-summary"
                value={draft.summary}
                placeholder="What did completed work show, and what should change?"
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, summary: event.target.value }))
                }
              />
            </div>

            <section className="flex flex-col gap-2" aria-label="Existing tasks">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-sm">Existing tasks</h3>
                <Button
                  size="xs"
                  variant="ghost-muted"
                  onClick={() => setOnlyChanges((previous) => !previous)}
                >
                  {onlyChanges ? `Show all ${snapshot.tasks.length}` : "Show only changes"}
                </Button>
              </div>
              {rows.length === 0 ? (
                <p className="text-muted-foreground text-xs">No existing tasks change.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {rows.map((task) => {
                    const editable = taskIsEditable(task);
                    const isRemoved = removed.has(task.id);
                    const isEditing = editing.has(task.id) && !isRemoved;
                    const changes = changedFields.get(task.id);
                    return (
                      <li key={task.id} className={cn("min-w-0", isRemoved && "bg-destructive/4")}>
                        <div className="flex min-h-9 items-center gap-2 px-3 py-1">
                          <AtlasStatusDot status={task.status} />
                          <span className="w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
                            #{task.ordinal + 1}
                          </span>
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-sm",
                              isRemoved && "text-muted-foreground line-through",
                            )}
                          >
                            {draft.edits[task.id]?.title.trim() || task.title}
                          </span>
                          {isRemoved ? (
                            <span className="shrink-0 text-destructive-foreground text-xs">
                              Removed
                            </span>
                          ) : changes && changes.length > 0 ? (
                            <span className="shrink-0 text-info-foreground text-xs">
                              Changed {changes.join(", ")}
                            </span>
                          ) : null}
                          {!editable ? (
                            <>
                              <span className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
                                <LockIcon className="size-3" />
                                Started
                              </span>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => addTask([task.id], task.specialty)}
                              >
                                <ListPlusIcon />
                                Follow-up
                              </Button>
                            </>
                          ) : isRemoved ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => toggleRemoval(task.id)}
                            >
                              <RotateCcwIcon />
                              Restore
                            </Button>
                          ) : (
                            <>
                              {isEditing ? (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => discardEdit(task.id)}
                                >
                                  <RotateCcwIcon />
                                  Discard
                                </Button>
                              ) : (
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => {
                                    if (!draft.edits[task.id]) setEdit(task.id, taskFields(task));
                                    setEditing((previous) => new Set(previous).add(task.id));
                                  }}
                                >
                                  <PencilIcon />
                                  Edit
                                </Button>
                              )}
                              <Button
                                size="icon-xs"
                                variant="ghost-destructive"
                                aria-label={
                                  taskIsRemovable(task)
                                    ? `Remove ${task.title}`
                                    : `${task.title} has a published issue and cannot be removed`
                                }
                                disabled={!taskIsRemovable(task)}
                                onClick={() => toggleRemoval(task.id)}
                              >
                                <Trash2Icon />
                              </Button>
                            </>
                          )}
                        </div>
                        {isEditing && draft.edits[task.id] ? (
                          <div className="border-t border-dashed px-3 py-3">
                            {task.issue ? (
                              <p className="mb-3 text-muted-foreground text-xs">
                                Issue #{task.issue.number} will be marked for update.
                              </p>
                            ) : null}
                            <DraftFieldsEditor
                              idPrefix={`atlas-adjust-${task.id}`}
                              value={draft.edits[task.id]!}
                              onChange={(fields) => setEdit(task.id, fields)}
                              dependencyOptions={dependencyOptions(task.id)}
                            />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="flex flex-col gap-2" aria-label="New tasks">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-sm">
                  New tasks{" "}
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {draft.additions.length}
                  </span>
                </h3>
                <Button size="xs" variant="outline" onClick={() => addTask([])}>
                  <PlusIcon />
                  Add task
                </Button>
              </div>
              {draft.additions.map((addition, index) => (
                <div key={addition.key} className="rounded-md border p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="font-medium text-sm">
                      {addition.title.trim() || `New task ${index + 1}`}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost-destructive"
                      aria-label="Discard new task"
                      onClick={() => removeAddition(addition.key)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  <DraftFieldsEditor
                    idPrefix={`atlas-adjust-${addition.key}`}
                    value={addition}
                    onChange={(fields) =>
                      setDraft((previous) => ({
                        ...previous,
                        additions: previous.additions.map((entry) =>
                          entry.key === addition.key ? { ...entry, ...fields } : entry,
                        ),
                      }))
                    }
                    dependencyOptions={dependencyOptions(addition.key)}
                  />
                </div>
              ))}
            </section>

            {problems.length > 0 && !adjustmentIsEmpty(adjustment) ? (
              <ul className="flex flex-col gap-1 text-warning-foreground text-xs">
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive-foreground text-sm">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <span className="mr-auto self-center text-muted-foreground text-xs">
            {formatAdjustmentCounts(adjustment)}
          </span>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={
              !canApply || applying || stale || problems.length > 0 || adjustmentIsEmpty(adjustment)
            }
            onClick={() => void apply()}
          >
            Apply adjustment
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
