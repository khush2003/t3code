import { describe, expect, it } from "vite-plus/test";

import {
  animaNameProblem,
  constellationNodes,
  cubeGeometry,
  hslToCss,
  parseHsl,
  projectIso,
  radarPoints,
  shapeMagnitude,
  sigilSegments,
  timelineDots,
  trajectory,
} from "./animaVisuals.logic";

describe("hsl", () => {
  it("parses and rejects", () => {
    expect(parseHsl("120,50,40")).toEqual({ h: 120, s: 50, l: 40 });
    expect(parseHsl("-30,150,40")).toEqual({ h: 330, s: 100, l: 40 });
    expect(parseHsl("a,b,c")).toBeNull();
    expect(parseHsl(null)).toBeNull();
  });
  it("maps saturation to oklch chroma", () => {
    expect(hslToCss({ h: 120, s: 100, l: 50 })).toBe("oklch(50% 0.290 120)");
    expect(hslToCss({ h: 10, s: 0, l: 50 }, 0.5)).toBe("oklch(50% 0.010 10 / 0.5)");
  });
});

describe("cube", () => {
  it("projects the origin and corners isometrically", () => {
    const o = { x: 100, y: 100 };
    expect(projectIso({ breadth: 0, depth: 0, coupling: 0 }, 50, o)).toEqual(o);
    const up = projectIso({ breadth: 0, depth: 0, coupling: 1 }, 50, o);
    expect(up).toEqual({ x: 100, y: 50 });
    const right = projectIso({ breadth: 1, depth: 0, coupling: 0 }, 50, o);
    expect(right.x).toBeGreaterThan(100);
    expect(right.y).toBeGreaterThan(100);
  });
  it("clamps out-of-range coordinates", () => {
    const o = { x: 0, y: 0 };
    expect(projectIso({ breadth: 5, depth: 0, coupling: 0 }, 10, o)).toEqual(
      projectIso({ breadth: 1, depth: 0, coupling: 0 }, 10, o),
    );
  });
  it("builds 12 edges that fit the viewbox", () => {
    const g = cubeGeometry(200, 160);
    expect(g.edges).toHaveLength(12);
    for (const [a, b] of g.edges) {
      for (const p of [a, b]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(200);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(160);
      }
    }
  });
});

describe("trajectory and timeline", () => {
  const breaths = [
    { index: 2, shape: { breadth: 1, depth: 1, coupling: 1 }, hsl: "0,100,50" },
    { index: 1, shape: null, hsl: null },
    { index: 0, shape: { breadth: 0, depth: 0, coupling: 0 }, hsl: "bad" },
  ];
  it("orders by index, skips missing shapes and falls back on colour", () => {
    const points = trajectory(breaths, { scale: 10, origin: { x: 0, y: 0 } }, "grey");
    expect(points.map((p) => p.index)).toEqual([0, 2]);
    expect(points[0]!.color).toBe("grey");
    expect(points[1]!.color).toContain("oklch");
  });
  it("sizes dots by magnitude and spreads them across the width", () => {
    const dots = timelineDots(breaths, { width: 100, minRadius: 2, maxRadius: 6 }, "grey");
    expect(dots.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(dots[0]!.radius).toBe(2);
    expect(dots[2]!.radius).toBeCloseTo(6);
    expect(dots[0]!.x).toBeLessThan(dots[2]!.x);
    expect(
      timelineDots(breaths.slice(0, 1), { width: 100, minRadius: 2, maxRadius: 6 }, "g")[0]!.x,
    ).toBe(50);
  });
  it("magnitude of null is zero", () => expect(shapeMagnitude(null)).toBe(0));
});

describe("radar", () => {
  it("starts at the top and clamps", () => {
    const [top, right] = radarPoints([1, 2, 0, 0], 10, { x: 50, y: 50 });
    expect(top!.x).toBeCloseTo(50);
    expect(top!.y).toBeCloseTo(40);
    expect(right!.x).toBeCloseTo(60);
  });
});

describe("sigil", () => {
  it("caps segments and handles zero breaths", () => {
    expect(sigilSegments(100, 24, 10, { x: 0, y: 0 })).toHaveLength(24);
    const none = sigilSegments(0, 24, 10, { x: 0, y: 0 });
    expect(none).toHaveLength(1);
    expect(none[0]!.lit).toBe(false);
    expect(sigilSegments(3, 24, 10, { x: 0, y: 0 })).toHaveLength(3);
  });
});

describe("constellation", () => {
  it("places by breadth/depth and separates shapeless animas", () => {
    const { placed, unplaced } = constellationNodes(
      [
        { shape: { breadth: 0, depth: 1, coupling: 0 } },
        { shape: { breadth: 1, depth: 0, coupling: 1 } },
        { shape: null },
      ],
      { width: 100, height: 100, pad: 10 },
      { min: 2, max: 8 },
    );
    expect(unplaced).toHaveLength(1);
    expect(placed[0]).toMatchObject({ x: 10, y: 10, radius: 2 });
    expect(placed[1]).toMatchObject({ x: 90, y: 90, radius: 8 });
  });
});

describe("animaNameProblem", () => {
  it("validates against the pattern and the roster case-insensitively", () => {
    expect(animaNameProblem("  ", [])).toBe("empty");
    expect(animaNameProblem("-bad", [])).toBe("invalid");
    expect(animaNameProblem("has space", [])).toBe("invalid");
    expect(animaNameProblem("Ada", ["ada"])).toBe("duplicate");
    expect(animaNameProblem("ada.2", ["ada"])).toBeNull();
  });
});
