import { useId, useRef, useState, type PointerEvent } from "react";
import type { AnimaBreath, AnimaSummary, AnimaTrait } from "@t3tools/contracts";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { safeAnimaAccent } from "./anima.logic";
import {
  constellationNodes,
  cubeGeometry,
  parseHsl,
  hslToCss,
  type OrbitView,
  pointsAttr,
  radarAxisEnd,
  radarPoints,
  sigilSegments,
  sigilTicks,
  trajectory,
} from "./animaVisuals.logic";

/** Everything here is static SVG/HTML: repainting animations are off limits, only hover transitions. */

export function animaColor(summary: Pick<AnimaSummary, "hsl" | "accent">): string | null {
  const hsl = parseHsl(summary.hsl);
  return hsl ? hslToCss(hsl) : safeAnimaAccent(summary.accent);
}

export function AnimaSigil({
  anima,
  size = 40,
  className,
}: {
  readonly anima: Pick<AnimaSummary, "hsl" | "accent" | "breathCount" | "live">;
  readonly size?: number;
  readonly className?: string;
}) {
  const gradientId = useId();
  const color = animaColor(anima);
  const accent = safeAnimaAccent(anima.accent);
  const centre = { x: 50, y: 50 };
  const segments = sigilSegments(anima.breathCount, 28, 40, centre);
  const ticks = sigilTicks(12, 44, 47, centre);
  const core = color ?? "currentColor";
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={color ? "Anima sigil" : "Anima sigil, no breaths yet"}
      className={cn("shrink-0 text-muted-foreground/50", className)}
    >
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0%" stopColor={core} stopOpacity={color ? 0.95 : 0.35} />
          <stop offset="55%" stopColor={core} stopOpacity={color ? 0.4 : 0.12} />
          <stop offset="100%" stopColor={core} stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={50} cy={50} r={36} fill={`url(#${gradientId})`} />
      <circle cx={50} cy={50} r={11} fill={core} fillOpacity={color ? 0.9 : 0.25} />
      {segments.map((segment) => (
        <path
          key={segment.path}
          d={segment.path}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          stroke={segment.lit ? (accent ?? core) : "currentColor"}
          strokeOpacity={segment.lit ? 0.85 : 0.35}
        />
      ))}
      {ticks.map(([from, to]) => (
        <line
          key={`${from.x}:${from.y}`}
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={1}
        />
      ))}
    </svg>
  );
}

const BODY_EXPLANATION =
  "Breadth: how many topics the work spans. Depth: how deep it goes in one area. Coupling: how connected the work is. Each point is a breath, coloured by its hue.";

const DEFAULT_ORBIT: OrbitView = { yaw: Math.PI / 4, pitch: 0.55 };

function latestWithShape(breaths: ReadonlyArray<AnimaBreath>) {
  return breaths.filter((breath) => breath.shape !== null).toSorted((a, b) => b.index - a.index)[0];
}

export function AnimaBodyPanel({
  breaths,
  accent,
  upTo,
  large = false,
}: {
  readonly breaths: ReadonlyArray<AnimaBreath>;
  readonly accent: string | null;
  /** Shows only the first N breaths, for traversing the body one breath at a time. */
  readonly upTo?: number;
  readonly large?: boolean;
}) {
  const width = 240;
  const height = 190;
  // The expanded body turns by dragging, like the original's orbit; the inline one stays isometric.
  const [view, setView] = useState<OrbitView>(DEFAULT_ORBIT);
  const drag = useRef<{ x: number; y: number; view: OrbitView } | null>(null);
  const geometry = cubeGeometry(width, height, large ? view : undefined);
  const fallback = safeAnimaAccent(accent) ?? "currentColor";
  const all = trajectory(breaths, geometry, fallback);
  const points = upTo === undefined ? all : all.slice(0, Math.max(1, upTo));
  const head = points.at(-1);
  const previous = points.at(-2);
  const latest = latestWithShape(breaths);
  const arrow = (() => {
    if (!head || !previous) return null;
    const dx = head.x - previous.x;
    const dy = head.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (length < 4) return null;
    const ux = dx / length;
    const uy = dy / length;
    const tip = { x: head.x + ux * 9, y: head.y + uy * 9 };
    const base = { x: head.x + ux * 4, y: head.y + uy * 4 };
    return pointsAttr([
      tip,
      { x: base.x - uy * 3, y: base.y + ux * 3 },
      { x: base.x + uy * 3, y: base.y - ux * 3 },
    ]);
  })();
  const label = (
    text: string,
    at: { x: number; y: number },
    anchor: "start" | "end" | "middle",
  ) => (
    <text x={at.x} y={at.y} textAnchor={anchor} className="fill-muted-foreground text-4xs">
      {text}
    </text>
  );
  return (
    <div className="space-y-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="block w-full cursor-help text-left outline-none"
              aria-label="What is the body?"
            />
          }
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Body trajectory in breadth, depth and coupling"
            className={cn(
              "mx-auto block w-full text-muted-foreground",
              large ? "max-w-3xl cursor-grab touch-none active:cursor-grabbing" : "max-w-[18rem]",
            )}
            {...(large
              ? {
                  onPointerDown: (event: PointerEvent<SVGSVGElement>) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { x: event.clientX, y: event.clientY, view };
                  },
                  onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
                    const start = drag.current;
                    if (!start) return;
                    setView({
                      yaw: start.view.yaw + (event.clientX - start.x) * 0.01,
                      pitch: Math.max(
                        0,
                        Math.min(1.45, start.view.pitch + (event.clientY - start.y) * 0.01),
                      ),
                    });
                  },
                  onPointerUp: () => {
                    drag.current = null;
                  },
                  onDoubleClick: () => setView(DEFAULT_ORBIT),
                }
              : {})}
          >
            <polygon points={pointsAttr(geometry.floor)} fill="currentColor" fillOpacity={0.06} />
            {geometry.edges.map(([from, to]) => (
              <line
                key={`${from.x}:${from.y}:${to.x}:${to.y}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeWidth={0.75}
              />
            ))}
            {label(
              "breadth",
              { x: geometry.axes.breadth.x + 4, y: geometry.axes.breadth.y + 8 },
              "start",
            )}
            {label("depth", { x: geometry.axes.depth.x - 4, y: geometry.axes.depth.y + 8 }, "end")}
            {label(
              "coupling",
              { x: geometry.axes.coupling.x, y: geometry.axes.coupling.y - 4 },
              "middle",
            )}
            {points.map((point) => (
              <g key={`floor-${point.index}`} opacity={point === head ? 0.6 : 0.25}>
                <line
                  x1={point.x}
                  y1={point.y}
                  x2={point.floor.x}
                  y2={point.floor.y}
                  stroke={point.color}
                  strokeWidth={0.5}
                  strokeDasharray="1.5 1.5"
                />
                <ellipse
                  cx={point.floor.x}
                  cy={point.floor.y}
                  rx={2.2}
                  ry={1.1}
                  fill="currentColor"
                  fillOpacity={0.5}
                />
              </g>
            ))}
            {points.slice(1).map((point, index) => {
              const from = points[index]!;
              return (
                <line
                  key={`trail-${point.index}`}
                  x1={from.x}
                  y1={from.y}
                  x2={point.x}
                  y2={point.y}
                  stroke={point.color}
                  strokeOpacity={0.3 + (0.45 * (index + 1)) / points.length}
                  strokeWidth={1.25}
                  strokeLinecap="round"
                />
              );
            })}
            {points.map((point) => (
              <circle
                key={point.index}
                cx={point.x}
                cy={point.y}
                r={point === head ? 4.5 : 2.5}
                fill={point.color}
                stroke={point === head ? "currentColor" : "none"}
                strokeWidth={1}
              >
                <title>{`Breath #${point.index}`}</title>
              </circle>
            ))}
            {arrow ? <polygon points={arrow} fill={head?.color ?? fallback} /> : null}
          </svg>
        </TooltipTrigger>
        <TooltipPopup>{BODY_EXPLANATION}</TooltipPopup>
      </Tooltip>
      {large ? (
        <p className="text-center text-2xs text-muted-foreground">
          Drag to turn it. Double-click to reset.
        </p>
      ) : null}
      {latest?.shape ? (
        <p className="text-center text-2xs tabular-nums text-muted-foreground">
          breadth {latest.shape.breadth.toFixed(2)} · depth {latest.shape.depth.toFixed(2)} ·
          coupling {latest.shape.coupling.toFixed(2)}
          {latest.drift
            ? ` · Δ ${latest.drift.breadth.toFixed(2)}/${latest.drift.depth.toFixed(2)}/${latest.drift.coupling.toFixed(2)}`
            : ""}
        </p>
      ) : (
        <p className="text-center text-2xs text-muted-foreground">No body recorded yet.</p>
      )}
    </div>
  );
}

export function TraitRadar({
  traits,
  limit = 6,
}: {
  readonly traits: ReadonlyArray<AnimaTrait>;
  readonly limit?: number;
}) {
  const top = traits.toSorted((a, b) => b.mean - a.mean).slice(0, limit);
  if (top.length < 3) return null;
  const size = 160;
  const centre = { x: size / 2, y: size / 2 };
  const radius = 52;
  const polygon = radarPoints(
    top.map((trait) => trait.mean),
    radius,
    centre,
  );
  const ring = (scale: number) =>
    pointsAttr(
      radarPoints(
        top.map(() => scale),
        radius,
        centre,
      ),
    );
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Trait radar"
      className="mx-auto block w-full max-w-[10rem] text-muted-foreground"
    >
      {[0.5, 1].map((scale) => (
        <polygon
          key={scale}
          points={ring(scale)}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeWidth={0.75}
        />
      ))}
      {top.map((trait, i) => {
        const end = radarAxisEnd(i, top.length, radius, centre);
        const label = radarAxisEnd(i, top.length, radius + 9, centre);
        return (
          <g key={trait.name}>
            <line
              x1={centre.x}
              y1={centre.y}
              x2={end.x}
              y2={end.y}
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeWidth={0.75}
            />
            <text
              x={label.x}
              y={label.y}
              textAnchor={
                label.x < centre.x - 2 ? "end" : label.x > centre.x + 2 ? "start" : "middle"
              }
              dominantBaseline="middle"
              className="fill-muted-foreground text-5xs"
            >
              {trait.name.length > 12 ? `${trait.name.slice(0, 11)}…` : trait.name}
            </text>
          </g>
        );
      })}
      <polygon
        points={pointsAttr(polygon)}
        className="fill-primary/25 stroke-primary"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AnimaConstellation({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: (name: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const width = 400;
  const height = 260;
  const { placed, unplaced } = constellationNodes(
    animas,
    { width, height, pad: 28 },
    { min: 5, max: 14 },
  );
  return (
    <div className="space-y-2 px-3 py-3 sm:px-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label="Constellation of animas by breadth and depth"
        className="block w-full text-muted-foreground"
      >
        <rect
          x={1}
          y={1}
          width={width - 2}
          height={height - 2}
          rx={8}
          fill="currentColor"
          fillOpacity={0.04}
          stroke="currentColor"
          strokeOpacity={0.25}
        />
        <text
          x={width - 8}
          y={height - 8}
          textAnchor="end"
          className="fill-muted-foreground text-3xs"
        >
          breadth →
        </text>
        <text x={8} y={14} className="fill-muted-foreground text-3xs">
          ↑ shallow
        </text>
        <text x={8} y={height - 8} className="fill-muted-foreground text-3xs">
          deep
        </text>
        {placed.map((node) => {
          const anima = node.item;
          const color = animaColor(anima) ?? "currentColor";
          const showLabel = hovered === anima.name;
          return (
            <g
              key={anima.name}
              role="button"
              tabIndex={0}
              aria-label={`Open ${anima.name}`}
              className="cursor-pointer outline-none [&:focus-visible>circle:last-of-type]:stroke-ring"
              onClick={() => onOpen(anima.name)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(anima.name);
                }
              }}
              onMouseEnter={() => setHovered(anima.name)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(anima.name)}
              onBlur={() => setHovered(null)}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius * 1.9}
                fill={color}
                fillOpacity={0.15}
              />
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius}
                fill={color}
                fillOpacity={anima.enabled ? 0.9 : 0.4}
                stroke="transparent"
                strokeWidth={2}
              />
              <title>{anima.name}</title>
              {showLabel ? (
                <text
                  x={node.x}
                  y={node.y - node.radius - 6}
                  textAnchor="middle"
                  className="fill-foreground text-3xs font-medium"
                >
                  {anima.name}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <p className="text-2xs text-muted-foreground">
        Position is breadth and depth of the latest breath, size is coupling.
        {unplaced.length > 0
          ? ` ${unplaced.length} without a body yet: ${unplaced.map((anima) => anima.name).join(", ")}.`
          : ""}
      </p>
    </div>
  );
}
