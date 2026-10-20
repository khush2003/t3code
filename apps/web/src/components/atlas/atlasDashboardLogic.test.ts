import type { AtlasInitiative, AtlasTask } from "@t3tools/contracts";
import { ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectAttentionItems,
  filterInitiatives,
  orderProjectsByActivity,
  summarizeProject,
} from "./atlasDashboardLogic";

const PROJECT_A = ProjectId.make("project-a");
const PROJECT_B = ProjectId.make("project-b");

function task(
  overrides: Omit<Partial<AtlasTask>, "id"> & {
    readonly id: string;
    readonly status: AtlasTask["status"];
  },
): AtlasTask {
  return {
    ordinal: 0,
    title: `Task ${overrides.id}`,
    description: "Do the thing",
    specialty: "Frontend",
    deliverable: null,
    acceptanceCriteria: ["It works"],
    dependsOn: [],
    blockedBy: [],
    issue: null,
    execution: null,
    agentReview: null,
    humanDecision: { outcome: "pending", feedback: null, decidedAt: null },
    launch: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } as AtlasTask;
}

function initiative(
  overrides: Omit<Partial<AtlasInitiative>, "id"> & { readonly id: string },
): AtlasInitiative {
  return {
    projectId: PROJECT_A,
    title: `Initiative ${overrides.id}`,
    brief: "A brief",
    deliverables: [],
    status: "draft",
    planSummary: null,
    planRevision: 0,
    planner: {
      status: "idle",
      threadId: null,
      runId: null,
      error: null,
      launch: null,
      mode: "plan",
      baseRevision: null,
      instructions: null,
      adjustment: null,
    },
    autoReview: null,
    tasks: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  } as AtlasInitiative;
}

describe("collectAttentionItems", () => {
  it("puts waiting agents first, then reviews, and skips running tasks", () => {
    const reviewing = initiative({
      id: "review",
      status: "in_progress",
      tasks: [
        task({ id: "t-review", status: "needs_review" }),
        task({ id: "t-failed", status: "failed" }),
        task({ id: "t-proposed", status: "proposed" }),
      ],
    });
    const waiting = initiative({ id: "waiting", status: "in_progress" });

    const items = collectAttentionItems([reviewing, waiting], new Map([["waiting", 2]]));

    expect(items.map((item) => item.kind)).toEqual(["input", "review", "failed"]);
    expect(items[0]?.label).toBe("2 agents are waiting on you");
  });

  it("flags a finished planner whose plan has not been imported", () => {
    const planned = initiative({
      id: "planned",
      status: "plan_ready",
      planner: { ...initiative({ id: "x" }).planner, status: "completed" },
    });

    expect(collectAttentionItems([planned], new Map()).map((item) => item.kind)).toEqual([
      "plan_ready",
    ]);
  });
});

describe("summarizeProject", () => {
  it("counts only the project's initiatives and tracks the latest activity", () => {
    const initiatives = [
      initiative({
        id: "a1",
        status: "in_progress",
        updatedAt: "2026-10-03T00:00:00.000Z",
        tasks: [task({ id: "1", status: "approved" }), task({ id: "2", status: "proposed" })],
      }),
      initiative({ id: "a2", status: "completed", updatedAt: "2026-10-05T00:00:00.000Z" }),
      initiative({ id: "b1", projectId: PROJECT_B, status: "in_progress" }),
    ];

    const summary = summarizeProject(initiatives, PROJECT_A);

    expect(summary.initiatives.map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(summary).toMatchObject({ active: 1, approved: 1, total: 2 });
    expect(summary.lastActivityAt).toBe("2026-10-05T00:00:00.000Z");
  });
});

describe("orderProjectsByActivity", () => {
  it("lists projects with recent Atlas work before idle ones", () => {
    const projects = [
      { id: ProjectId.make("idle-b"), title: "Beta" },
      { id: PROJECT_B, title: "Zulu" },
      { id: ProjectId.make("idle-a"), title: "Alpha" },
      { id: PROJECT_A, title: "Yankee" },
    ];
    const initiatives = [
      initiative({ id: "a", updatedAt: "2026-10-01T00:00:00.000Z" }),
      initiative({ id: "b", projectId: PROJECT_B, updatedAt: "2026-10-09T00:00:00.000Z" }),
    ];
    const summaries = new Map(
      projects.map((project) => [project.id, summarizeProject(initiatives, project.id)]),
    );

    expect(orderProjectsByActivity(projects, summaries).map((project) => project.title)).toEqual([
      "Zulu",
      "Yankee",
      "Alpha",
      "Beta",
    ]);
  });
});

describe("filterInitiatives", () => {
  it("combines the status filter with a title or brief search", () => {
    const initiatives = [
      initiative({ id: "1", title: "Checkout redesign", status: "in_progress" }),
      initiative({ id: "2", title: "Billing", brief: "Rework checkout taxes", status: "draft" }),
      initiative({ id: "3", title: "Checkout analytics", status: "completed" }),
    ];

    expect(filterInitiatives(initiatives, "active", "checkout").map((entry) => entry.id)).toEqual([
      "1",
    ]);
    expect(filterInitiatives(initiatives, "all", "CHECKOUT").map((entry) => entry.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });
});
