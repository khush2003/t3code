import { describe, expect, it } from "vite-plus/test";

import type { OrchestrationV2ProjectedTurnItem, OrchestrationV2TurnItem } from "@t3tools/contracts";

import {
  lastLedScreen,
  placeBotStars,
  repliesToSay,
  spokenUnits,
  taskFeed,
  unitsToSay,
} from "./botSpace.logic";

/** Only what the space reads of an item; the rest of a real one does not matter here. */
const row = (position: number, item: Record<string, unknown>) =>
  ({
    position,
    item: {
      id: `item-${position}`,
      status: "completed",
      ...item,
    } as unknown as OrchestrationV2TurnItem,
  }) as OrchestrationV2ProjectedTurnItem;
const tool = (position: number, name: string, input: unknown, status = "completed") =>
  row(position, { type: "dynamic_tool", toolName: `mcp__t3-code__${name}`, input, status });

describe("bot space", () => {
  it("says a reply's prose a sentence at a time, and leaves code and tables for the eye", () => {
    const reply = [
      "## Posters",
      "Two tasks are **running**. The `build` one failed; see [the log](https://x.test/a.b).",
      "",
      "```ts",
      "const a = 1. ",
      "```",
      "| task | state |",
      "|---|---|",
      "- Retry the build",
      "1. Ask Sam",
      "It is in node_modules: <t3-thread://v2/env/thread-1>",
      "https://x.test/only-a-link",
    ].join("\n");
    expect(spokenUnits(reply, true)).toEqual([
      "Posters",
      "Two tasks are running.",
      "The build one failed; see the log.",
      "Retry the build",
      "Ask Sam",
      "It is in node modules:",
    ]);
  });

  it("breaks a long sentence at its clauses, and leaves short ones whole", () => {
    expect(
      spokenUnits(
        "Probe is waiting on you to confirm closing the posters item, since its task finished and changed no files. Chief, though, is quiet.",
        true,
      ),
    ).toEqual([
      "Probe is waiting on you to confirm closing the posters item,",
      "since its task finished and changed no files.",
      "Chief, though, is quiet.",
    ]);
  });

  it("gives only whole pieces of a reply still arriving, and never changes one it gave", () => {
    const reply = "Done. The poster is in [files](https://x.test/p.png) now.\n```sh\nls\n```\nBye";
    let given: ReadonlyArray<string> = [];
    for (let length = 0; length <= reply.length; length++) {
      const units = spokenUnits(reply.slice(0, length), false);
      expect(units.slice(0, given.length)).toEqual(given);
      given = units;
    }
    expect(given).toEqual(["Done.", "The poster is in files now."]);
    expect(spokenUnits(reply, true)).toEqual(["Done.", "The poster is in files now.", "Bye"]);
  });

  it("puts the overseer at the centre and the rest to its sides, clear of the middle", () => {
    const bots = ["rover", "nocturne-manager", "scout", "probe", "atlas", "zed", "ida"].map(
      (name) => ({ name, oversees: name === "rover" }),
    );
    const places = placeBotStars(bots);
    expect(places.get("rover")).toEqual({ x: 0, y: 0, z: 0 });
    const sides = bots.slice(1).map((bot) => places.get(bot.name)!);
    for (const place of sides) {
      expect(Math.abs(place.x)).toBeGreaterThan(0.35);
      expect(Math.abs(place.x)).toBeLessThan(0.9);
      expect(Math.abs(place.y)).toBeLessThan(0.7);
    }
    const right = sides.filter((place) => place.x > 0).length;
    expect(Math.abs(right - (sides.length - right))).toBeLessThanOrEqual(1);
    for (const [index, a] of sides.entries())
      for (const b of sides.slice(index + 1))
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.25);
    expect(placeBotStars([]).size).toBe(0);
  });

  it("holds up what the lead last looked at, started or chose to show, since the visit began", () => {
    const led = (...items: OrchestrationV2ProjectedTurnItem[]) =>
      lastLedScreen(items, 10, "rover")?.screen ?? null;
    expect(led(tool(11, "t3_bot_board", {}))).toEqual({ kind: "board", bot: "rover" });
    expect(
      led(tool(11, "t3_bot_board", { bot: "scout" }), tool(12, "t3_bot_item_save", {})),
    ).toEqual({ kind: "board", bot: "scout" });
    expect(led(tool(11, "t3_bot_tell", { bot: "scout", message: "hi" }))).toEqual({
      kind: "board",
      bot: "scout",
    });
    expect(led(tool(11, "t3_thread_read", { threadId: "t1", environmentId: "e1" }))).toEqual({
      kind: "task",
      bot: null,
      environmentId: "e1",
      threadId: "t1",
    });
    expect(led(row(11, { type: "subagent", childThreadId: "t2", remoteChild: undefined }))).toEqual(
      { kind: "task", bot: "rover", environmentId: null, threadId: "t2" },
    );
    expect(led(tool(11, "t3_bot_show", { file: "Poster notes", bot: "scout" }))).toEqual({
      kind: "file",
      bot: "scout",
      file: "Poster notes",
    });
    expect(led(tool(11, "t3_bot_show", { thread: "t3" }))).toEqual({
      kind: "task",
      bot: null,
      environmentId: null,
      threadId: "t3",
    });
    expect(led(tool(11, "t3_bot_show", {}))).toEqual({ kind: "board", bot: "rover" });
    // Only what it chose to show outranks a screen the person opened.
    expect(lastLedScreen([tool(11, "t3_bot_show", {})], 10, "rover")?.shown).toBe(true);
    expect(lastLedScreen([tool(11, "t3_bot_board", {})], 10, "rover")?.shown).toBe(false);
    // What it looked at before the visit, a look that failed, and other work show nothing.
    expect(led(tool(10, "t3_bot_board", {}))).toBeNull();
    expect(led(tool(11, "t3_bot_show", { file: "x" }, "failed"))).toBeNull();
    expect(led(tool(11, "t3_bot_recall", { query: "x" }))).toBeNull();
  });

  it("says a reply to the person whole, and only the headline of one nobody asked for", () => {
    const said = (position: number, runId: string, text: string) =>
      row(position, { type: "user_message", runId, text });
    const reply = (position: number, runId: string, text: string) =>
      row(position, {
        type: "assistant_message",
        runId,
        messageId: `m${position}`,
        text,
        streaming: false,
      });
    expect(
      repliesToSay(
        [
          said(4, "r1", "(voice) what is open?"),
          reply(5, "r1", "Before the visit."),
          reply(11, "r1", "Two things."),
          reply(12, "r1", " "),
          // A task ended and woke the bot: no message of the person's starts this turn.
          row(13, { type: "notification", runId: "r2" }),
          reply(14, "r2", "## Report"),
          said(15, "r3", "typed in the chat"),
          reply(16, "r3", "Here."),
          said(17, "r4", "(voice) thanks"),
          reply(18, "r4", "Sure."),
        ],
        10,
        "(voice) ",
      ).map((item) => [item.messageId, item.asked]),
    ).toEqual([
      ["m11", true],
      ["m14", false],
      ["m16", false],
      ["m18", true],
    ]);
    const report = ["The report is back.", "It lists five stocks,", "from text to cover."];
    expect(unitsToSay(report, true)).toEqual(report);
    expect(unitsToSay(report, false)).toEqual(["The report is back."]);
    expect(unitsToSay(["It lists five stocks,", "from text to cover.", "More."], false)).toEqual([
      "It lists five stocks,",
      "from text to cover.",
    ]);
  });

  it("reads a task's last writing and doing as short lines, oldest first", () => {
    expect(
      taskFeed(
        [
          row(1, { type: "assistant_message", text: "Old.", streaming: false }),
          row(2, {
            type: "reasoning",
            text: "**Checking the sizes**\n\nLong thought.",
            streaming: false,
          }),
          row(3, { type: "command_execution", input: "ls -la\ncat x" }),
          row(4, { type: "file_change", fileName: "src/poster.ts" }),
          row(5, { type: "checkpoint" }),
          row(6, {
            type: "assistant_message",
            text: "Two files **changed**. `a.ts`",
            streaming: false,
          }),
        ],
        4,
      ).map((line) => `${line.kind}: ${line.text}`),
    ).toEqual([
      "does: Checking the sizes",
      "does: $ ls -la",
      "does: src/poster.ts",
      "says: Two files changed. a.ts",
    ]);
  });
});
