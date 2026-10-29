import type { AnimaSummary } from "@t3tools/contracts";
import { TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ANIMA_HEALTH_LABELS, animaHealthBucket, type AnimaTab } from "./anima.logic";
import { searchAnimas, type AnimaSearchHit } from "./animaDashboard.logic";
import { AnimaHealthRing } from "./AnimaHealth";
import { SoulOrb } from "./AnimaSoul";

export const ANIMA_SEARCH_INPUT_ID = "anima-search";

type OpenAnima = (name: string, tab?: AnimaTab) => void;

/** The original's alerts banner: animas whose health asks for tending now, dismissible for the visit. */
export function AlertsBanner({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const [dismissed, setDismissed] = useState(false);
  const urgent = animas
    .filter((anima) => anima.enabled && animaHealthBucket(anima.health) === "tend")
    .toSorted((a, b) => (b.health ?? 0) - (a.health ?? 0));
  if (dismissed || urgent.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3">
      <TriangleAlertIcon className="size-4 shrink-0 text-warning" />
      <span className="text-sm font-medium">
        {urgent.length} {urgent.length === 1 ? "anima needs" : "animas need"} tending
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {urgent.slice(0, 8).map((anima) => (
          <button
            key={anima.name}
            type="button"
            onClick={() => onOpen(anima.name, "health")}
            className="flex items-center gap-1.5 rounded-full bg-background/80 py-0.5 pr-2.5 pl-0.5 text-xs outline-none hover:bg-background focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <SoulOrb anima={anima} size={18} />
            {anima.name}
          </button>
        ))}
        {urgent.length > 8 ? (
          <span className="self-center text-xs text-muted-foreground">
            +{urgent.length - 8} more
          </span>
        ) : null}
      </div>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        <XIcon />
      </Button>
    </div>
  );
}

/** The original's health panel: every anima that is not steady, most in need first. */
export function HealthPanel({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const [all, setAll] = useState(false);
  const needing = animas
    .filter((anima) => {
      const bucket = animaHealthBucket(anima.health);
      return bucket === "watch" || bucket === "tend";
    })
    .toSorted((a, b) => (b.health ?? 0) - (a.health ?? 0));
  if (needing.length === 0) {
    return <p className="text-sm text-muted-foreground">Every anima is steady.</p>;
  }
  const shown = all ? needing : needing.slice(0, 12);
  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {shown.map((anima) => {
          const bucket = animaHealthBucket(anima.health);
          return (
            <li key={anima.name}>
              <button
                type="button"
                onClick={() => onOpen(anima.name, "health")}
                className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-xs outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <AnimaHealthRing score={anima.health} size={40} showValue />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <SoulOrb anima={anima} size={12} />
                    <span className="truncate">{anima.name}</span>
                  </span>
                  <span
                    className={cn(
                      "text-xs",
                      bucket === "tend" ? "text-destructive" : "text-warning",
                    )}
                  >
                    {ANIMA_HEALTH_LABELS[bucket]}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {needing.length > 12 ? (
        <Button size="xs" variant="ghost" onClick={() => setAll((value) => !value)}>
          {all ? "Show fewer" : `Show all ${needing.length}`}
        </Button>
      ) : null}
    </div>
  );
}

const KIND_LABELS: Record<AnimaSearchHit["kind"], string> = {
  anima: "anima",
  aim: "aim",
  vow: "vow",
  memo: "memo",
  tension: "tension",
  skill: "skill",
  project: "project",
};

function Highlight({ text, query }: { readonly text: string; readonly query: string }) {
  const at = text.toLowerCase().indexOf(query.toLowerCase().trim());
  if (at < 0 || query.trim() === "") return <>{text}</>;
  const end = at + query.trim().length;
  const start = Math.max(0, at - 50);
  return (
    <>
      {start > 0 ? "..." : ""}
      {text.slice(start, at)}
      <mark className="rounded-sm bg-warning/30 text-foreground">{text.slice(at, end)}</mark>
      {text.slice(end, end + 80)}
      {end + 80 < text.length ? "..." : ""}
    </>
  );
}

/** Searches every anima's name, aim, vow, memo, tensions, skills and home, like the original's palette. */
export function AnimaSearch({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const hits = searchAnimas(animas, query);
  const byName = new Map(animas.map((anima) => [anima.name, anima]));
  const choose = (hit: AnimaSearchHit | undefined) => {
    if (!hit) return;
    setQuery("");
    onOpen(hit.anima);
  };
  return (
    <div className="relative">
      <Input
        id={ANIMA_SEARCH_INPUT_ID}
        value={query}
        placeholder="Search animas, aims, tensions, skills...   ( / )"
        aria-label="Search animas"
        autoComplete="off"
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((index) => Math.min(hits.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(0, index - 1));
          } else if (event.key === "Enter") {
            choose(hits[active]);
          } else if (event.key === "Escape") {
            setQuery("");
            event.currentTarget.blur();
          }
        }}
      />
      {query.trim().length >= 2 ? (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border/70 bg-popover shadow-lg">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No results</p>
          ) : (
            <ul
              role="listbox"
              aria-label="Search results"
              className="max-h-96 overflow-y-auto py-1"
            >
              {hits.map((hit, index) => {
                const anima = byName.get(hit.anima);
                return (
                  <li
                    key={`${hit.anima}:${hit.kind}:${hit.text}`}
                    role="option"
                    aria-selected={index === active}
                  >
                    <button
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(hit)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-2.5 text-left outline-none",
                        index === active && "bg-accent",
                      )}
                    >
                      {anima ? <SoulOrb anima={anima} size={22} /> : null}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-xs">
                          <span className="font-semibold">{hit.anima}</span>
                          <span className="text-muted-foreground">{KIND_LABELS[hit.kind]}</span>
                        </span>
                        {hit.kind === "anima" ? null : (
                          <span className="block truncate text-sm text-foreground/85">
                            <Highlight text={hit.text} query={query} />
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
