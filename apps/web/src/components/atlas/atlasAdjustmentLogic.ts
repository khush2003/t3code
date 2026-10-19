import type {
  AtlasInitiative,
  AtlasPlanAdjustment,
  AtlasTask,
  AtlasTaskAddition,
  AtlasTaskId,
  AtlasTaskUpdate,
} from "@t3tools/contracts";

/**
 * Only unstarted proposals can change. Anything that has run, been reviewed,
 * or launched keeps its record; follow-up work is a new task. A published
 * issue does not freeze a task: editing it marks the issue for a sync.
 */
export function taskIsEditable(task: AtlasTask): boolean {
  return (
    task.status === "proposed" &&
    task.execution === null &&
    task.agentReview === null &&
    task.launch === null
  );
}

/** Removal would orphan a published issue, so only unpublished tasks qualify. */
export function taskIsRemovable(task: AtlasTask): boolean {
  return taskIsEditable(task) && task.issue === null;
}

export interface AtlasDraftFields {
  readonly title: string;
  readonly description: string;
  readonly specialty: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  /** Existing task ids or addition keys. */
  readonly dependsOn: ReadonlyArray<string>;
}

export interface AtlasDraftAddition extends AtlasDraftFields {
  readonly key: string;
}

/** A plan adjustment in edit form: full field values rather than a sparse patch. */
export interface AtlasAdjustmentDraft {
  readonly summary: string;
  readonly edits: Readonly<Record<string, AtlasDraftFields>>;
  readonly additions: ReadonlyArray<AtlasDraftAddition>;
  readonly removals: ReadonlyArray<AtlasTaskId>;
}

export const EMPTY_ADJUSTMENT_DRAFT: AtlasAdjustmentDraft = {
  summary: "",
  edits: {},
  additions: [],
  removals: [],
};

export function taskFields(task: AtlasTask): AtlasDraftFields {
  return {
    title: task.title,
    description: task.description,
    specialty: task.specialty,
    acceptanceCriteria: task.acceptanceCriteria,
    dependsOn: task.dependsOn,
  };
}

export function draftFromAdjustment(
  initiative: AtlasInitiative,
  adjustment: AtlasPlanAdjustment,
): AtlasAdjustmentDraft {
  const byId = new Map(initiative.tasks.map((task) => [task.id, task]));
  const edits: Record<string, AtlasDraftFields> = {};
  for (const update of adjustment.updates) {
    const task = byId.get(update.taskId);
    if (!task) continue;
    const current = taskFields(task);
    edits[update.taskId] = {
      title: update.title ?? current.title,
      description: update.description ?? current.description,
      specialty: update.specialty ?? current.specialty,
      acceptanceCriteria: update.acceptanceCriteria ?? current.acceptanceCriteria,
      dependsOn: update.dependsOn ?? current.dependsOn,
    };
  }
  return {
    summary: adjustment.summary,
    edits,
    additions: adjustment.additions.map((addition) => ({ ...addition })),
    removals: adjustment.removals.filter((id) => byId.has(id)),
  };
}

export function nextAdditionKey(draft: AtlasAdjustmentDraft): string {
  const used = new Set(draft.additions.map((addition) => addition.key));
  let index = draft.additions.length + 1;
  while (used.has(`new-${index}`)) index += 1;
  return `new-${index}`;
}

const clean = (values: ReadonlyArray<string>) =>
  values.map((value) => value.trim()).filter((value) => value.length > 0);

const sameList = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** The sparse patch the server applies: only fields that differ from the task. */
export function adjustmentFromDraft(
  initiative: AtlasInitiative,
  draft: AtlasAdjustmentDraft,
): AtlasPlanAdjustment {
  const removed = new Set(draft.removals);
  const updates: AtlasTaskUpdate[] = [];
  for (const task of initiative.tasks) {
    const edit = draft.edits[task.id];
    if (!edit || removed.has(task.id)) continue;
    const title = edit.title.trim();
    const description = edit.description.trim();
    const specialty = edit.specialty.trim();
    const acceptanceCriteria = clean(edit.acceptanceCriteria);
    const update: { -readonly [K in keyof AtlasTaskUpdate]: AtlasTaskUpdate[K] } = {
      taskId: task.id,
    };
    if (title !== task.title) update.title = title;
    if (description !== task.description) update.description = description;
    if (specialty !== task.specialty) update.specialty = specialty;
    if (!sameList(acceptanceCriteria, task.acceptanceCriteria))
      update.acceptanceCriteria = acceptanceCriteria;
    if (!sameList(edit.dependsOn, task.dependsOn)) update.dependsOn = edit.dependsOn;
    if (Object.keys(update).length > 1) updates.push(update);
  }
  const additions: AtlasTaskAddition[] = draft.additions.map((addition) => ({
    key: addition.key,
    title: addition.title.trim(),
    description: addition.description.trim(),
    specialty: addition.specialty.trim(),
    acceptanceCriteria: clean(addition.acceptanceCriteria),
    dependsOn: addition.dependsOn,
  }));
  return {
    summary: draft.summary.trim(),
    updates,
    additions,
    removals: draft.removals,
  };
}

export function adjustmentIsEmpty(adjustment: AtlasPlanAdjustment): boolean {
  return (
    adjustment.updates.length === 0 &&
    adjustment.additions.length === 0 &&
    adjustment.removals.length === 0
  );
}

/** Effective dependency graph after the draft, keyed by task id or addition key. */
function draftGraph(
  initiative: AtlasInitiative,
  draft: AtlasAdjustmentDraft,
): Map<string, ReadonlyArray<string>> {
  const removed = new Set<string>(draft.removals);
  const graph = new Map<string, ReadonlyArray<string>>();
  for (const task of initiative.tasks) {
    if (removed.has(task.id)) continue;
    graph.set(task.id, draft.edits[task.id]?.dependsOn ?? task.dependsOn);
  }
  for (const addition of draft.additions) graph.set(addition.key, addition.dependsOn);
  return graph;
}

/**
 * Problems the server would reject, reported in terms the user can fix before
 * applying. The server stays authoritative.
 */
export function validateDraft(
  initiative: AtlasInitiative,
  draft: AtlasAdjustmentDraft,
): ReadonlyArray<string> {
  const problems: string[] = [];
  const label = new Map<string, string>(
    initiative.tasks.map((task) => [task.id, `#${task.ordinal + 1} ${task.title}`]),
  );
  for (const addition of draft.additions) {
    label.set(addition.key, addition.title.trim() || "New task");
  }
  const checkFields = (name: string, fields: AtlasDraftFields) => {
    if (fields.title.trim().length === 0) problems.push(`${name} needs a title.`);
    if (fields.description.trim().length === 0) problems.push(`${name} needs a description.`);
    if (fields.specialty.trim().length === 0) problems.push(`${name} needs a specialty.`);
    if (clean(fields.acceptanceCriteria).length === 0)
      problems.push(`${name} needs at least one acceptance criterion.`);
  };
  for (const [id, fields] of Object.entries(draft.edits)) {
    if (!draft.removals.includes(id as AtlasTaskId)) checkFields(label.get(id) ?? id, fields);
  }
  draft.additions.forEach((addition, index) =>
    checkFields(addition.title.trim() || `New task ${index + 1}`, addition),
  );
  if (draft.summary.trim().length === 0) problems.push("Describe why the plan is changing.");

  const graph = draftGraph(initiative, draft);
  for (const [node, dependencies] of graph) {
    for (const dependency of dependencies) {
      if (!graph.has(dependency)) {
        problems.push(
          `${label.get(node) ?? node} depends on ${label.get(dependency) ?? "a removed task"}, which is removed.`,
        );
      }
    }
  }
  const state = new Map<string, "visiting" | "done">();
  let cycle = false;
  const visit = (node: string) => {
    if (cycle || state.get(node) === "done") return;
    if (state.get(node) === "visiting") {
      cycle = true;
      return;
    }
    state.set(node, "visiting");
    for (const dependency of graph.get(node) ?? []) if (graph.has(dependency)) visit(dependency);
    state.set(node, "done");
  };
  for (const node of graph.keys()) visit(node);
  if (cycle) problems.push("The dependencies form a cycle.");
  return problems;
}

export function adjustmentCounts(adjustment: AtlasPlanAdjustment): {
  readonly updated: number;
  readonly added: number;
  readonly removed: number;
} {
  return {
    updated: adjustment.updates.length,
    added: adjustment.additions.length,
    removed: adjustment.removals.length,
  };
}

export function formatAdjustmentCounts(adjustment: AtlasPlanAdjustment): string {
  const counts = adjustmentCounts(adjustment);
  const parts = [
    counts.added > 0 ? `${counts.added} added` : null,
    counts.updated > 0 ? `${counts.updated} changed` : null,
    counts.removed > 0 ? `${counts.removed} removed` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(", ") : "No changes";
}
