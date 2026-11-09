import {
  BotName,
  BotWorkItemId,
  EnvironmentId,
  NodeId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { type BoardSources, botNameFromThreadId, deriveBoard, unfiledTasks } from "./BotBoard.ts";

const here = EnvironmentId.make("here");
const laptop = EnvironmentId.make("laptop");
const now = DateTime.makeUnsafe("2026-11-09T12:00:00.000Z");
const item = {
  id: BotWorkItemId.make("item:1"),
  bot: BotName.make("atlas"),
  title: "Fix login",
  detail: "",
  nextStep: "review",
  state: "open" as const,
  createdAt: "2026-11-09T09:00:00.000Z",
  updatedAt: "2026-11-09T09:00:00.000Z",
};
const link = (environmentId: EnvironmentId, threadId: string) => ({
  environmentId,
  threadId: ThreadId.make(threadId),
  itemId: item.id,
  title: threadId,
  where: "app",
  linkedAt: "2026-11-09T09:00:00.000Z",
});
const task = (fields: Partial<OrchestrationV2Subagent>) =>
  ({
    id: NodeId.make("task"),
    prompt: "do it",
    title: null,
    childThreadId: null,
    result: null,
    status: "running",
    updatedAt: DateTime.makeUnsafe("2026-11-09T10:00:00.000Z"),
    ...fields,
  }) as OrchestrationV2Subagent;

const sources = (overrides: Partial<BoardSources>): BoardSources => ({
  hereId: here,
  now,
  items: [item],
  links: [],
  episodes: [],
  tasks: [],
  shells: new Map(),
  ...overrides,
});

describe("bot board", () => {
  it("reads status from the thread here, the task record elsewhere, and the last result last", () => {
    const board = deriveBoard(
      sources({
        links: [
          link(here, "local"),
          link(laptop, "remote"),
          link(laptop, "gone"),
          link(laptop, "never"),
        ],
        shells: new Map([
          [
            ThreadId.make("local"),
            {
              title: "Local",
              status: "completed",
              activeRunId: null,
              pendingRuntimeRequest: { id: "r" },
            } as unknown as OrchestrationV2ThreadShell,
          ],
        ]),
        tasks: [
          task({
            remoteChild: {
              environmentId: laptop,
              threadId: ThreadId.make("remote"),
              label: "laptop",
            },
          }),
        ],
        episodes: [
          {
            environmentId: laptop,
            threadId: ThreadId.make("gone"),
            bot: BotName.make("atlas"),
            runKey: "k",
            title: "gone",
            where: "laptop",
            outcome: "failed",
            startedAt: null,
            endedAt: "2026-11-08T10:00:00.000Z",
            result: "Tests failed.",
          },
        ],
      }),
    );
    expect(board[0]!.threads.map((thread) => [thread.status, thread.asOf])).toEqual([
      ["needs-input", "2026-11-09T12:00:00.000Z"],
      ["working", "2026-11-09T10:00:00.000Z"],
      ["failed", "2026-11-08T10:00:00.000Z"],
      ["unknown", "2026-11-09T09:00:00.000Z"],
    ]);
    expect(board[0]!.threads[2]!.result).toBe("Tests failed.");
  });

  it("lists running tasks that sit on no item, so none drop out of sight", () => {
    const running = task({
      title: "Unfiled",
      remoteChild: { environmentId: here, threadId: ThreadId.make("loose"), label: "app" },
    });
    const finished = task({
      remoteChild: { environmentId: here, threadId: ThreadId.make("done"), label: "app" },
      result: "ok",
      status: "completed",
    });
    expect(
      unfiledTasks(sources({ tasks: [running, finished] })).map((thread) => thread.title),
    ).toEqual(["Unfiled"]);
  });

  it("names the bot from its thread id", () => {
    expect(botNameFromThreadId(ThreadId.make("bot:atlas"))).toBe("atlas");
    expect(botNameFromThreadId(ThreadId.make("bot:atlas:3"))).toBe("atlas");
    expect(botNameFromThreadId(ThreadId.make("thread-1"))).toBeNull();
  });
});
