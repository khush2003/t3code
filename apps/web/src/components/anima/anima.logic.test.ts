import { describe, expect, it } from "vite-plus/test";
import type {
  AnimaBreath,
  AnimaInboxMessage,
  AnimaPolicyRule,
  AnimaSummary,
} from "@t3tools/contracts";

import {
  animaHealthBucket,
  animaWellness,
  breathNoteText,
  buildAnimaFeed,
  filterAnimas,
  groupOpens,
  isAnimaNameValid,
  keyedLines,
  policyFireRows,
  safeAnimaAccent,
  sortAnimas,
  threadInbox,
  traitPercent,
  validateAnimaSearch,
} from "./anima.logic";

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
    expect(validateAnimaSearch({ view: "library", entry: "notes.md" })).toEqual({
      view: "library",
      entry: "notes.md",
    });
    expect(validateAnimaSearch({ view: "world", entry: "x" })).toEqual({ view: "world" });
    expect(validateAnimaSearch({ view: "roster" })).toEqual({});
    expect(validateAnimaSearch({ view: "library", entry: "../etc" })).toEqual({ view: "library" });
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

  it("sorts by need with unread health last", () => {
    const sorted = sortAnimas(
      [
        summary({ name: "none", health: null }),
        summary({ name: "calm", health: 0.1 }),
        summary({ name: "hurt", health: 0.7 }),
      ],
      "health",
    );
    expect(sorted.map((a) => a.name)).toEqual(["hurt", "calm", "none"]);
  });

  it("buckets health at the CLI's tending thresholds", () => {
    expect(animaHealthBucket(null)).toBe("unknown");
    expect(animaHealthBucket(0.35)).toBe("steady");
    expect(animaHealthBucket(0.36)).toBe("watch");
    expect(animaHealthBucket(0.61)).toBe("tend");
    expect(animaWellness(0.25)).toBe(75);
    expect(animaWellness(3)).toBe(0);
    expect(animaWellness(null)).toBeNull();
  });

  it("filters to animas that need attention", () => {
    const list = [
      summary({ name: "ok", health: 0.2 }),
      summary({ name: "watch", health: 0.5, aim: "sync" }),
      summary({ name: "unread", health: null }),
    ];
    expect(filterAnimas(list, "", true).map((a) => a.name)).toEqual(["watch"]);
    expect(filterAnimas(list, "nothing", true)).toEqual([]);
  });

  it("threads inbox messages by reply chain and shared context", () => {
    const message = (over: Partial<AnimaInboxMessage> & { id: string; ts: string }) =>
      ({ type: "info", from: "x", body: "", ...over }) as AnimaInboxMessage;
    const threads = threadInbox([
      message({ id: "a", ts: "2026-01-01" }),
      message({ id: "b", ts: "2026-01-03", replyTo: "a", status: "done" }),
      message({ id: "c", ts: "2026-01-02", replyTo: "elsewhere", contextId: "ctx" }),
      message({ id: "d", ts: "2026-01-04", replyTo: "gone", contextId: "ctx" }),
      message({ id: "loop1", ts: "2026-01-05", replyTo: "loop2" }),
      message({ id: "loop2", ts: "2026-01-06", replyTo: "loop1" }),
    ]);
    expect(threads.map((thread) => thread.messages.map((m) => m.id))).toEqual([
      ["loop1", "loop2"],
      ["c", "d"],
      ["a", "b"],
    ]);
    expect(threads[1]?.answers).toBe("elsewhere");
    expect(threads[2]?.unsettled).toBe(1);
  });

  it("normalises policy fires against the busiest rule", () => {
    const rule = (index: number, fires: number) => ({ index, fires }) as AnimaPolicyRule;
    const rows = policyFireRows([rule(1, 0), rule(2, 4), rule(3, 2)], "fires");
    expect(rows.map((row) => [row.rule.index, row.share, row.neverFired])).toEqual([
      [2, 1, false],
      [3, 0.5, false],
      [1, 0, true],
    ]);
    expect(policyFireRows([rule(1, 0)], "order")[0]?.share).toBe(0);
  });

  it("orders live opens blocked first and splits off closed ones", () => {
    const open = (id: string, status: string) =>
      ({ id, project: "p", question: "q", status, assignee: null }) as const;
    const { live, closed } = groupOpens([
      open("open-1", "watching"),
      open("open-2", "closed"),
      open("open-3", "blocked"),
      open("open-4", "active"),
    ]);
    expect(live.map((entry) => entry.id)).toEqual(["open-3", "open-4", "open-1"]);
    expect(closed.map((entry) => entry.id)).toEqual(["open-2"]);
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
