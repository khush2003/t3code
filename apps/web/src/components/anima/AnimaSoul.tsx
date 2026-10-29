import { useAtomValue } from "@effect/atom-react";
import {
  ANIMA_FORMS,
  type AnimaBreath,
  type AnimaForm,
  type AnimaSummary,
  type EnvironmentId,
} from "@t3tools/contracts";
import { CheckIcon, PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { animaEnvironment } from "../../state/anima";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useAnimaMutation } from "./AnimaBits";
import { parseHsl } from "./animaVisuals.logic";
import { parseBreathNote } from "./soul.logic";
import type { CreatureLook } from "./world/clay";
import { creatureLook, formIndex } from "./world/worldAgents";

/** Oklch from the breath HSL, matching the rest of the anima UI; `shift` darkens for depth. */
function soulColor(hsl: string | null, accent: string | null, shift = 0, alpha = 1): string {
  const parsed = parseHsl(hsl);
  if (!parsed) return accent ?? "var(--muted-foreground)";
  const lightness = Math.min(88, Math.max(14, parsed.l + shift));
  const chroma = (0.02 + parsed.s * 0.0026).toFixed(3);
  return `oklch(${lightness}% ${chroma} ${Math.round(parsed.h)} / ${alpha})`;
}

export function animaSoulColors(anima: Pick<AnimaSummary, "hsl" | "accent">) {
  return {
    core: soulColor(anima.hsl, anima.accent, 12),
    deep: soulColor(anima.hsl, anima.accent, -22),
    glow: soulColor(anima.hsl, anima.accent, 6, 0.45),
    haze: soulColor(anima.hsl, anima.accent, 0, 0.16),
  };
}

/** The original dashboard's soul orb: an offset highlight, layered glow and a resting ring. Static. */
export function SoulOrb({
  anima,
  size = 112,
}: {
  readonly anima: Pick<AnimaSummary, "hsl" | "accent" | "name">;
  readonly size?: number;
}) {
  const { core, deep, glow, haze } = animaSoulColors(anima);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        aria-hidden
        className="absolute rounded-full border"
        style={{ inset: -size * 0.09, borderColor: haze }}
      />
      <div
        role="img"
        aria-label={`${anima.name}'s soul colour`}
        className="absolute inset-0 rounded-full"
        style={{
          backgroundImage: `radial-gradient(circle at 36% 30%, color-mix(in oklch, ${core} 70%, white) 0%, ${core} 28%, ${deep} 78%, color-mix(in oklch, ${deep} 60%, black) 100%)`,
          boxShadow: `0 0 ${size * 0.5}px ${glow}, 0 0 ${size * 1.1}px ${haze}, inset -${size * 0.07}px -${size * 0.09}px ${size * 0.2}px rgb(0 0 0 / 0.28), inset ${size * 0.04}px ${size * 0.05}px ${size * 0.12}px rgb(255 255 255 / 0.18)`,
        }}
      />
    </div>
  );
}

const LOOK_SEPARATOR = "\u0001";

function usePortraits(
  requests: ReadonlyArray<{ readonly formIndex: number; readonly look: CreatureLook }>,
) {
  const key = requests
    .map(({ formIndex: index, look }) =>
      [index, look.accent, look.role, look.stage].join(LOOK_SEPARATOR),
    )
    .join("\n");
  const [portraits, setPortraits] = useState<{
    readonly key: string;
    readonly urls: ReadonlyArray<string>;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- renders WebGL portraits, an external resource, after the module loads
  useEffect(() => {
    let cancelled = false;
    const decoded = key.split("\n").map((line) => {
      const [index, accent, role, stage] = line.split(LOOK_SEPARATOR);
      return { formIndex: Number(index), look: { accent, role, stage } as CreatureLook };
    });
    void import("./world/portrait")
      .then(({ renderPortraits }) => {
        if (!cancelled) setPortraits({ key, urls: renderPortraits(decoded) });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key]);
  return portraits?.key === key ? portraits.urls : null;
}

/** The anima's creature as a still portrait, for lists. */
export function CreatureAvatar({
  anima,
  size = 40,
}: {
  readonly anima: AnimaSummary;
  readonly size?: number;
}) {
  const now = Date.parse(useNowMinute());
  const urls = usePortraits([{ formIndex: formIndex(anima), look: creatureLook(anima, now) }]);
  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 ring-1 ring-white/15"
      style={{ width: size, height: size }}
    >
      {urls?.[0] ? (
        <img src={urls[0]} alt="" className="size-full scale-125 object-cover object-top" />
      ) : null}
    </span>
  );
}

/** The anima's Lantern Yard creature; owners can pick a different form, saved through `anima clinic`. */
export function CreaturePortrait({
  environmentId,
  anima,
  size = 72,
}: {
  readonly environmentId: EnvironmentId;
  readonly anima: AnimaSummary;
  readonly size?: number;
}) {
  const now = Date.parse(useNowMinute());
  const look = creatureLook(anima, now);
  const current = formIndex(anima);
  const canChoose = useAtomValue(animaEnvironment.clinic.permissionAtom(environmentId));
  const [open, setOpen] = useState(false);
  const urls = usePortraits(
    open
      ? ANIMA_FORMS.map((_, index) => ({ formIndex: index, look }))
      : [{ formIndex: current, look }],
  );
  const choose = useAnimaMutation(animaEnvironment.clinic, {
    failureTitle: `Could not change ${anima.name}'s form`,
  });
  const portrait = open ? urls?.[current] : urls?.[0];
  const pick = async (form: AnimaForm) => {
    setOpen(false);
    if (form === ANIMA_FORMS[current] && anima.form) return;
    await choose({ environmentId, input: { name: anima.name, form } });
  };
  const face = (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-full border-2 border-background bg-card shadow-lg"
      style={{ width: size, height: size }}
    >
      {portrait ? (
        <img src={portrait} alt="" className="size-full scale-125 object-cover object-top" />
      ) : (
        <span className="size-1/2 rounded-full bg-muted" />
      )}
    </span>
  );
  if (!canChoose) return face;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <button
                  type="button"
                  aria-label={`Change ${anima.name}'s form (${ANIMA_FORMS[current]})`}
                  className="rounded-full outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                />
              }
            />
          }
        >
          {face}
        </TooltipTrigger>
        <TooltipPopup>
          {anima.form ? `A ${anima.form} by choice` : `A ${ANIMA_FORMS[current]} for now`} · click
          to choose
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup align="start" className="w-80">
        <PopoverTitle>Choose {anima.name}'s form</PopoverTitle>
        <p className="mb-3 text-xs text-muted-foreground">
          How it appears in Lantern Yard. Saved to the anima itself, so every app sees it.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {ANIMA_FORMS.map((form, index) => {
            const selected = index === current;
            return (
              <button
                key={form}
                type="button"
                onClick={() => void pick(form)}
                className={cn(
                  "group relative flex flex-col items-center gap-1 rounded-xl border p-2 text-xs capitalize outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected ? "border-primary bg-accent/60" : "border-border",
                )}
              >
                <span className="grid size-16 place-items-center overflow-hidden rounded-lg bg-muted/40">
                  {urls?.[index] ? (
                    <img
                      src={urls[index]}
                      alt=""
                      className="size-full scale-125 object-cover object-top"
                    />
                  ) : null}
                </span>
                {form}
                {selected ? (
                  <CheckIcon className="absolute top-1.5 right-1.5 size-3.5 text-primary" />
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * Life history as colour: one bar per breath in its own hue, height from the note's
 * velocity. "Play life" turns the breaths back into chords.
 */
export function LifeStrip({
  breaths,
  onSelect,
}: {
  readonly breaths: ReadonlyArray<AnimaBreath>;
  readonly onSelect?: (index: number) => void;
}) {
  const ordered = breaths.toSorted((a, b) => a.index - b.index);
  const notes = ordered.flatMap((breath) => {
    const note = parseBreathNote(breath.note);
    return note ? [{ index: breath.index, note }] : [];
  });
  const [playing, setPlaying] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops audio playback when the strip unmounts
  useEffect(() => () => stopRef.current?.(), []);
  if (ordered.length === 0) return null;
  const velocity = new Map(notes.map(({ index, note }) => [index, note.velocity]));
  const head = ordered.at(-1)!.index;
  const toggle = async () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
      return;
    }
    const { playLife } = await import("./soulSynth");
    stopRef.current = playLife(notes, (index) => {
      setPlaying(index);
      if (index === null) stopRef.current = null;
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground/80">
          Life in colour{" "}
          <span className="font-normal text-muted-foreground">· {ordered.length} breaths</span>
        </span>
        {notes.length > 1 ? (
          <Button size="xs" variant="ghost" onClick={() => void toggle()}>
            {playing !== null ? <PauseIcon /> : <PlayIcon />}
            {playing !== null ? "Stop" : "Play life"}
          </Button>
        ) : null}
      </div>
      <div className="flex h-14 items-end gap-0.5 rounded-xl bg-muted/30 p-1.5">
        {ordered.map((breath) => {
          const level = (velocity.get(breath.index) ?? 72) / 127;
          const top = soulColor(breath.hsl, null, 10);
          const bottom = soulColor(breath.hsl, null, -18);
          const lit = playing === breath.index || (playing === null && breath.index === head);
          return (
            <Tooltip key={breath.index}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Breath ${breath.index}`}
                    onClick={() => onSelect?.(breath.index)}
                    className="min-w-0.5 flex-1 rounded-sm outline-none transition-[filter,opacity] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    style={{
                      height: `${Math.round(30 + level * 70)}%`,
                      backgroundImage: `linear-gradient(to bottom, ${top}, ${bottom})`,
                      boxShadow: lit
                        ? `0 0 12px ${soulColor(breath.hsl, null, 8, 0.8)}`
                        : undefined,
                      opacity: playing !== null && !lit ? 0.45 : 1,
                    }}
                  />
                }
              />
              <TooltipPopup className="max-w-72">
                <span className="font-medium">#{breath.index}</span>
                {breath.aim ? ` · ${breath.aim}` : ""}
              </TooltipPopup>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
