import { describe, expect, it } from "vite-plus/test";

import { placeBotStars, spokenUnits } from "./botSpace.logic";

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
    ].join("\n");
    expect(spokenUnits(reply, true)).toEqual([
      "Posters",
      "Two tasks are running.",
      "The build one failed; see the log.",
      "Retry the build",
      "Ask Sam",
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
});
