import { describe, expect, it } from "vite-plus/test";

import { animaColor } from "./anima-presentation";

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
