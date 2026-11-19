import type { BotBoardFile, BotBoardItem, BotBoardThread } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  botFileKind,
  botTaskRunMs,
  groupBotItems,
  nameBotItemRefs,
  sortBotTasks,
  splitBotFiles,
} from "./botBoard.logic";

const thread = (fields: Partial<BotBoardThread>) =>
  ({ status: "completed", startedAt: null, endedAt: null, ...fields }) as BotBoardThread;
const item = (id: string, fields: Partial<BotBoardItem>) =>
  ({
    id,
    state: "open",
    waitingOnYou: false,
    updatedAt: "2026-11-19T10:00:00.000Z",
    threads: [],
    files: [],
    ...fields,
  }) as unknown as BotBoardItem;
const file = (fields: Partial<BotBoardFile>) =>
  ({
    attachmentId: "a",
    mimeType: null,
    name: null,
    url: null,
    createdAt: "",
    ...fields,
  }) as BotBoardFile;

describe("bot board", () => {
  it("puts an item where its state and tasks say, newest first within a column", () => {
    const groups = groupBotItems([
      item("flagged", { waitingOnYou: true, threads: [thread({ status: "working" })] }),
      item("asked", { threads: [thread({ status: "needs-input" })] }),
      item("older", {
        threads: [thread({ status: "working" })],
        updatedAt: "2026-11-18T10:00:00.000Z",
      }),
      item("newer", { threads: [thread({ status: "working" })] }),
      item("resting", { threads: [thread({ status: "completed" })] }),
      item("closed", { state: "done", waitingOnYou: true }),
    ]);
    expect(
      Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((i) => i.id)])),
    ).toEqual({
      "needs-you": ["flagged", "asked"],
      running: ["newer", "older"],
      quiet: ["resting"],
      done: ["closed"],
    });
  });

  it("orders tasks by who is waiting, then by when they last moved", () => {
    const sorted = sortBotTasks([
      thread({ title: "old", endedAt: "2026-11-19T08:00:00.000Z" }),
      thread({ title: "running", status: "working", startedAt: "2026-11-19T09:00:00.000Z" }),
      thread({ title: "recent", endedAt: "2026-11-19T09:30:00.000Z" }),
      thread({ title: "asking", status: "needs-input" }),
    ]);
    expect(sorted.map((task) => task.title)).toEqual(["asking", "running", "recent", "old"]);
    expect(
      botTaskRunMs(
        thread({ startedAt: "2026-11-19T09:00:00.000Z", endedAt: "2026-11-19T09:06:00.000Z" }),
      ),
    ).toBe(360_000);
    expect(botTaskRunMs(thread({ startedAt: "2026-11-19T09:00:00.000Z" }))).toBeNull();
  });

  it("shows kept pictures as pictures and names everything else by what it is", () => {
    const files = [
      file({ id: "doc", name: "plan.html", mimeType: "text/html", createdAt: "1" }),
      file({ id: "shot", name: "a.png", mimeType: "image/png", createdAt: "2" }),
      file({
        id: "evicted",
        name: "b.png",
        mimeType: "image/png",
        attachmentId: null,
        createdAt: "3",
      }),
      file({ id: "link", url: "https://example.com", attachmentId: null, createdAt: "4" }),
    ];
    const split = splitBotFiles(files);
    expect(split.images.map((f) => f.id)).toEqual(["shot"]);
    expect(split.others.map((f) => [f.id, botFileKind(f)])).toEqual([
      ["link", "Link"],
      ["evicted", "PNG"],
      ["doc", "HTML"],
    ]);
  });
});

describe("nameBotItemRefs", () => {
  const items = [{ id: "item:04357fc7", title: "Merge and cut the beta" }];

  it("reads a known id as the work's title, bare or bracketed", () => {
    expect(nameBotItemRefs("Handled under item:04357fc7.", items)).toBe(
      "Handled under \u201cMerge and cut the beta\u201d.",
    );
    expect(nameBotItemRefs("Posters [item:04357fc7]: open", items)).toBe(
      "Posters \u201cMerge and cut the beta\u201d: open",
    );
  });

  it("leaves an id it does not know as written", () => {
    expect(nameBotItemRefs("See item:deadbeef.", items)).toBe("See item:deadbeef.");
  });
});
