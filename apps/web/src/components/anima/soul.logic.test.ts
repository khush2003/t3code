import { describe, expect, it } from "vite-plus/test";

import { midiToHz, parseBreathNote } from "./soul.logic";

describe("parseBreathNote", () => {
  it.each([
    [
      "D4.M.72.1.3.120",
      { pitch: "D4", midi: 62, quality: "major", velocity: 72, beats: 1, tempo: 120 },
    ],
    [
      "E4.aeolian.moderate.half.3.andante",
      { pitch: "E4", midi: 64, quality: "minor", velocity: 72, beats: 2, tempo: 90 },
    ],
    [
      "C4.m.50.1.2.100",
      { pitch: "C4", midi: 60, quality: "minor", velocity: 50, beats: 1, tempo: 100 },
    ],
    [
      "F#3.dim.loud.quarter.5.presto",
      { pitch: "F#3", midi: 54, quality: "diminished", velocity: 96, beats: 1, tempo: 170 },
    ],
  ])("reads %s", (note, expected) => {
    expect(parseBreathNote(note)).toEqual(expected);
  });

  it("rejects prose notes", () => {
    expect(parseBreathNote("shipped the roster view")).toBeNull();
    expect(parseBreathNote("Fixed the bug. Then tests. Then docs. Done.")).toBeNull();
  });

  it("clamps out-of-range values", () => {
    expect(parseBreathNote("A4.M.400.99.1.999")).toMatchObject({
      velocity: 127,
      beats: 8,
      tempo: 220,
    });
  });

  it("tunes A4 to 440Hz", () => {
    expect(midiToHz(69)).toBe(440);
  });
});
