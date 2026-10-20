import type {
  AtlasArtifact,
  AtlasTask,
  AtlasTaskExecution,
  AtlasTaskId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  artifactRelativePath,
  artifactViewer,
  defaultDeliverableKey,
  deliverableEntries,
  isHttpUrl,
  latestCheckpointTurnCount,
  summarizeArtifacts,
  taskPrimaryAction,
  taskStatusPill,
} from "./atlasArtifactLogic";

const id = (value: string) => value as AtlasTaskId;

function task(overrides: Partial<AtlasTask> = {}): AtlasTask {
  return {
    id: id("a"),
    ordinal: 0,
    title: "Task",
    description: "Do it",
    specialty: "backend",
    deliverable: null,
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

function execution(
  status: AtlasTaskExecution["status"],
  artifacts: ReadonlyArray<AtlasArtifact> = [],
): AtlasTaskExecution {
  return {
    threadId: "thread-1" as ThreadId,
    runId: "run-1" as RunId,
    status,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-01-01T00:10:00.000Z",
    result: null,
    artifacts,
  };
}

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

describe("taskStatusPill", () => {
  it("names the state the way a reviewer reads it", () => {
    expect(taskStatusPill(task()).label).toBe("Ready to run");
    expect(taskStatusPill(task({ blockedBy: [id("b")] })).label).toBe("Blocked");
    expect(taskStatusPill(task({ status: "running", execution: execution("running") }))).toEqual({
      label: "Agent working",
      tone: "info",
    });
    expect(
      taskStatusPill(
        task({
          status: "needs_review",
          execution: execution("completed"),
          agentReview: { ...review("approved"), status: "running", outcome: null },
        }),
      ).label,
    ).toBe("Agent reviewing");
    expect(taskStatusPill(task({ status: "needs_review" }))).toEqual({
      label: "Needs your review",
      tone: "warning",
    });
    expect(taskStatusPill(task({ status: "failed" })).tone).toBe("error");
    expect(taskStatusPill(task({ status: "approved" })).tone).toBe("success");
  });
});

describe("taskPrimaryAction", () => {
  it("offers one next step per task", () => {
    expect(taskPrimaryAction(task())).toBe("run");
    expect(taskPrimaryAction(task({ blockedBy: [id("b")] }))).toBeNull();
    expect(
      taskPrimaryAction(task({ status: "changes_requested", execution: execution("completed") })),
    ).toBe("rerun");
    expect(
      taskPrimaryAction(task({ status: "needs_review", execution: execution("completed") })),
    ).toBe("review");
    expect(
      taskPrimaryAction(
        task({
          status: "needs_review",
          execution: execution("completed"),
          agentReview: review("approved"),
        }),
      ),
    ).toBe("approve");
    expect(
      taskPrimaryAction(
        task({
          status: "needs_review",
          execution: execution("completed"),
          agentReview: review("changes_requested"),
        }),
      ),
    ).toBe("review");
    expect(taskPrimaryAction(task({ status: "approved" }))).toBeNull();
  });
});

describe("artifactViewer", () => {
  it("lets the file extension decide what can be rendered", () => {
    expect(artifactViewer({ kind: "document", title: "Notes", path: "docs/notes.md" })).toBe(
      "markdown",
    );
    expect(artifactViewer({ kind: "document", title: "Shot", path: "out/shot.PNG" })).toBe("image");
    expect(artifactViewer({ kind: "html", title: "Page", path: "dist/index.html" })).toBe("html");
    expect(artifactViewer({ kind: "file", title: "Log", path: "test-output.txt" })).toBe("text");
    expect(artifactViewer({ kind: "image", title: "No ext", path: "Makefile" })).toBe("text");
  });

  it("only links to http(s) URLs", () => {
    expect(artifactViewer({ kind: "link", title: "Preview", url: "https://example.com" })).toBe(
      "link",
    );
    expect(artifactViewer({ kind: "link", title: "Bad", url: "javascript:alert(1)" })).toBe(
      "unavailable",
    );
    expect(artifactViewer({ kind: "image", title: "Nothing" })).toBe("unavailable");
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("summarizeArtifacts", () => {
  it("counts artifacts by what a reviewer opens, in a stable order", () => {
    expect(
      summarizeArtifacts([
        { kind: "image", title: "a", path: "a.png" },
        { kind: "document", title: "b", path: "b.md" },
        { kind: "document", title: "c", path: "c.txt" },
        { kind: "link", title: "d", url: "https://example.com" },
        { kind: "html", title: "e", path: "e.html" },
      ]).map((entry) => entry.label),
    ).toEqual(["2 docs", "1 image", "1 page", "1 link"]);
    expect(summarizeArtifacts([])).toEqual([]);
  });
});

describe("deliverableEntries", () => {
  it("is empty before a run and always includes summary and code changes after", () => {
    expect(deliverableEntries(null)).toEqual([]);
    const bare = deliverableEntries(execution("completed"));
    expect(bare.map((entry) => entry.kind)).toEqual(["summary", "changes"]);
    expect(defaultDeliverableKey(bare)).toBe("summary");
  });

  it("lands on the first reported artifact", () => {
    const entries = deliverableEntries(
      execution("completed", [
        { kind: "document", title: "Spec", path: "spec.md" },
        { kind: "document", title: "Spec", path: "spec.md" },
      ]),
    );
    expect(entries.map((entry) => entry.kind)).toEqual([
      "summary",
      "artifact",
      "artifact",
      "changes",
    ]);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(entries.length);
    expect(defaultDeliverableKey(entries)).toBe(entries[1]!.key);
  });
});

describe("latestCheckpointTurnCount", () => {
  it("returns the highest turn, or null without checkpoints", () => {
    expect(latestCheckpointTurnCount([])).toBeNull();
    expect(
      latestCheckpointTurnCount([
        { checkpointTurnCount: 2 },
        { checkpointTurnCount: 5 },
        { checkpointTurnCount: 3 },
      ]),
    ).toBe(5);
  });
});

describe("artifactRelativePath", () => {
  it("reads reported paths relative to the workspace", () => {
    expect(artifactRelativePath("docs/plan.md", "/repo")).toBe("docs/plan.md");
    expect(artifactRelativePath("./docs/plan.md", "/repo")).toBe("docs/plan.md");
    expect(artifactRelativePath("/repo/docs/plan.md", "/repo")).toBe("docs/plan.md");
    expect(artifactRelativePath("/elsewhere/plan.md", "/repo")).toBe("/elsewhere/plan.md");
  });
});
