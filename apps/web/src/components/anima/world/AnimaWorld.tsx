import type { AnimaName, AnimaSummary } from "@t3tools/contracts";
import {
  ArrowUpRightIcon,
  CrosshairIcon,
  MapIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  TentTreeIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useNowMinute } from "../../../hooks/useNowMinute";
import { useStableCallback } from "../../../hooks/useStableCallback";
import { cn } from "../../../lib/utils";
import { Button } from "../../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { AnimaLiveDot, RelativeTime } from "../AnimaBits";
import { AnimaSigil, animaColor } from "../AnimaVisuals";
import { FORM_ORDER } from "./clay";
import type { CameraPreset, LanternYard } from "./LanternYard";
import { MODE_DESCRIPTIONS, creatureMode, formIndex, toWorldAgents } from "./worldAgents";

const PAUSE_KEY = "t3code:anima-world-paused";
const SKY = "#193d42";

function readPaused() {
  try {
    return localStorage.getItem(PAUSE_KEY) === "1";
  } catch {
    return false;
  }
}

function GlassButton({
  label,
  pressed,
  onClick,
  children,
}: {
  readonly label: string;
  readonly pressed?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            onClick={onClick}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/15 hover:text-white focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60 focus-visible:outline-none [&_svg]:size-4",
              pressed && "bg-white/20 text-white",
            )}
          >
            {children}
          </button>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
}

function SelectedCard({
  anima,
  onOpen,
  onClose,
}: {
  readonly anima: AnimaSummary;
  readonly onOpen: () => void;
  readonly onClose: () => void;
}) {
  const color = animaColor(anima);
  const mode = creatureMode(anima, Date.parse(useNowMinute()));
  return (
    <div
      className="pointer-events-auto w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-white/15 bg-black/70 text-white shadow-2xl backdrop-blur-md"
      style={color ? { boxShadow: `0 20px 60px -20px ${color}` } : undefined}
    >
      <div className="h-1 w-full" style={color ? { backgroundColor: color } : undefined} />
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <AnimaSigil anima={anima} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-lg font-semibold tracking-tight">{anima.name}</span>
              <AnimaLiveDot live={anima.live} />
            </div>
            <p className="text-xs text-white/60">
              {anima.role} · {FORM_ORDER[formIndex(anima)]} · {anima.breathCount} breaths
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        {anima.aim ? (
          <p className="line-clamp-3 text-sm leading-snug text-white/90">{anima.aim}</p>
        ) : null}
        <div className="flex items-center justify-between gap-2 text-xs text-white/55">
          <span>{MODE_DESCRIPTIONS[mode]}</span>
          <RelativeTime value={anima.lastActiveAt ?? anima.lastBreathAt} />
        </div>
        <Button size="sm" className="w-full" onClick={onOpen}>
          Open {anima.name}
          <ArrowUpRightIcon />
        </Button>
      </div>
    </div>
  );
}

export function AnimaWorld({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: (name: AnimaName) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [yard, setYard] = useState<LanternYard | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [paused, setPaused] = useState(readPaused);
  const [camera, setCamera] = useState<CameraPreset>("district");
  const now = Date.parse(useNowMinute());
  const agents = toWorldAgents(animas, now);
  const towns = new Set(agents.map((agent) => agent.districtId)).size;
  const live = animas.filter((anima) => anima.live).length;
  const selectedAnima = animas.find((anima) => anima.name === selected) ?? null;
  const status = yard ? "ready" : failed ? "failed" : "loading";
  const openFromWorld = useStableCallback((id: string) => onOpen(id as AnimaName));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns the WebGL renderer, which lives outside React
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let created: LanternYard | null = null;
    let disposed = false;
    // three.js is large; it loads only when the world is opened.
    void import("./LanternYard")
      .then(({ LanternYard: Yard }) => {
        if (disposed) return;
        created = new Yard(host, setSelected, openFromWorld);
        setYard(created);
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      created?.dispose();
      setYard(null);
    };
  }, [openFromWorld]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes roster changes into the WebGL scene
  useEffect(() => {
    yard?.update(agents, selected);
  }, [yard, agents, selected]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- forwards the motion toggle to the render loop
  useEffect(() => {
    yard?.setPaused(paused);
  }, [yard, paused]);

  const moveCamera = (preset: CameraPreset) => {
    setCamera(preset);
    yard?.setCamera(preset);
  };
  const togglePaused = () => {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(PAUSE_KEY, next ? "1" : "0");
    } catch {
      // Private mode: the toggle still applies for this visit.
    }
  };

  return (
    <div
      className="relative isolate min-h-0 flex-1 overflow-hidden"
      style={{ backgroundColor: SKY }}
    >
      <div ref={hostRef} className="absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/45"
      />
      {status !== "ready" ? (
        <div className="absolute inset-0 grid place-items-center text-white/70">
          <div className="flex flex-col items-center gap-3 text-center">
            <TentTreeIcon className={cn("size-10", status === "loading" && "animate-pulse")} />
            <p className="text-sm">
              {status === "loading"
                ? "Lighting the lanterns…"
                : "This browser can't draw the yard. The roster has everyone."}
            </p>
          </div>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto max-w-md rounded-2xl border border-white/10 bg-black/50 px-4 py-3 text-white shadow-xl backdrop-blur-md">
          <p className="text-xs font-medium tracking-wide text-warning">Lantern Yard</p>
          <p className="mt-0.5 text-sm text-white/85">
            {animas.length} {animas.length === 1 ? "anima lives" : "animas live"} in {towns}{" "}
            {towns === 1 ? "town" : "towns"}
            {live > 0 ? (
              <>
                {" · "}
                <span className="font-medium text-success">{live} at work</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-white/10 bg-black/50 p-1 shadow-xl backdrop-blur-md">
          <GlassButton
            label="All towns"
            pressed={camera === "campus"}
            onClick={() => moveCamera("campus")}
          >
            <MapIcon />
          </GlassButton>
          <GlassButton
            label="This town"
            pressed={camera === "district"}
            onClick={() => moveCamera("district")}
          >
            <TentTreeIcon />
          </GlassButton>
          <GlassButton
            label={selectedAnima ? `Follow ${selectedAnima.name}` : "Select an anima to follow"}
            pressed={camera === "follow"}
            onClick={() => selectedAnima && moveCamera("follow")}
          >
            <CrosshairIcon />
          </GlassButton>
          <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
          <GlassButton label="Zoom in" onClick={() => yard?.setCamera("zoom-in")}>
            <PlusIcon />
          </GlassButton>
          <GlassButton label="Zoom out" onClick={() => yard?.setCamera("zoom-out")}>
            <MinusIcon />
          </GlassButton>
          <span aria-hidden className="mx-1 h-5 w-px bg-white/15" />
          <GlassButton
            label={paused ? "Resume motion" : "Pause motion"}
            pressed={paused}
            onClick={togglePaused}
          >
            {paused ? <PlayIcon /> : <PauseIcon />}
          </GlassButton>
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
        {selectedAnima ? (
          <SelectedCard
            anima={selectedAnima}
            onOpen={() => onOpen(selectedAnima.name)}
            onClose={() => setSelected(null)}
          />
        ) : (
          <p className="rounded-full bg-black/45 px-3 py-1.5 text-xs text-white/70 backdrop-blur-md">
            Click a creature to meet it · double-click to open
          </p>
        )}
        <ul className="hidden flex-col gap-1 rounded-xl bg-black/45 px-3 py-2 text-xs text-white/70 backdrop-blur-md sm:flex">
          <li className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" /> At a desk: live session
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-warning" /> Wandering: resting
          </li>
          <li className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-white/40" /> Head down: asleep
          </li>
        </ul>
      </div>
    </div>
  );
}
