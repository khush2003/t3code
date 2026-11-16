import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { botSessionDue } from "./BotSession.ts";

describe("botSessionDue", () => {
  const now = DateTime.makeUnsafe("2026-11-16T12:00:00.000Z");
  const at = (iso: string) => DateTime.makeUnsafe(iso);
  it.each([
    ["a small session used a moment ago stays", 40_000, "2026-11-16T11:50:00.000Z", false],
    ["a large one is replaced", 80_000, "2026-11-16T11:59:00.000Z", true],
    ["one idle past any cache is replaced", 40_000, "2026-11-16T06:00:00.000Z", true],
    [
      "one with no size reported and recent use stays",
      undefined,
      "2026-11-16T11:00:00.000Z",
      false,
    ],
  ] as const)("%s", (_name, usedTokens, lastRunEndedAt, due) => {
    expect(botSessionDue({ usedTokens, lastRunEndedAt: at(lastRunEndedAt), now })).toBe(due);
  });
  it("a bot that has never run has no session to replace", () => {
    expect(botSessionDue({ usedTokens: undefined, lastRunEndedAt: null, now })).toBe(false);
  });
});
