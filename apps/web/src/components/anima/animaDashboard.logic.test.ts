import { describe, expect, it } from "vite-plus/test";

import {
  parseKin,
  parseUserModel,
  parseVoiceSamples,
  pulseBuckets,
  soulMeaning,
  tensionBoard,
} from "./animaDashboard.logic";

const NOW = Date.parse("2026-10-29T12:00:00Z");

describe("pulseBuckets", () => {
  it("groups by recency, newest first, with unknown times as oldest", () => {
    const buckets = pulseBuckets(
      [
        { id: "minute", at: "2026-10-29T11:59:00Z" },
        { id: "never", at: null },
        { id: "seconds", at: "2026-10-29T11:59:50Z" },
        { id: "days", at: "2026-10-25T00:00:00Z" },
        { id: "year", at: "2025-10-01T00:00:00Z" },
      ],
      NOW,
    );
    expect(buckets.map((bucket) => bucket.map((entry) => entry.id))).toEqual([
      ["seconds", "minute"],
      [],
      ["days"],
      [],
      [],
      ["year", "never"],
    ]);
  });
});

describe("tensionBoard", () => {
  it("reads slugs as text and sorts oldest first", () => {
    expect(
      tensionBoard([
        { name: "a", tensions: [{ slug: "fix-shipped:needs_restart", age: 3 }] },
        { name: "b", tensions: [{ slug: "house-I-will-inhabit(4)", age: 9 }] },
        { name: "c", tensions: [{ slug: "merge load is the real bottleneck:1", age: 2 }] },
      ]),
    ).toEqual([
      { anima: "b", slug: "house-I-will-inhabit(4)", age: 9, text: "house I will inhabit" },
      {
        anima: "a",
        slug: "fix-shipped:needs_restart",
        age: 3,
        text: "fix shipped: needs restart",
      },
      {
        anima: "c",
        slug: "merge load is the real bottleneck:1",
        age: 2,
        text: "merge load is the real bottleneck",
      },
    ]);
  });
});

describe("anima header readers", () => {
  it("splits voice samples on their tags", () => {
    expect(parseVoiceSamples("[review] The canvas moved, 13 percent.,[plan] Keep it")).toEqual([
      { tag: "review", text: "The canvas moved, 13 percent." },
      { tag: "plan", text: "Keep it" },
    ]);
  });

  it("reads kin with and without a strength", () => {
    expect(parseKin("cobalt=quiet-builder.2,ion=sibling:?")).toEqual([
      { name: "cobalt", label: "quiet builder", strength: 2 },
      { name: "ion", label: "sibling", strength: null },
    ]);
  });

  it("reads the user model", () => {
    expect(parseUserModel("direct=.95±.15,impatient-with-fluff=.85")).toEqual([
      { name: "direct", mean: 0.95, sigma: 0.15 },
      { name: "impatient with fluff", mean: 0.85, sigma: null },
    ]);
  });

  it("decodes the soul colour", () => {
    expect(soulMeaning("185,72,38")).toMatchObject({
      domain: "frontend",
      focusLabel: "focused",
      vitalityLabel: "fading",
    });
    expect(soulMeaning("350,10,70")).toMatchObject({ domain: "systems", vitalityLabel: "vital" });
    expect(soulMeaning(null)).toBeNull();
  });
});
