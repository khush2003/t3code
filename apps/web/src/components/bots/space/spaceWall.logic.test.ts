import { describe, expect, it } from "vite-plus/test";

import {
  ThreadId,
  type BotBoardFile,
  type BotBoardItem,
  type BotBoardThread,
} from "@t3tools/contracts";

import { boardRows, firstPiece, pairPictures, recentPictures, taskPieces } from "./spaceWall.logic";

const file = (id: string, title: string, more: Partial<BotBoardFile> = {}) =>
  ({
    id,
    title,
    name: `${id}.png`,
    mimeType: "image/png",
    attachmentId: `a-${id}`,
    url: null,
    createdAt: id,
    threadId: "t1",
    ...more,
  }) as BotBoardFile;
const doc = (id: string, title: string) =>
  file(id, title, { name: `${id}.md`, mimeType: "text/markdown" });
const thread = (title: string, status: string, threadId = title) =>
  ({ title, status, threadId, result: null }) as unknown as BotBoardThread;
const item = (more: { readonly id?: string } & Partial<Omit<BotBoardItem, "id">>) =>
  ({
    id: "i",
    title: "Item",
    state: "open",
    waitingOnYou: false,
    threads: [],
    files: [],
    ...more,
  }) as BotBoardItem;

describe("the screen in the space", () => {
  it("puts the before and the after of one thing together", () => {
    const pieces = pairPictures([
      file("1", "Rules, GC, before (shows the sentence)"),
      file("2", "Rules, USD, after"),
      file("3", "Rules, GC, after (sentence removed)"),
      file("4", "Rules, GC, after (again)"),
      doc("5", "Notes before the change"),
    ]);
    expect(pieces.map((piece) => piece.kind)).toEqual(["pair", "file", "file", "file"]);
    expect(pieces[0]).toMatchObject({
      title: "Rules, GC",
      before: { id: "1" },
      after: { id: "3" },
    });
  });

  it("opens a task on its pictures, else its work while it runs, else what it has", () => {
    const pieces = taskPieces(
      { status: "working", result: "old" },
      [doc("1", "Notes"), file("2", "Screenshot")],
      true,
    );
    // Pictures lead; a task still at work has no result to show yet.
    expect(pieces.map((piece) => piece.id)).toEqual(["2", "1", "activity"]);
    expect(firstPiece(pieces, true)?.id).toBe("2");
    const plain = taskPieces({ status: "working", result: null }, [doc("1", "Notes")], true);
    expect(firstPiece(plain, true)?.id).toBe("activity");
    const ended = taskPieces({ status: "completed", result: " Done. " }, [], false);
    expect(ended).toEqual([{ kind: "result", id: "result", text: "Done." }]);
  });

  it("lays a board out as what waits on the person, then what moves, then the rest", () => {
    const rows = boardRows([
      item({ id: "quiet", threads: [thread("old", "done")], files: [doc("1", "Notes")] }),
      item({
        id: "moving",
        threads: [
          thread("Build", "working", "a"),
          thread("Build", "needs-input", "b"),
          thread("Build", "done", "c"),
        ],
        files: [file("2", "Older"), file("3", "Newer")],
      }),
      item({ id: "waits", waitingOnYou: true }),
      item({ id: "closed", state: "done" as BotBoardItem["state"] }),
    ]);
    expect(rows.map((row) => row.item.id)).toEqual(["moving", "waits", "quiet"]);
    // Tasks of one name are one line, the one that waits standing for the others.
    expect(rows[0]).toMatchObject({ live: [{ threadId: "b" }], ended: 1, others: 0 });
    expect(rows[0]!.pictures.map((picture) => picture.id)).toEqual(["3", "2"]);
    expect(rows[2]).toMatchObject({ live: [], ended: 1, others: 1 });
  });

  it("picks the newest picture of each task for the wall, an after before its before", () => {
    const recent = recentPictures(
      [
        {
          bot: "scout",
          items: [
            item({
              title: "Rules",
              files: [
                file("1", "Rules, after"),
                file("2", "Rules, before"),
                file("3", "Chart", { threadId: ThreadId.make("t2") }),
                doc("4", "Notes"),
              ],
            }),
          ],
        },
      ],
      4,
    );
    expect(recent.map((picture) => picture.file.id)).toEqual(["3", "1"]);
    expect(recent[0]).toMatchObject({ bot: "scout", item: "Rules" });
  });
});
