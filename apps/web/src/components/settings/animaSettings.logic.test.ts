import { describe, expect, it } from "vite-plus/test";
import type { AnimaBreath, AnimaSummary } from "@t3tools/contracts";

import {
  breathNoteText,
  buildAnimaFeed,
  filterAnimas,
  isAnimaNameValid,
  keyedLines,
  safeAnimaAccent,
  sortAnimas,
  traitPercent,
  validateAnimaSearch,
} from "./animaSettings.logic";

const summary = (over: Partial<AnimaSummary>) =>
  ({
    name: "a",
    role: "agent",
    live: false,
    lastActiveAt: null,
    aim: null,
    voice: null,
    projects: [],
    ...over,
  }) as AnimaSummary;

describe("anima settings logic", () => {
  it("validates the route search", () => {
    expect(validateAnimaSearch({ anima: " ada ", tab: "policy", environmentId: "e" })).toEqual({
      environmentId: "e",
      anima: "ada",
      tab: "policy",
    });
    expect(validateAnimaSearch({ tab: "overview" })).toEqual({});
    expect(validateAnimaSearch({ tab: "bogus", anima: "" })).toEqual({});
  });

  it("only lets plain color syntaxes through", () => {
    expect(safeAnimaAccent("#a1b2c3")).toBe("#a1b2c3");
    expect(safeAnimaAccent("hsl(200, 50%, 40%)")).toBe("hsl(200, 50%, 40%)");
    expect(safeAnimaAccent("red; background:url(x)")).toBeNull();
    expect(safeAnimaAccent(null)).toBeNull();
  });

  it("sorts live first, then by recent activity", () => {
    const sorted = sortAnimas([
      summary({ name: "old", lastActiveAt: "2026-01-01" }),
      summary({ name: "live", live: true }),
      summary({ name: "new", lastActiveAt: "2026-02-01" }),
    ]);
    expect(sorted.map((a) => a.name)).toEqual(["live", "new", "old"]);
  });

  it("filters across name, role, aim, and projects", () => {
    const list = [
      summary({ name: "ada", aim: "ship sync" }),
      summary({ name: "bo", projects: ["t3"] }),
    ];
    expect(filterAnimas(list, "SYNC").map((a) => a.name)).toEqual(["ada"]);
    expect(filterAnimas(list, "t3").map((a) => a.name)).toEqual(["bo"]);
    expect(filterAnimas(list, " ")).toBe(list);
  });

  it("clamps trait bars", () => {
    expect(traitPercent({ mean: 1.4 })).toBe(100);
    expect(traitPercent({ mean: -1 })).toBe(0);
    expect(traitPercent({ mean: 0.456 })).toBe(46);
  });

  it("merges breaths and messages newest first and pins open questions", () => {
    const breath = (index: number, ts: string) => ({ index, ts }) as AnimaBreath;
    const feed = buildAnimaFeed({
      breaths: [breath(1, "2026-01-01"), breath(2, "2026-03-01")],
      inbox: [{ id: "m", type: "t", from: "x", ts: "2026-02-01", body: "hi" }],
      opens: [
        { id: "1", project: "p", question: "q", status: "open", assignee: null },
        { id: "2", project: "p", question: "q", status: "closed", assignee: null },
      ],
    });
    expect(feed.items.map((item) => item.key)).toEqual(["breath:2", "message:m", "breath:1"]);
    expect(feed.pinned.map((open) => open.id)).toEqual(["1"]);
  });

  it("hides encoded musical notes", () => {
    expect(breathNoteText("C4E4G4")).toBeNull();
    expect(breathNoteText("shipped the roster view")).toBe("shipped the roster view");
  });

  it("matches the contract's name pattern", () => {
    expect(isAnimaNameValid("ada-1.x")).toBe(true);
    expect(isAnimaNameValid("-bad")).toBe(false);
    expect(isAnimaNameValid("a/b")).toBe(false);
  });

  it("keys repeated lines uniquely", () => {
    const keys = keyedLines(["a", "a", "b"]).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(3);
  });
});
