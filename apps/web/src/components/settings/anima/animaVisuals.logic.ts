import type { AnimaShape } from "@t3tools/contracts";

export interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Parses the contract's "H,S,L" string; null when absent or malformed. */
export function parseHsl(value: string | null | undefined): Hsl | null {
  if (!value) return null;
  const parts = value.split(",").map((part) => Number.parseFloat(part));
  if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
  return {
    h: ((parts[0]! % 360) + 360) % 360,
    s: clamp(parts[1]!, 0, 100),
    l: clamp(parts[2]!, 0, 100),
  };
}

/** Same perceptual mapping as the original dashboard: saturation 0-100 becomes OKLCH chroma 0.01-0.29. */
export function hslToCss(hsl: Hsl, alpha?: number): string {
  const chroma = (0.01 + hsl.s * 0.0028).toFixed(3);
  const lightness = clamp(hsl.l, 18, 92);
  const tail = alpha === undefined ? "" : ` / ${alpha}`;
  return `oklch(${lightness}% ${chroma} ${Math.round(hsl.h)}${tail})`;
}

function breathCss(value: string | null | undefined, fallback: string): string {
  const hsl = parseHsl(value);
  return hsl ? hslToCss(hsl) : fallback;
}

function clampUnit(value: number): number {
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
}

export function shapeMagnitude(shape: AnimaShape | null): number {
  if (!shape) return 0;
  const { breadth, depth, coupling } = {
    breadth: clampUnit(shape.breadth),
    depth: clampUnit(shape.depth),
    coupling: clampUnit(shape.coupling),
  };
  return Math.sqrt(breadth * breadth + depth * depth + coupling * coupling) / Math.sqrt(3);
}

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = 0.5;

/**
 * Isometric projection of a unit-cube coordinate. As in the original dashboard, coupling is the
 * vertical axis, breadth runs right and depth runs into the screen.
 */
export function projectIso(shape: AnimaShape, scale: number, origin: Point): Point {
  const x = clampUnit(shape.breadth);
  const z = clampUnit(shape.depth);
  const y = clampUnit(shape.coupling);
  return {
    x: origin.x + (x - z) * COS30 * scale,
    y: origin.y + (x + z) * SIN30 * scale - y * scale,
  };
}

export interface CubeGeometry {
  readonly edges: ReadonlyArray<readonly [Point, Point]>;
  readonly floor: ReadonlyArray<Point>;
  readonly axes: { readonly breadth: Point; readonly depth: Point; readonly coupling: Point };
  readonly origin: Point;
  readonly scale: number;
}

export function cubeGeometry(width: number, height: number): CubeGeometry {
  const scale = Math.min(width / (2 * COS30), height / 2) * 0.82;
  const origin: Point = { x: width / 2, y: height / 2 };
  const corner = (breadth: number, depth: number, coupling: number) =>
    projectIso({ breadth, depth, coupling }, scale, origin);
  const edges: Array<readonly [Point, Point]> = [];
  for (const a of [0, 1]) {
    for (const b of [0, 1]) {
      edges.push([corner(0, a, b), corner(1, a, b)]);
      edges.push([corner(a, 0, b), corner(a, 1, b)]);
      edges.push([corner(a, b, 0), corner(a, b, 1)]);
    }
  }
  return {
    edges,
    floor: [corner(0, 0, 0), corner(1, 0, 0), corner(1, 1, 0), corner(0, 1, 0)],
    axes: { breadth: corner(1, 0, 0), depth: corner(0, 1, 0), coupling: corner(0, 0, 1) },
    origin,
    scale,
  };
}

export interface TrajectoryPoint extends Point {
  readonly index: number;
  readonly color: string;
}

export function trajectory(
  breaths: ReadonlyArray<{
    readonly index: number;
    readonly shape: AnimaShape | null;
    readonly hsl: string | null;
  }>,
  geometry: Pick<CubeGeometry, "scale" | "origin">,
  fallback: string,
): ReadonlyArray<TrajectoryPoint> {
  return breaths
    .filter((breath) => breath.shape !== null)
    .toSorted((a, b) => a.index - b.index)
    .map((breath) => ({
      index: breath.index,
      color: breathCss(breath.hsl, fallback),
      ...projectIso(breath.shape!, geometry.scale, geometry.origin),
    }));
}

export function pointsAttr(points: ReadonlyArray<Point>): string {
  return points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

export interface TimelineDot {
  readonly index: number;
  readonly color: string;
  readonly radius: number;
  readonly x: number;
}

/** One dot per breath, oldest first; radius grows with shape magnitude. */
export function timelineDots(
  breaths: ReadonlyArray<{
    readonly index: number;
    readonly shape: AnimaShape | null;
    readonly hsl: string | null;
  }>,
  options: { readonly width: number; readonly minRadius: number; readonly maxRadius: number },
  fallback: string,
): ReadonlyArray<TimelineDot> {
  const sorted = breaths.toSorted((a, b) => a.index - b.index);
  const pad = options.maxRadius + 1;
  const span = Math.max(0, options.width - pad * 2);
  return sorted.map((breath, position) => ({
    index: breath.index,
    color: breathCss(breath.hsl, fallback),
    radius:
      options.minRadius + shapeMagnitude(breath.shape) * (options.maxRadius - options.minRadius),
    x: sorted.length === 1 ? options.width / 2 : pad + (span * position) / (sorted.length - 1),
  }));
}

/** Polygon vertices for values in 0..1 around a centre, starting at the top and going clockwise. */
export function radarPoints(
  values: ReadonlyArray<number>,
  radius: number,
  centre: Point,
): ReadonlyArray<Point> {
  return values.map((value, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / values.length;
    const r = radius * clampUnit(value);
    return { x: centre.x + Math.cos(angle) * r, y: centre.y + Math.sin(angle) * r };
  });
}

export function radarAxisEnd(index: number, count: number, radius: number, centre: Point): Point {
  return radarPoints(
    Array.from({ length: count }, (_, i) => (i === index ? 1 : 0)),
    radius,
    centre,
  )[index]!;
}

export interface SigilSegment {
  readonly path: string;
  readonly lit: boolean;
}

/** Ring segments: one per breath up to `cap`; all lit, or a dim ring when there are none. */
export function sigilSegments(
  breathCount: number,
  cap: number,
  radius: number,
  centre: Point,
): ReadonlyArray<SigilSegment> {
  const count = Math.max(1, Math.min(cap, breathCount));
  const gap = count === 1 ? 0 : 0.06;
  return Array.from({ length: count }, (_, i) => {
    const start = -Math.PI / 2 + (2 * Math.PI * i) / count + gap / 2;
    const end = -Math.PI / 2 + (2 * Math.PI * (i + 1)) / count - gap / 2;
    const at = (angle: number) =>
      `${(centre.x + Math.cos(angle) * radius).toFixed(2)} ${(centre.y + Math.sin(angle) * radius).toFixed(2)}`;
    const large = end - start > Math.PI ? 1 : 0;
    // A full circle cannot be one arc; split it.
    const path =
      count === 1
        ? `M ${at(start)} A ${radius} ${radius} 0 1 1 ${at(start + Math.PI)} A ${radius} ${radius} 0 1 1 ${at(start + 2 * Math.PI - 0.001)}`
        : `M ${at(start)} A ${radius} ${radius} 0 ${large} 1 ${at(end)}`;
    return { path, lit: breathCount > 0 };
  });
}

export function sigilTicks(
  count: number,
  innerRadius: number,
  outerRadius: number,
  centre: Point,
): ReadonlyArray<readonly [Point, Point]> {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [
      { x: centre.x + cos * innerRadius, y: centre.y + sin * innerRadius },
      { x: centre.x + cos * outerRadius, y: centre.y + sin * outerRadius },
    ] as const;
  });
}

export interface ConstellationNode<T> {
  readonly item: T;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** x = breadth, y = depth (deep at the bottom), radius = coupling. Animas without a shape are listed separately. */
export function constellationNodes<T extends { readonly shape: AnimaShape | null }>(
  items: ReadonlyArray<T>,
  box: { readonly width: number; readonly height: number; readonly pad: number },
  radii: { readonly min: number; readonly max: number },
): { readonly placed: ReadonlyArray<ConstellationNode<T>>; readonly unplaced: ReadonlyArray<T> } {
  const placed: Array<ConstellationNode<T>> = [];
  const unplaced: T[] = [];
  for (const item of items) {
    if (!item.shape) {
      unplaced.push(item);
      continue;
    }
    placed.push({
      item,
      x: box.pad + clampUnit(item.shape.breadth) * (box.width - box.pad * 2),
      y: box.pad + (1 - clampUnit(item.shape.depth)) * (box.height - box.pad * 2),
      radius: radii.min + clampUnit(item.shape.coupling) * (radii.max - radii.min),
    });
  }
  return { placed, unplaced };
}

export type NameProblem = "empty" | "invalid" | "duplicate" | null;

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function animaNameProblem(name: string, existing: ReadonlyArray<string>): NameProblem {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (!NAME_PATTERN.test(trimmed)) return "invalid";
  const lower = trimmed.toLowerCase();
  return existing.some((entry) => entry.toLowerCase() === lower) ? "duplicate" : null;
}

export function describeNameProblem(problem: NameProblem): string | null {
  switch (problem) {
    case "invalid":
      return "Use letters, digits, '.', '_' or '-', starting with a letter or digit (max 64).";
    case "duplicate":
      return "An anima with this name already exists.";
    default:
      return null;
  }
}
