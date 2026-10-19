import type {
  AtlasInitiative,
  AtlasInitiativeId,
  AtlasTask,
  AtlasTaskId,
  ProjectId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  adjustmentFromDraft,
  draftFromAdjustment,
  taskFields,
  taskIsEditable,
  taskIsRemovable,
  validateDraft,
  type AtlasAdjustmentDraft,
} from "./atlasAdjustmentLogic";

const id = (value: string) => value as AtlasTaskId;

function task(overrides: Partial<AtlasTask> & { id: AtlasTaskId }): AtlasTask {
  return {
    ordinal: 0,
    title: "Task",
    description: "Do it",
    specialty: "backend",
    acceptanceCriteria: ["Works"],
    dependsOn: [],
    blockedBy: [],
    status: "proposed",
    issue: null,
    execution: null,
    agentReview: null,
    humanDecision: { outcome: "pending", feedback: null, decidedAt: null },
    launch: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function initiative(tasks: ReadonlyArray<AtlasTask>): AtlasInitiative {
  return {
    id: "initiative-1" as AtlasInitiativeId,
    projectId: "project-1" as ProjectId,
    title: "Puzzle",
    brief: "Build it",
    deliverables: [],
    status: "in_progress",
    planSummary: null,
    planRevision: 3,
    autoReview: null,
    planner: {
      status: "completed",
      threadId: null,
      runId: null,
      error: null,
      launch: null,
      mode: "plan",
      baseRevision: null,
      instructions: null,
      adjustment: null,
    },
    tasks,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const design = task({
  id: id("design"),
  ordinal: 0,
  title: "Design",
  status: "needs_review",
  execution: {
    threadId: "thread-1" as ThreadId,
    runId: "run-1" as RunId,
    status: "completed",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:10:00.000Z",
    result: null,
  },
});
const scaffold = task({
  id: id("scaffold"),
  ordinal: 1,
  title: "Scaffold",
  dependsOn: [id("design")],
});
const logic = task({ id: id("logic"), ordinal: 2, title: "Logic", dependsOn: [id("scaffold")] });
const plan = initiative([design, scaffold, logic]);

describe("taskIsEditable", () => {
  it("locks any task that has started", () => {
    expect(taskIsEditable(scaffold)).toBe(true);
    expect(taskIsEditable(design)).toBe(false);
  });

  it("keeps published tasks editable but not removable", () => {
    const published = task({
      id: id("published"),
      issue: {
        number: 7,
        url: "https://github.com/o/r/issues/7",
        publishedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(taskIsEditable(published)).toBe(true);
    expect(taskIsRemovable(published)).toBe(false);
  });
});

describe("adjustmentFromDraft", () => {
  it("sends only the fields that changed", () => {
    const draft: AtlasAdjustmentDraft = {
      summary: " Logic does not need the scaffold ",
      edits: {
        [logic.id]: { ...taskFields(logic), dependsOn: [] },
        [scaffold.id]: taskFields(scaffold),
      },
      additions: [],
      removals: [],
    };
    expect(adjustmentFromDraft(plan, draft)).toEqual({
      summary: "Logic does not need the scaffold",
      updates: [{ taskId: logic.id, dependsOn: [] }],
      additions: [],
      removals: [],
    });
  });

  it("round-trips a planner proposal", () => {
    const proposal = {
      summary: "Split the HUD out",
      updates: [{ taskId: logic.id, title: "Session logic" }],
      additions: [
        {
          key: "hud",
          title: "HUD",
          description: "Draw it",
          specialty: "frontend",
          acceptanceCriteria: ["Visible"],
          dependsOn: [design.id],
        },
      ],
      removals: [],
    };
    expect(adjustmentFromDraft(plan, draftFromAdjustment(plan, proposal))).toEqual(proposal);
  });
});

describe("validateDraft", () => {
  it("flags dependents of a removed task", () => {
    const problems = validateDraft(plan, {
      summary: "Drop the scaffold",
      edits: {},
      additions: [],
      removals: [scaffold.id],
    });
    expect(problems).toEqual(["#3 Logic depends on #2 Scaffold, which is removed."]);
  });

  it("flags a cycle through a new task", () => {
    const problems = validateDraft(plan, {
      summary: "Loop",
      edits: { [scaffold.id]: { ...taskFields(scaffold), dependsOn: ["new-1"] } },
      additions: [
        {
          key: "new-1",
          title: "New",
          description: "x",
          specialty: "x",
          acceptanceCriteria: ["x"],
          dependsOn: [logic.id],
        },
      ],
      removals: [],
    });
    expect(problems).toContain("The dependencies form a cycle.");
  });
});
