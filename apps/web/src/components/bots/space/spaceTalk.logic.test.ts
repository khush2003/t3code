import { describe, expect, it } from "vite-plus/test";

import type { OrchestrationV2ProjectedTurnItem, OrchestrationV2TurnItem } from "@t3tools/contracts";

import { leadActivity, replyParts, talkRows } from "./spaceTalk.logic";

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

describe("the conversation in the space", () => {
  it("reads the lead's chat as a conversation and leaves its other work out", () => {
    const rows = talkRows(
      [
        row(1, { type: "user_message", text: "(voice) where are the posters?" }),
        tool(2, "t3_bot_board", {}),
        tool(3, "t3_bot_tell", { bot: "scout", message: "Where are the posters?" }),
        row(4, {
          type: "user_message",
          text: 'The bot "scout" answers what you told it:\n\nDone, six of them.',
        }),
        row(5, { type: "subagent", childThreadId: "t1", prompt: "Print them\nall", title: " " }),
        tool(6, "t3_bot_show", { file: "Poster 1" }),
        tool(7, "t3_bot_show", { file: "missing" }, "failed"),
        row(8, { type: "assistant_message", messageId: "m1", text: "Six.", streaming: false }),
        row(9, { type: "assistant_message", messageId: "m2", text: "  ", streaming: true }),
        row(10, { type: "reasoning", text: "hm" }),
      ],
      "rover",
      "(voice) ",
    );
    expect(rows.map((entry) => entry.kind)).toEqual([
      "you",
      "told",
      "heard",
      "task",
      "shown",
      "reply",
    ]);
    expect(rows[0]).toMatchObject({ text: "where are the posters?" });
    expect(rows[2]).toMatchObject({ bot: "scout", text: "Done, six of them." });
    expect(rows[3]).toMatchObject({ threadId: "t1", title: "Print them" });
    expect(rows[4]).toMatchObject({ screen: { kind: "file", bot: "rover", file: "Poster 1" } });
  });

  it("splits a reply into the answer that is said and the detail that is read", () => {
    expect(replyParts("Six posters.\n\n- one\n- two", false)).toEqual({
      headline: "Six posters.",
      headlineDone: true,
      detail: "- one\n- two",
    });
    // Until a blank line arrives the answer may still be growing.
    expect(replyParts("Six pos", true)).toEqual({
      headline: "Six pos",
      headlineDone: false,
      detail: "",
    });
    expect(replyParts("Six posters.", false).headlineDone).toBe(true);
  });

  it("names what the lead is doing while a tool of its own runs", () => {
    expect(leadActivity([tool(1, "t3_bot_board", {}, "running")])).toMatch(/board/i);
    expect(leadActivity([tool(1, "t3_bot_board", {})])).toBeNull();
    expect(leadActivity([])).toBeNull();
  });
});
