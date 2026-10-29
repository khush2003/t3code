import type { AnimaSummary, EnvironmentId } from "@t3tools/contracts";
import {
  ActivityIcon,
  HeartPulseIcon,
  InboxIcon,
  RadioIcon,
  SparklesIcon,
  WindIcon,
  ZapIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { animaNeedsAttention } from "./anima.logic";
import { RelativeTime } from "./AnimaBits";
import { AnimaRoster } from "./AnimaRoster";
import { SoulOrb, animaSoulColors } from "./AnimaSoul";
import { PULSE_BUCKETS, pulseBuckets, tensionBoard } from "./animaDashboard.logic";

const CONSTELLATION_LIMIT = 15;

function lastSeen(anima: AnimaSummary): string | null {
  return anima.lastActiveAt ?? anima.lastBreathAt;
}

function Section({
  icon,
  title,
  hint,
  action,
  children,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly hint?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header className="flex items-end justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground [&_svg]:size-4 [&_svg]:text-muted-foreground">
            {icon}
            {title}
          </h2>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: number;
  readonly tone: "neutral" | "success" | "warning" | "info";
  readonly onClick?: () => void;
}) {
  const toneClass = {
    neutral: "bg-muted text-foreground/70",
    success: "bg-success/12 text-success",
    warning: "bg-warning/12 text-warning",
    info: "bg-info/12 text-info",
  }[tone];
  const body = (
    <>
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4.5",
          toneClass,
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-semibold tracking-tight tabular-nums">
          {value.toLocaleString()}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </>
  );
  const className =
    "flex min-w-0 items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-xs";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        className,
        "outline-none transition-colors hover:border-border hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
      )}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** The original dashboard's constellation: soul orbs sized by how much each anima has lived. */
function Constellation({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: (name: string) => void;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 rounded-3xl border border-border/60 bg-card px-4 py-6 shadow-xs sm:grid-cols-3 lg:grid-cols-5">
      {animas.map((anima) => {
        const size = Math.round(Math.min(92, 40 + Math.sqrt(anima.breathCount) * 7));
        const { glow } = animaSoulColors(anima);
        return (
          <li key={anima.name}>
            <button
              type="button"
              onClick={() => onOpen(anima.name)}
              className="group flex w-full flex-col items-center gap-2 rounded-2xl px-2 py-3 text-center outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="grid size-24 place-items-center">
                <span
                  className={cn(
                    "rounded-full transition-transform duration-300 group-hover:scale-110",
                    anima.live && "ring-2 ring-success ring-offset-4 ring-offset-card",
                  )}
                  style={{ boxShadow: `0 0 28px ${glow}` }}
                >
                  <SoulOrb anima={anima} size={size} />
                </span>
              </span>
              <span className="flex max-w-full items-center gap-1.5 text-sm font-semibold">
                <span className="truncate">{anima.name}</span>
                {anima.live ? <span className="size-1.5 shrink-0 rounded-full bg-success" /> : null}
              </span>
              <span className="text-2xs text-muted-foreground tabular-nums">
                {anima.breathCount} {anima.breathCount === 1 ? "breath" : "breaths"} ·{" "}
                <RelativeTime value={lastSeen(anima)} />
              </span>
              {anima.aim ? (
                <span className="line-clamp-2 text-xs leading-snug text-foreground/70">
                  {anima.aim}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Every anima sorted by how recently it was active, so who is alive and who has gone quiet reads at a glance. */
function Pulse({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: (name: string) => void;
}) {
  const now = Date.parse(useNowMinute());
  const buckets = pulseBuckets(
    animas.map((anima) => ({ anima, at: lastSeen(anima) })),
    now,
  );
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border/60 bg-card shadow-xs sm:grid-cols-3 xl:grid-cols-6">
      {PULSE_BUCKETS.map((bucket, index) => {
        const entries = buckets[index]!;
        return (
          <div
            key={bucket.label}
            className="flex min-w-0 flex-col gap-3 border-border/60 p-4 not-last:border-r max-xl:border-b"
          >
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-foreground/80">{bucket.label}</span>
              <span className="text-muted-foreground tabular-nums">{entries.length}</span>
            </div>
            {entries.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {entries.map(({ anima }) => {
                  const { core, glow } = animaSoulColors(anima);
                  const size = Math.round(Math.min(18, 8 + Math.sqrt(anima.breathCount) * 1.4));
                  return (
                    <li key={anima.name} className="grid size-5 place-items-center">
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={anima.name}
                              onClick={() => onOpen(anima.name)}
                              className="rounded-full outline-none transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              style={{
                                width: size,
                                height: size,
                                backgroundColor: core,
                                boxShadow: anima.live
                                  ? `0 0 0 2px var(--success), 0 0 10px ${glow}`
                                  : `0 0 6px ${glow}`,
                              }}
                            />
                          }
                        />
                        <TooltipPopup>
                          <span className="font-medium">{anima.name}</span> · {anima.breathCount}{" "}
                          {anima.breathCount === 1 ? "breath" : "breaths"} ·{" "}
                          <RelativeTime value={lastSeen(anima)} />
                        </TooltipPopup>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <span className="text-xs text-muted-foreground/60">Quiet</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Tensions({
  animas,
  onOpen,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: (name: string) => void;
}) {
  const [all, setAll] = useState(false);
  const board = tensionBoard(animas);
  const shown = all ? board : board.slice(0, 9);
  const byName = new Map(animas.map((anima) => [anima.name, anima]));
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((tension) => {
          const anima = byName.get(tension.anima)!;
          const { core } = animaSoulColors(anima);
          return (
            <li key={`${tension.anima}:${tension.slug}`}>
              <button
                type="button"
                onClick={() => onOpen(tension.anima)}
                className="flex h-full w-full flex-col gap-2 rounded-2xl border border-border/60 bg-card p-4 text-left shadow-xs outline-none transition-colors hover:border-border hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                style={{ borderLeftColor: core, borderLeftWidth: 3 }}
              >
                <span className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold">{tension.anima}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 tabular-nums",
                      tension.age >= 8
                        ? "bg-warning/12 text-warning"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tension.age} {tension.age === 1 ? "breath" : "breaths"} old
                  </span>
                </span>
                <span className="text-sm leading-snug text-foreground/85">{tension.text}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {board.length > shown.length || all ? (
        <Button size="xs" variant="ghost" onClick={() => setAll((value) => !value)}>
          {all ? "Show fewer" : `Show all ${board.length} tensions`}
        </Button>
      ) : null}
    </div>
  );
}

export function AnimaDashboard({
  environmentId,
  animas,
  onOpen,
  onCreate,
  createDisabledReason,
}: {
  readonly environmentId: EnvironmentId;
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly onOpen: (name: string) => void;
  readonly onCreate: () => void;
  readonly createDisabledReason: string | null;
}) {
  const recent = animas
    .toSorted(
      (a, b) =>
        Number(b.live) - Number(a.live) || (lastSeen(b) ?? "").localeCompare(lastSeen(a) ?? ""),
    )
    .slice(0, CONSTELLATION_LIMIT);
  const breaths = animas.reduce((sum, anima) => sum + anima.breathCount, 0);
  const live = animas.filter((anima) => anima.live).length;
  const tending = animas.filter(animaNeedsAttention).length;
  const unread = animas.reduce((sum, anima) => sum + anima.inboxCount, 0);
  const tensions = tensionBoard(animas).length;
  const scrollToRoster = () =>
    document.getElementById("anima-roster")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile icon={<SparklesIcon />} label="Animas" value={animas.length} tone="neutral" />
        <StatTile icon={<WindIcon />} label="Breaths taken" value={breaths} tone="info" />
        <StatTile icon={<RadioIcon />} label="Live now" value={live} tone="success" />
        <StatTile
          icon={<HeartPulseIcon />}
          label="Need tending"
          value={tending}
          tone="warning"
          onClick={scrollToRoster}
        />
        <StatTile
          icon={<InboxIcon />}
          label="Unread messages"
          value={unread}
          tone="info"
          onClick={scrollToRoster}
        />
      </div>

      {recent.length > 0 ? (
        <Section
          icon={<SparklesIcon />}
          title="Constellation"
          hint="The most recently active animas. Bigger orbs have lived more; colour is the latest breath."
        >
          <Constellation animas={recent} onOpen={onOpen} />
        </Section>
      ) : null}

      {animas.length > 0 ? (
        <Section
          icon={<ActivityIcon />}
          title="Pulse"
          hint="When each anima was last active. Bigger dots have lived more; ringed dots have a live session."
        >
          <Pulse animas={animas} onOpen={onOpen} />
        </Section>
      ) : null}

      {tensions > 0 ? (
        <Section
          icon={<ZapIcon />}
          title="Open tensions"
          hint="Unresolved questions animas are carrying, oldest first."
        >
          <Tensions animas={animas} onOpen={onOpen} />
        </Section>
      ) : null}

      <div id="anima-roster" className="scroll-mt-4">
        <AnimaRoster
          environmentId={environmentId}
          onOpen={onOpen}
          onCreate={onCreate}
          createDisabledReason={createDisabledReason}
        />
      </div>
    </div>
  );
}
