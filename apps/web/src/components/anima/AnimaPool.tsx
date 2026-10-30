import type { AnimaSummary } from "@t3tools/contracts";
import { EyeIcon, TriangleAlertIcon, XIcon, ZapIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ANIMA_HEALTH_LABELS, animaHealthBucket, type AnimaTab } from "./anima.logic";
import { AnimaHealthRing } from "./AnimaHealth";
import { SoulOrb } from "./AnimaSoul";

export const ANIMA_SEARCH_INPUT_ID = "anima-search";

type OpenAnima = (name: string, tab?: AnimaTab) => void;

function healthNotes(anima: AnimaSummary): ReadonlyArray<string> {
  return [...(anima.healthWarnings ?? []), ...(anima.healthReasons ?? [])];
}

function needsWord(anima: AnimaSummary) {
  const bucket = animaHealthBucket(anima.health);
  return bucket === "tend" ? "Tend now" : bucket === "watch" ? "Observing" : "Healthy";
}

function HealthIcon({ anima }: { readonly anima: AnimaSummary }) {
  const bucket = animaHealthBucket(anima.health);
  if (bucket === "tend") return <ZapIcon className="size-3.5 shrink-0 text-destructive" />;
  if (bucket === "watch") return <EyeIcon className="size-3.5 shrink-0 text-warning" />;
  return <TriangleAlertIcon className="size-3.5 shrink-0 text-warning" />;
}

/** The original's alerts banner: one line per anima the CLI would tend or that has warnings. */
export function AlertsBanner({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [all, setAll] = useState(false);
  const alerts = animas
    .filter((anima) => {
      if (!anima.enabled || dismissed.has(anima.name)) return false;
      const bucket = animaHealthBucket(anima.health);
      return bucket === "tend" || bucket === "watch" || (anima.healthWarnings?.length ?? 0) > 0;
    })
    .toSorted((a, b) => (b.health ?? 0) - (a.health ?? 0));
  if (alerts.length === 0) return null;
  const shown = all ? alerts : alerts.slice(0, 4);
  return (
    <div className="space-y-1 rounded-2xl border border-warning/30 bg-warning/8 px-3 py-2">
      <ul className="divide-y divide-warning/15">
        {shown.map((anima) => {
          const notes = healthNotes(anima);
          return (
            <li key={anima.name} className="flex items-center gap-2.5 py-1.5">
              <HealthIcon anima={anima} />
              <button
                type="button"
                onClick={() => onOpen(anima.name, "health")}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <SoulOrb anima={anima} size={16} />
                <span className="shrink-0 font-medium">{anima.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {notes.length > 0 ? notes.slice(0, 2).join(" · ") : needsWord(anima)}
                </span>
              </button>
              {anima.health !== null ? (
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {Math.round(anima.health * 100)}
                </span>
              ) : null}
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Dismiss the alert for ${anima.name}`}
                onClick={() => setDismissed((current) => new Set(current).add(anima.name))}
              >
                <XIcon />
              </Button>
            </li>
          );
        })}
      </ul>
      {alerts.length > 4 ? (
        <Button size="xs" variant="ghost" onClick={() => setAll((value) => !value)}>
          {all ? "Show fewer" : `${alerts.length - 4} more alerts`}
        </Button>
      ) : null}
    </div>
  );
}

/** The original's health panel: most in need first, with why; steady animas behind a toggle. */
export function HealthPanel({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: OpenAnima;
}) {
  const [all, setAll] = useState(false);
  const ranked = animas.toSorted((a, b) => (b.health ?? -1) - (a.health ?? -1));
  const needing = ranked.filter((anima) => {
    const bucket = animaHealthBucket(anima.health);
    return bucket === "watch" || bucket === "tend";
  });
  const shown = all ? ranked : needing.slice(0, 12);
  return (
    <div className="space-y-3">
      {needing.length === 0 && !all ? (
        <p className="text-sm text-muted-foreground">Every anima is steady.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((anima) => {
            const bucket = animaHealthBucket(anima.health);
            const notes = healthNotes(anima);
            return (
              <li key={anima.name}>
                <button
                  type="button"
                  onClick={() => onOpen(anima.name, "health")}
                  className="flex h-full w-full items-start gap-3 rounded-2xl border border-border/60 bg-card p-3 text-left shadow-xs outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <AnimaHealthRing score={anima.health} size={40} showValue />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <SoulOrb anima={anima} size={12} />
                      <span className="truncate">{anima.name}</span>
                    </span>
                    <span
                      className={cn(
                        "block text-xs",
                        bucket === "tend"
                          ? "text-destructive"
                          : bucket === "watch"
                            ? "text-warning"
                            : "text-muted-foreground",
                      )}
                    >
                      {bucket === "unknown" ? ANIMA_HEALTH_LABELS[bucket] : needsWord(anima)}
                    </span>
                    {notes.length > 0 ? (
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {notes.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {ranked.length > shown.length || all ? (
        <Button size="xs" variant="ghost" onClick={() => setAll((value) => !value)}>
          {all ? "Show only those needing care" : `Show all ${ranked.length} animas`}
        </Button>
      ) : null}
    </div>
  );
}
