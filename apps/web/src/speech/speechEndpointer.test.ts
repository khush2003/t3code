import { describe, expect, it } from "vite-plus/test";

import { createSpeechEndpointer } from "./speechEndpointer";

/** Feeds one meter reading every 50 ms and gives what the endpointer said at each. */
function hear(levels: ReadonlyArray<number>, guarded = false) {
  const endpointer = createSpeechEndpointer();
  return levels.flatMap((level, index) => {
    const said = endpointer.push(level, index * 50, guarded);
    return said === null ? [] : [`${said}@${index * 50}`];
  });
}

const quiet = (count: number, level = 0.01) => Array.from({ length: count }, () => level);
const loud = (count: number, level = 0.4) => Array.from({ length: count }, () => level);

describe("speech endpointer", () => {
  it("hears speech start, rides out a breath, and ends it after a real pause", () => {
    expect(
      hear([...quiet(10), ...loud(10), ...quiet(6), ...loud(6), ...quiet(20), ...quiet(10)]),
    ).toEqual(["start@650", "end@2400"]);
  });

  it("ignores a click, a steady fan, and the bot's own voice coming back", () => {
    expect(hear([...quiet(10), 0.5, ...quiet(20)])).toEqual([]);
    expect(hear([...quiet(4), ...quiet(200, 0.12)])).toEqual(["start@350", "end@1900"]);
    expect(hear([...quiet(10), ...loud(10, 0.09), ...quiet(20)], true)).toEqual([]);
    expect(hear([...quiet(10), ...loud(10, 0.5), ...quiet(20)], true)).toEqual([
      "start@650",
      "end@1800",
    ]);
  });
});
