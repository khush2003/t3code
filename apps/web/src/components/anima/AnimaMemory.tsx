import type { AnimaDetail } from "@t3tools/contracts";
import { DownloadIcon, Maximize2Icon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "../ui/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { RelativeTime } from "./AnimaBits";
import { BreathNarrative } from "./AnimaTabs";
import { AnimaBodyPanel } from "./AnimaVisuals";
import { parseHsl } from "./animaVisuals.logic";
import { parseBreathNote, type BreathNote } from "./soul.logic";

const QUALITY_SHIFT: Record<BreathNote["quality"], number> = {
  major: 8,
  minor: -8,
  diminished: -16,
  seventh: 4,
};

/** The original dashboard's memory colour: hue leans with intensity, depth saturates, mood lightens. */
function memoryColor(breath: AnimaDetail["breaths"][number], note: BreathNote): string {
  const hsl = parseHsl(breath.hsl) ?? { h: 220, s: 40, l: 50 };
  const velocity = note.velocity / 127;
  const depth = breath.shape?.depth ?? 0.5;
  const hue = hsl.h + (velocity - 0.5) * 50;
  const saturation = Math.min(90, Math.max(30, velocity * 50 + depth * 30 + 10));
  const lightness = Math.min(78, Math.max(28, velocity * 30 + 25 + QUALITY_SHIFT[note.quality]));
  return `oklch(${lightness}% ${(saturation * 0.0019).toFixed(3)} ${Math.round(hue)})`;
}

export function MemoryPanel({ detail }: { readonly detail: AnimaDetail }) {
  const entries = detail.breaths
    .toSorted((a, b) => a.index - b.index)
    .flatMap((breath) => {
      const note = parseBreathNote(breath.note);
      return note ? [{ index: breath.index, breath, note }] : [];
    });
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [rendering, setRendering] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops audio playback when the panel unmounts
  useEffect(() => () => stopRef.current?.(), []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the playing bar in the scrolled strip's view, a DOM scroll position
  useEffect(() => {
    if (playing === null) return;
    stripRef.current
      ?.querySelector(`[data-breath="${playing}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [playing]);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No breath has a note yet.</p>;
  }
  const focusIndex = playing ?? selected ?? entries.at(-1)!.index;
  const focus = entries.find((entry) => entry.index === focusIndex) ?? entries.at(-1)!;
  const toggleLife = async () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
      return;
    }
    const { playLife } = await import("./soulSynth");
    stopRef.current = playLife(entries, (index) => {
      setPlaying(index);
      if (index === null) stopRef.current = null;
    });
  };
  const playOne = async (entry: (typeof entries)[number]) => {
    setSelected(entry.index);
    const { playNote } = await import("./soulSynth");
    playNote(entry.note);
  };
  const download = async () => {
    setRendering(true);
    try {
      const { renderLifeWav } = await import("./soulSynth");
      const url = URL.createObjectURL(await renderLifeWav(entries));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${detail.summary.name}-life.wav`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setRendering(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <span className="font-serif text-5xl leading-none">{focus.note.pitch}</span>
          <span className="font-serif text-lg text-muted-foreground italic">
            {focus.note.quality}
          </span>
          <dl className="flex gap-4 text-xs text-muted-foreground">
            <div>
              vel{" "}
              <span className="font-medium text-foreground tabular-nums">
                {focus.note.velocity}
              </span>
            </div>
            <div>
              beats{" "}
              <span className="font-medium text-foreground tabular-nums">{focus.note.beats}</span>
            </div>
            <div>
              bpm{" "}
              <span className="font-medium text-foreground tabular-nums">{focus.note.tempo}</span>
            </div>
          </dl>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" onClick={() => void toggleLife()}>
            {playing !== null ? <PauseIcon /> : <PlayIcon />}
            {playing !== null ? "Stop" : "Play life"}
          </Button>
          <Button size="sm" variant="ghost" disabled={rendering} onClick={() => void download()}>
            <DownloadIcon />
            {rendering ? "Rendering..." : "Download"}
          </Button>
        </div>
      </div>
      <div
        ref={(node) => {
          // The newest breaths are on the right; start there like the original.
          if (node && stripRef.current !== node) node.scrollLeft = node.scrollWidth;
          stripRef.current = node;
        }}
        className="flex h-28 items-center gap-1 overflow-x-auto rounded-2xl bg-muted/30 px-3"
      >
        {entries.map((entry) => {
          const color = memoryColor(entry.breath, entry.note);
          const lit = entry.index === focus.index;
          return (
            <Tooltip key={entry.index}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Play breath ${entry.index}`}
                    data-breath={entry.index}
                    onClick={() => void playOne(entry)}
                    className="relative flex w-3 shrink-0 flex-col items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    style={{ height: `${Math.max(14, (entry.note.velocity / 127) * 72)}%` }}
                  >
                    {entry.note.quality === "major" || entry.note.quality === "seventh" ? (
                      <span
                        aria-hidden
                        className="absolute -top-2 size-1 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="absolute -bottom-2 size-1 rounded-full opacity-70"
                        style={{ backgroundColor: color }}
                      />
                    )}
                    <span
                      className={cn(
                        "size-full rounded-full transition-opacity",
                        !lit && playing !== null && "opacity-40",
                      )}
                      style={{
                        backgroundColor: color,
                        boxShadow: lit ? `0 0 14px ${color}` : undefined,
                      }}
                    />
                  </button>
                }
              />
              <TooltipPopup className="max-w-72">
                <span className="font-medium">
                  #{entry.index} · {entry.note.pitch} {entry.note.quality}
                </span>
                {entry.breath.aim ? ` · ${entry.breath.aim}` : ""}
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
      <div className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3 text-sm">
        <p className="text-xs text-muted-foreground">
          Breath #{focus.index} · <RelativeTime value={focus.breath.ts} />
          {selected === null && playing === null ? " · the latest" : ""}
        </p>
        <BreathNarrative breath={focus.breath} />
      </div>
    </div>
  );
}

const TRAVERSE_STEP_MS = 420;

/** The body cube, with the original's traverse (reveal breath by breath) and an expanded view. */
export function BodyExplorer({ detail }: { readonly detail: AnimaDetail }) {
  const shaped = detail.breaths.filter((breath) => breath.shape !== null).length;
  const [step, setStep] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drives the traverse timer, an external clock, only while it runs
  useEffect(() => {
    if (step === null) return;
    if (step >= shaped) {
      const done = setTimeout(() => setStep(null), 1200);
      return () => clearTimeout(done);
    }
    const timer = setTimeout(() => setStep(step + 1), TRAVERSE_STEP_MS);
    return () => clearTimeout(timer);
  }, [step, shaped]);
  const panel = (large: boolean) => (
    <AnimaBodyPanel
      breaths={detail.breaths}
      accent={detail.summary.accent}
      large={large}
      {...(step === null ? {} : { upTo: step })}
    />
  );
  return (
    <div className="space-y-2">
      {panel(false)}
      <div className="flex justify-center gap-1">
        <Button
          size="xs"
          variant="ghost"
          disabled={shaped < 2}
          onClick={() => setStep((value) => (value === null ? 1 : null))}
        >
          {step === null ? <PlayIcon /> : <PauseIcon />}
          {step === null ? "Traverse" : `Breath ${step} of ${shaped}`}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => setExpanded(true)}>
          <Maximize2Icon />
          Expand
        </Button>
      </div>
      {expanded ? (
        <Dialog open onOpenChange={(open) => !open && setExpanded(false)}>
          <DialogPopup className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>{detail.summary.name}'s body</DialogTitle>
            </DialogHeader>
            <DialogPanel>{panel(true)}</DialogPanel>
          </DialogPopup>
        </Dialog>
      ) : null}
    </div>
  );
}
