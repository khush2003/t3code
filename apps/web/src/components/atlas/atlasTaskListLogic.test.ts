import type { AtlasTask, AtlasTaskId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  blockingTasks,
  bulkCandidates,
  runBounded,
  taskLane,
  taskReason,
  taskWaves,
} from "./atlasTaskListLogic";

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

const execution = (status: "running" | "completed") => ({
  threadId: "thread-1" as ThreadId,
  runId: "run-1" as RunId,
  status,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: status === "completed" ? "2026-01-01T00:10:00.000Z" : null,
  result: null,
});

const review = (outcome: "approved" | "changes_requested") => ({
  threadId: "thread-2" as ThreadId,
  runId: "run-2" as RunId,
  status: "completed" as const,
  outcome,
  feedback: null,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:10:00.000Z",
  result: null,
  autoApplyVerdict: false,
});

describe("taskLane", () => {
  it("puts each task in the lane that names its next step", () => {
    expect(taskLane(task({ id: id("a") }))).toBe("ready");
    expect(taskLane(task({ id: id("a"), blockedBy: [id("b")] }))).toBe("blocked");
    expect(
      taskLane(task({ id: id("a"), status: "running", execution: execution("running") })),
    ).toBe("running");
    expect(
      taskLane(task({ id: id("a"), status: "needs_review", execution: execution("completed") })),
    ).toBe("attention");
    expect(taskLane(task({ id: id("a"), status: "failed" }))).toBe("attention");
    expect(taskLane(task({ id: id("a"), status: "approved" }))).toBe("done");
  });
});

describe("taskWaves", () => {
  it("assigns each task one wave after its deepest dependency", () => {
    const waves = taskWaves([
      task({ id: id("design") }),
      task({ id: id("scaffold"), dependsOn: [id("design")] }),
      task({ id: id("logic") }),
      task({ id: id("hud"), dependsOn: [id("scaffold"), id("logic")] }),
    ]);
    expect([...waves.entries()]).toEqual([
      [id("design"), 1],
      [id("scaffold"), 2],
      [id("logic"), 1],
      [id("hud"), 3],
    ]);
  });

  it("terminates on a cycle", () => {
    const waves = taskWaves([
      task({ id: id("a"), dependsOn: [id("b")] }),
      task({ id: id("b"), dependsOn: [id("a")] }),
    ]);
    expect(waves.size).toBe(2);
  });
});

describe("taskReason", () => {
  it("names the blocking tasks and their state", () => {
    const blocker = task({ id: id("design"), ordinal: 0, status: "needs_review" });
    const blocked = task({ id: id("scaffold"), ordinal: 1, blockedBy: [id("design")] });
    const byId = new Map([blocker, blocked].map((entry) => [entry.id, entry]));
    expect(taskReason(blocked, byId).text).toBe("Waiting on #1 needs review");
  });
});

describe("blockingTasks", () => {
  it("ranks unapproved tasks by how many tasks they hold back", () => {
    const tasks = [
      task({ id: id("design"), ordinal: 0, status: "needs_review" }),
      task({ id: id("scaffold"), ordinal: 1, blockedBy: [id("design")] }),
      task({ id: id("scene"), ordinal: 2, blockedBy: [id("design"), id("scaffold")] }),
    ];
    expect(blockingTasks(tasks).map(({ task, blocks }) => [task.id, blocks])).toEqual([
      [id("design"), 2],
      [id("scaffold"), 1],
    ]);
  });
});

describe("bulkCandidates", () => {
  const tasks = [
    task({
      id: id("approved-by-agent"),
      status: "needs_review",
      execution: execution("completed"),
      agentReview: review("approved"),
    }),
    task({
      id: id("agent-wants-changes"),
      status: "needs_review",
      execution: execution("completed"),
      agentReview: review("changes_requested"),
    }),
    task({ id: id("unreviewed"), status: "needs_review", execution: execution("completed") }),
    task({ id: id("running"), status: "running", execution: execution("running") }),
    task({ id: id("blocked"), blockedBy: [id("unreviewed")] }),
    task({ id: id("ready") }),
    task({ id: id("done"), status: "approved" }),
  ];

  it("never preselects approving over a reviewer's objection", () => {
    const candidates = bulkCandidates("approve", tasks, new Set());
    const byId = new Map(candidates.map((candidate) => [candidate.task.id, candidate]));
    expect(byId.get(id("approved-by-agent"))).toMatchObject({
      skipReason: null,
      preselected: true,
    });
    expect(byId.get(id("agent-wants-changes"))).toMatchObject({
      skipReason: null,
      preselected: false,
    });
    expect(byId.get(id("running"))?.skipReason).toBe("Running");
    expect(byId.get(id("done"))?.skipReason).toBe("Already approved");
  });

  it("runs only unblocked tasks without previous work", () => {
    const eligible = bulkCandidates("run", tasks, new Set())
      .filter((candidate) => candidate.skipReason === null)
      .map((candidate) => candidate.task.id);
    expect(eligible).toEqual([id("ready")]);
  });

  it("limits the scope to the selection and publishes running tasks too", () => {
    const candidates = bulkCandidates("publish", tasks, new Set([id("ready"), id("running")]));
    expect(candidates.map((candidate) => [candidate.task.id, candidate.skipReason])).toEqual([
      [id("running"), null],
      [id("ready"), null],
    ]);
  });
});

describe("runBounded", () => {
  it("caps concurrency and keeps going past failures", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await runBounded([1, 2, 3, 4, 5], 2, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      if (value === 3) throw new Error("boom");
      return value * 10;
    });
    expect(peak).toBe(2);
    expect(results.map((result) => (result.ok ? result.value : "failed"))).toEqual([
      10,
      20,
      "failed",
      40,
      50,
    ]);
  });
});
