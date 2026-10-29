import type { AnimaSummary } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { RelativeTime } from "./AnimaBits";
import { familyLayout, type FamilyEdgeKind } from "./animaPortrait.logic";
import { SoulOrb, animaSoulColors } from "./AnimaSoul";

const CELL_WIDTH = 128;
const CELL_HEIGHT = 108;
/** Orb centre within a cell, as a fraction of the cell height. */
const ORB_Y = 0.36;

const EDGE_LABELS: Record<FamilyEdgeKind, string> = {
  parent: "parent and child",
  crew: "lead and crew",
  kin: "kin",
};

function orbSize(anima: AnimaSummary): number {
  return Math.round(Math.min(46, 16 + Math.sqrt(anima.breathCount) * 2.6));
}

/**
 * The original dashboard's constellation: every anima as a soul orb, with the parent, crew and
 * kin bonds drawn between them. Hovering one lights its bonds and shows who it is.
 */
export function FamilyConstellation({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: (name: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(8);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const hover = (name: string) => {
    setHovered(name);
    setSelected(name);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the container, a DOM size, to fit the grid's columns
  useLayoutEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    return observeResize(element, (entries) => {
      const width = entries.at(-1)?.contentRect.width ?? 0;
      if (width > 0) setColumns(Math.max(3, Math.min(10, Math.floor(width / CELL_WIDTH))));
    });
  }, []);
  const { nodes, edges, rows } = familyLayout(animas, columns);
  const position = new Map(nodes.map((node) => [node.anima.name, node]));
  const linked = new Set(
    hovered === null
      ? []
      : edges.flatMap((edge) =>
          edge.from === hovered || edge.to === hovered ? [edge.from, edge.to] : [],
        ),
  );
  const focus = animas.find((anima) => anima.name === selected) ?? null;
  const focusLinks = new Set(
    edges.flatMap((edge) =>
      edge.from === selected || edge.to === selected ? [edge.from, edge.to] : [],
    ),
  );
  const point = (name: string) => {
    const node = position.get(name)!;
    return { x: node.col + 0.5, y: node.row + ORB_Y };
  };
  const kinds = [...new Set(edges.map((edge) => edge.kind))];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
      <div
        ref={hostRef}
        className="relative overflow-hidden rounded-3xl border border-border/60 bg-card px-2 py-4 shadow-xs"
      >
        <div
          className="relative"
          style={{ height: rows * CELL_HEIGHT }}
          onMouseLeave={() => setHovered(null)}
        >
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 size-full"
            viewBox={`0 0 ${columns} ${rows}`}
            preserveAspectRatio="none"
          >
            <defs>
              {edges
                .filter((edge) => edge.kind === "kin")
                .map((edge) => {
                  const from = point(edge.from);
                  const to = point(edge.to);
                  return (
                    <linearGradient
                      key={`${edge.from}-${edge.to}`}
                      id={`kin-${edge.from}-${edge.to}`}
                      gradientUnits="userSpaceOnUse"
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                    >
                      <stop
                        offset="0"
                        stopColor={animaSoulColors(position.get(edge.from)!.anima).core}
                      />
                      <stop
                        offset="1"
                        stopColor={animaSoulColors(position.get(edge.to)!.anima).core}
                      />
                    </linearGradient>
                  );
                })}
            </defs>
            {edges.map((edge) => {
              const from = point(edge.from);
              const to = point(edge.to);
              const lift = edge.kind === "kin" ? 0.55 : 0.35;
              const path = `M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${Math.min(from.y, to.y) - lift} ${to.x} ${to.y}`;
              const touches = hovered !== null && (edge.from === hovered || edge.to === hovered);
              const opacity = hovered === null ? 0.25 + edge.weight * 0.35 : touches ? 0.95 : 0.05;
              return (
                <path
                  key={`${edge.kind}:${edge.from}:${edge.to}`}
                  d={path}
                  fill="none"
                  stroke={
                    edge.kind === "kin"
                      ? `url(#kin-${edge.from}-${edge.to})`
                      : animaSoulColors(position.get(edge.from)!.anima).core
                  }
                  strokeOpacity={opacity}
                  strokeWidth={
                    (edge.kind === "kin" ? 1 : 1.5) + edge.weight * 1.5 + (touches ? 1 : 0)
                  }
                  strokeDasharray={edge.kind === "parent" ? "5 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                  style={{ transition: "stroke-opacity 200ms" }}
                />
              );
            })}
          </svg>
          {nodes.map(({ anima, col, row }) => {
            const size = orbSize(anima);
            const dim = hovered !== null && hovered !== anima.name && !linked.has(anima.name);
            return (
              <button
                key={anima.name}
                type="button"
                onClick={() => onOpen(anima.name)}
                onMouseEnter={() => hover(anima.name)}
                onFocus={() => hover(anima.name)}
                className={cn(
                  "absolute flex -translate-x-1/2 flex-col items-center gap-1.5 rounded-xl px-1 outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  dim && "opacity-25",
                  !anima.enabled && "grayscale",
                )}
                style={{
                  left: `${((col + 0.5) / columns) * 100}%`,
                  top: row * CELL_HEIGHT + ORB_Y * CELL_HEIGHT - size / 2,
                  width: CELL_WIDTH - 12,
                }}
              >
                <span
                  className={cn(
                    "rounded-full transition-transform duration-200",
                    hovered === anima.name && "scale-125",
                    anima.live && "ring-2 ring-success ring-offset-2 ring-offset-card",
                  )}
                >
                  <SoulOrb anima={anima} size={size} />
                </span>
                <span className="max-w-full truncate text-xs font-medium">{anima.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <aside className="space-y-4">
        {focus ? (
          <div className="space-y-3 rounded-3xl border border-border/60 bg-card p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <SoulOrb anima={focus} size={44} />
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold">{focus.name}</p>
                <p className="text-xs text-muted-foreground">
                  {focus.role} · {focus.breathCount} breaths ·{" "}
                  <RelativeTime value={focus.lastActiveAt ?? focus.lastBreathAt} />
                </p>
              </div>
            </div>
            {focus.vow ? (
              <p className="font-serif text-sm text-muted-foreground italic">“{focus.vow}”</p>
            ) : null}
            {focus.aim ? <p className="text-sm leading-snug">→ {focus.aim}</p> : null}
            <p className="text-xs text-muted-foreground">
              {focusLinks.size > 0
                ? `Tied to ${focusLinks.size - 1} ${focusLinks.size === 2 ? "anima" : "animas"} here`
                : "No bonds drawn yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-2 rounded-3xl border border-dashed border-border/70 p-5 text-sm text-muted-foreground">
            <p>Hover an anima to see who it is and light up its bonds.</p>
            <p className="text-xs">
              Bigger orbs have lived more. A green ring means a live session.
            </p>
          </div>
        )}
        {kinds.length > 0 ? (
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {kinds.map((kind) => (
              <li key={kind} className="flex items-center gap-2">
                <svg width="28" height="6" aria-hidden className="text-foreground/50">
                  <line
                    x1="0"
                    y1="3"
                    x2="28"
                    y2="3"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeDasharray={kind === "parent" ? "5 4" : undefined}
                  />
                </svg>
                {EDGE_LABELS[kind]} · {edges.filter((edge) => edge.kind === kind).length}
              </li>
            ))}
          </ul>
        ) : null}
        {focus ? (
          <Button size="sm" variant="outline" onClick={() => onOpen(focus.name)}>
            Open {focus.name}
            <ArrowRightIcon />
          </Button>
        ) : null}
      </aside>
    </div>
  );
}
