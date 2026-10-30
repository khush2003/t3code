import { AnimaRecordInput, type AnimaSummary } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  animaAlerts,
  animaColor,
  animaPulse,
  animaSearchTarget,
  breathsByDay,
  continuedBreathCodec,
  groupAnimaSearchHits,
  isUnsupportedAnimaRequest,
  parseVoiceSamples,
  searchAnimasLocally,
  tensionBoard,
  tensionText,
} from "./anima-presentation";

function summary(overrides: Partial<AnimaSummary>): AnimaSummary {
  return {
    name: "kestrel",
    id: "id",
    role: "agent",
    born: "2026-01-01",
    parent: null,
    accent: null,
    breathCount: 0,
    enabled: true,
    live: false,
    lastActiveAt: null,
    lastBreathAt: null,
    aim: null,
    memo: null,
    vow: null,
    hsl: null,
    shape: null,
    voice: null,
    projects: [],
    topSkills: [],
    inboxCount: 0,
    policyCount: 0,
    health: null,
    digest: "d",
    ...overrides,
  } as AnimaSummary;
}

describe("animaColor", () => {
  it.each([
    [{ hsl: "200,60,45", accent: "#ff0000" }, "hsl(200, 60%, 45%)"],
    [{ hsl: "-30, 140, 2", accent: null }, "hsl(330, 100%, 18%)"],
    [{ hsl: "nope", accent: "#abc" }, "#abc"],
    [{ hsl: "10,20", accent: "rgb(1, 2, 3)" }, "rgb(1, 2, 3)"],
    [{ hsl: null, accent: "red; background: url(x)" }, null],
    [{ hsl: null, accent: "oklch(50% 0.1 20)" }, null],
    [{ hsl: null, accent: null }, null],
  ])("reads %j as %s", (anima, expected) => {
    expect(animaColor(anima)).toBe(expected);
  });
});

describe("tensions", () => {
  it.each([
    ["flaky-ci_retries", "flaky ci retries"],
    ["auth:token-refresh(3)", "auth: token refresh"],
    ["merge-order:12", "merge order"],
  ])("reads %s as %s", (slug, expected) => {
    expect(tensionText(slug)).toBe(expected);
  });

  it("orders the board oldest first, then by anima", () => {
    const board = tensionBoard([
      summary({ name: "b", tensions: [{ slug: "x", age: 2 }] }),
      summary({
        name: "a",
        tensions: [
          { slug: "y", age: 2 },
          { slug: "z", age: 9 },
        ],
      }),
    ]);
    expect(board.map((entry) => `${entry.anima}:${entry.slug}`)).toEqual(["a:z", "a:y", "b:x"]);
  });
});

describe("animaAlerts", () => {
  it("keeps enabled animas that need tending or carry warnings, most in need first", () => {
    const alerts = animaAlerts([
      summary({ name: "steady", health: 0.1 }),
      summary({ name: "warned", health: 0.1, healthWarnings: ["policy cap reached"] }),
      summary({ name: "tend", health: 0.8 }),
      summary({ name: "off", health: 0.9, enabled: false }),
      summary({ name: "watch", health: 0.4 }),
    ]);
    expect(alerts.map((anima) => anima.name)).toEqual(["tend", "watch", "warned"]);
  });
});

describe("animaPulse", () => {
  it("places animas seen in the last 48 hours, most recent first", () => {
    const now = Date.parse("2026-03-03T00:00:00Z");
    const pulse = animaPulse(
      [
        summary({ name: "old", lastActiveAt: "2026-02-28T00:00:00Z" }),
        summary({ name: "day", lastActiveAt: null, lastBreathAt: "2026-03-02T00:00:00Z" }),
        summary({ name: "now", lastActiveAt: "2026-03-03T00:00:00Z" }),
        summary({ name: "never" }),
      ],
      now,
    );
    expect(pulse.map((entry) => [entry.anima.name, entry.x])).toEqual([
      ["now", 1],
      ["day", 0.5],
    ]);
  });
});

describe("search", () => {
  it("matches the roster locally in the server's hit shape", () => {
    const hits = searchAnimasLocally(
      [
        summary({ name: "kestrel", aim: "ship the parser" }),
        summary({ name: "parsec", tensions: [{ slug: "parser-flakes", age: 1 }] }),
      ],
      "pars",
    );
    expect(hits.map((hit) => `${hit.type}:${hit.anima}`)).toEqual([
      "anima:parsec",
      "tension:parsec",
      "aim:kestrel",
    ]);
    expect(searchAnimasLocally([summary({})], "k")).toEqual([]);
  });

  it("groups hits in a fixed order and maps them to destinations", () => {
    const base = { title: "t", snippet: "", status: null } as const;
    const hits = [
      { ...base, type: "library", anima: null, breath: null, slug: "notes" },
      { ...base, type: "breath", anima: "kestrel", breath: 4 },
      { ...base, type: "anima", anima: "kestrel", breath: null },
      { ...base, type: "identity", anima: "kestrel", breath: null },
      { ...base, type: "library", anima: null, breath: null },
    ] as const;
    expect(groupAnimaSearchHits(hits).map((group) => group.type)).toEqual([
      "anima",
      "breath",
      "identity",
      "library",
    ]);
    expect(hits.map(animaSearchTarget)).toEqual([
      { kind: "library", slug: "notes" },
      { kind: "anima", name: "kestrel", tab: "breaths", breath: 4 },
      { kind: "anima", name: "kestrel" },
      { kind: "anima", name: "kestrel", tab: "identity" },
      null,
    ]);
  });

  it("recognises an older server's unknown-request defect", () => {
    expect(isUnsupportedAnimaRequest(new Error("Unknown request tag: anima.search"))).toBe(true);
    expect(isUnsupportedAnimaRequest(new Error("Anima search failed."))).toBe(false);
  });
});

describe("breathsByDay", () => {
  it("groups newest first and labels today and yesterday", () => {
    const now = new Date(2026, 2, 3, 12).getTime();
    const at = (day: number, hour: number) => new Date(2026, 2, day, hour).toISOString();
    const groups = breathsByDay(
      [
        { index: 1, ts: at(1, 9) },
        { index: 2, ts: at(2, 9) },
        { index: 3, ts: at(3, 8) },
        { index: 4, ts: at(3, 10) },
        { index: 0, ts: "unknown" },
      ],
      now,
    );
    expect(
      groups.map((group) => [group.label, group.breaths.map((breath) => breath.index)]),
    ).toEqual([
      ["Today", [4, 3]],
      ["Yesterday", [2]],
      [groups[2]!.label, [1]],
      ["Undated", [0]],
    ]);
    expect(groups[2]!.label).not.toMatch(/Today|Yesterday|Undated/);
  });
});

describe("continuedBreathCodec", () => {
  const breath = (index: number, overrides: object) => ({
    index,
    ts: "2026-03-01T00:00:00Z",
    note: "a note",
    hsl: null,
    shape: null,
    ...overrides,
  });
  const decode = Schema.decodeUnknownSync(AnimaRecordInput);

  it("continues the latest breath in the CLI's codec", () => {
    const codec = continuedBreathCodec({
      summary: summary({ name: "kestrel" }),
      breaths: [
        breath(3, {
          hsl: "190.4,71.6,48",
          note: "F#3.minor.88.2.3.120",
          shape: { breadth: 0.333, depth: 1.4, coupling: -1 },
        }),
        breath(1, { hsl: "10,10,10", note: "C4.M.20.1" }),
      ],
    } as never);
    expect(codec).toEqual({
      name: "kestrel",
      hsl: "190.72.48",
      note: "F4.m.88.1.2.100",
      shape: "0.33/1/0",
    });
    expect(() => decode(codec)).not.toThrow();
  });

  it("falls back to defaults for prose notes and missing readings", () => {
    const codec = continuedBreathCodec({
      summary: summary({ name: "kestrel", hsl: "400,50" }),
      breaths: [breath(0, { note: "shipped the parser today" })],
    } as never);
    expect(codec).toEqual({
      name: "kestrel",
      hsl: "225.60.55",
      note: "D4.M.60.1.2.100",
      shape: "0.5/0.5/0.5",
    });
    expect(() => decode(codec)).not.toThrow();
  });
});

describe("parseVoiceSamples", () => {
  it("keeps commas inside a sample", () => {
    expect(parseVoiceSamples("[calm] slow down, breathe,[sharp] no.")).toEqual([
      { tag: "calm", text: "slow down, breathe" },
      { tag: "sharp", text: "no." },
    ]);
  });
});
