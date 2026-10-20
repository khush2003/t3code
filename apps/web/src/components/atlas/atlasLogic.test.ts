import type { AtlasTask, AtlasTaskId, ThreadId, RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canDecideOnTask,
  canExecuteTask,
  canStartAgentReview,
  parseAtlasPlanJson,
  taskCounts,
  taskStatusBadgeVariant,
} from "./atlasLogic";

function task(overrides: Partial<AtlasTask> = {}): AtlasTask {
  return {
    id: "task-1" as AtlasTaskId,
    ordinal: 0,
    title: "Add the thing",
    description: "",
    specialty: "backend",
    deliverable: null,
    acceptanceCriteria: ["It works"],
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

const finishedExecution = {
  threadId: "thread-1" as ThreadId,
  runId: "run-1" as RunId,
  status: "completed" as const,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:10:00.000Z",
  result: "done",
  artifacts: [],
};

describe("parseAtlasPlanJson", () => {
  it("parses a well-formed plan", () => {
    const result = parseAtlasPlanJson(
      JSON.stringify({
        summary: "Ship it",
        tasks: [
          {
            key: "a",
            title: "First",
            description: "Do the first thing.",
            specialty: "backend",
            acceptanceCriteria: ["works"],
            dependsOn: [],
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.tasks[0]?.description).toBe("Do the first thing.");
    }
  });

  it("rejects invalid JSON", () => {
    const result = parseAtlasPlanJson("{not json");
    expect(result.ok).toBe(false);
  });

  it("requires a summary", () => {
    const result = parseAtlasPlanJson(JSON.stringify({ summary: "", tasks: [] }));
    expect(result.ok).toBe(false);
  });

  it("requires a non-empty description per task", () => {
    const result = parseAtlasPlanJson(
      JSON.stringify({
        summary: "s",
        tasks: [
          {
            key: "a",
            title: "t",
            specialty: "backend",
            acceptanceCriteria: ["works"],
            dependsOn: [],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("description");
  });

  it("requires at least one acceptance criterion per task", () => {
    const result = parseAtlasPlanJson(
      JSON.stringify({
        summary: "s",
        tasks: [
          {
            key: "a",
            title: "t",
            description: "Do the thing.",
            specialty: "backend",
            acceptanceCriteria: [],
            dependsOn: [],
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("task actions", () => {
  it("allows executing a proposed, unblocked task", () => {
    expect(canExecuteTask(task())).toBe(true);
  });

  it("blocks execution while dependencies are unapproved", () => {
    expect(canExecuteTask(task({ blockedBy: ["task-0" as AtlasTaskId] }))).toBe(false);
  });

  it("does not review an approved task", () => {
    expect(canStartAgentReview(task({ status: "approved", execution: finishedExecution }))).toBe(
      false,
    );
  });

  it("offers decisions for reviewable work and lets a human revise approval", () => {
    expect(canDecideOnTask(task({ status: "proposed" }))).toBe(false);
    expect(canDecideOnTask(task({ status: "needs_review" }))).toBe(true);
    expect(canDecideOnTask(task({ status: "approved", execution: finishedExecution }))).toBe(true);
  });
});

describe("taskCounts", () => {
  it("counts approved, running, and ready tasks", () => {
    const counts = taskCounts([
      task({ status: "approved" }),
      task({ id: "task-2" as AtlasTaskId, status: "running" }),
      task({ id: "task-3" as AtlasTaskId, status: "proposed" }),
    ]);
    expect(counts).toEqual({ total: 3, approved: 1, running: 1, ready: 1 });
  });
});

describe("taskStatusBadgeVariant", () => {
  it("maps failed to error and approved to success", () => {
    expect(taskStatusBadgeVariant("failed")).toBe("error");
    expect(taskStatusBadgeVariant("approved")).toBe("success");
  });
});
