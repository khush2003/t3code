import type { AnimaDetail } from "@t3tools/contracts";

import { useState } from "react";

import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Meter, TraitBars } from "./AnimaBits";
import { SoulOrb } from "./AnimaSoul";
import { parseKin, parseUserModel, parseVoiceSamples, soulMeaning } from "./animaDashboard.logic";

/** Header keys the persona cards render; the raw header card shows only the rest. */
export const PERSONA_HEADER_KEYS = new Set([
  "style",
  "biases",
  "samples",
  "arc",
  "arc-breath",
  "kin",
  "user",
  "tension",
  "hue",
  "schema",
  "ka-top",
  "self",
  "skills",
  "projects",
]);

function headerValue(detail: AnimaDetail, key: string): string | null {
  const value = detail.header.find((entry) => entry.key === key)?.value.trim();
  return value ? value : null;
}

function Reading({
  label,
  value,
  word,
  max,
}: {
  readonly label: string;
  readonly value: number;
  readonly word: string;
  readonly max: number;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Meter value={value / max} label={label} />
      <span className="text-right text-foreground/80">{word}</span>
    </div>
  );
}

/** What the anima's colour says: hue is the work domain, saturation focus, lightness vitality. */
export function SoulCard({ detail }: { readonly detail: AnimaDetail }) {
  const { summary } = detail;
  const meaning = soulMeaning(summary.hsl);
  if (!meaning) {
    return (
      <p className="text-xs text-muted-foreground">Its colour appears after the first breath.</p>
    );
  }
  return (
    <div className="flex items-center gap-5">
      <SoulOrb anima={summary} size={64} />
      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-sm">
          Working in <span className="font-semibold capitalize">{meaning.domain}</span>
          <span className="text-muted-foreground">
            , {meaning.focusLabel} and {meaning.vitalityLabel}
          </span>
        </p>
        <Reading label="Focus" value={meaning.focus} word={`${meaning.focus}%`} max={100} />
        <Reading
          label="Vitality"
          value={meaning.vitality}
          word={`${meaning.vitality}%`}
          max={100}
        />
      </div>
    </div>
  );
}

export function hasVoice(detail: AnimaDetail): boolean {
  return (
    detail.summary.voice !== null ||
    ["style", "biases", "samples"].some((key) => headerValue(detail, key) !== null)
  );
}

export function VoiceCard({ detail }: { readonly detail: AnimaDetail }) {
  const style = headerValue(detail, "style");
  const biases = headerValue(detail, "biases");
  const samples = parseVoiceSamples(headerValue(detail, "samples") ?? "");
  return (
    <div className="space-y-4">
      {detail.summary.voice ? (
        <p className="text-base leading-relaxed text-foreground/90">{detail.summary.voice}</p>
      ) : null}
      {style || biases ? (
        <dl className="grid gap-3 sm:grid-cols-2">
          {style ? (
            <div className="space-y-1">
              <dt className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                Style
              </dt>
              <dd className="text-sm leading-snug text-foreground/85">{style}</dd>
            </div>
          ) : null}
          {biases ? (
            <div className="space-y-1">
              <dt className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                Biases
              </dt>
              <dd className="text-sm leading-snug text-foreground/85">{biases}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {samples.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {samples.map((sample) => (
            <li
              key={sample.tag + sample.text}
              className="space-y-1 rounded-xl bg-muted/40 px-3 py-2.5"
            >
              <span className="text-2xs font-medium text-muted-foreground">{sample.tag}</span>
              <p className="text-sm leading-snug text-foreground/85 italic">“{sample.text}”</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Held tensions and the working memo: what is on the anima's mind between breaths. */
export function MindCard({ detail }: { readonly detail: AnimaDetail }) {
  const tensions = detail.summary.tensions ?? [];
  const { memo } = detail.summary;
  if (tensions.length === 0 && !memo) {
    return <p className="text-xs text-muted-foreground">Nothing held open right now.</p>;
  }
  return (
    <div className="space-y-3">
      {tensions.length > 0 ? (
        <ul className="space-y-1.5">
          {tensions.map((tension) => (
            <li key={tension.slug} className="flex items-start gap-2 text-sm leading-snug">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded-full px-1.5 text-2xs tabular-nums",
                  tension.age >= 8
                    ? "bg-warning/12 text-warning"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tension.age}
              </span>
              <span className="min-w-0 break-words text-foreground/85">
                {tension.slug.replace(/\(\d+\)$/, "").replaceAll("-", " ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {memo ? (
        <div className={cn("space-y-1", tensions.length > 0 && "border-t border-border/60 pt-3")}>
          <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            Memo
          </span>
          <p className="line-clamp-6 text-sm break-words whitespace-pre-wrap text-foreground/85">
            {memo}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function hasArc(detail: AnimaDetail): boolean {
  return headerValue(detail, "arc") !== null;
}

export function ArcCard({ detail }: { readonly detail: AnimaDetail }) {
  const arc = headerValue(detail, "arc");
  const through = headerValue(detail, "arc-breath");
  return (
    <div className="space-y-2">
      <p className="text-sm leading-relaxed text-foreground/85">{arc}</p>
      {through ? (
        <p className="text-2xs text-muted-foreground">Written at breath {through}</p>
      ) : null}
    </div>
  );
}

export function hasBonds(detail: AnimaDetail): boolean {
  return headerValue(detail, "kin") !== null || headerValue(detail, "user") !== null;
}

const USER_MODEL_PREVIEW = 8;

/** Kin it has named, and its model of the person it works with. */
export function BondsCard({
  detail,
  knownAnimas,
  onOpenAnima,
}: {
  readonly detail: AnimaDetail;
  readonly knownAnimas: ReadonlySet<string>;
  readonly onOpenAnima: (name: string) => void;
}) {
  const kin = parseKin(headerValue(detail, "kin") ?? "");
  const user = parseUserModel(headerValue(detail, "user") ?? "").toSorted(
    (a, b) => b.mean - a.mean,
  );
  const [allUser, setAllUser] = useState(false);
  return (
    <div className="space-y-4">
      {kin.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {kin.map((entry) => {
            const body = (
              <>
                <span className="font-medium">{entry.name}</span>
                <span className="text-muted-foreground">{entry.label}</span>
                {entry.strength !== null ? (
                  <span className="text-muted-foreground/70 tabular-nums">· {entry.strength}</span>
                ) : null}
              </>
            );
            const className =
              "flex items-center gap-1.5 rounded-full border border-border/70 px-2.5 py-1 text-xs";
            return (
              <li key={entry.name}>
                {knownAnimas.has(entry.name) ? (
                  <button
                    type="button"
                    onClick={() => onOpenAnima(entry.name)}
                    className={cn(
                      className,
                      "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    )}
                  >
                    {body}
                  </button>
                ) : (
                  <span className={className}>{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {user.length > 0 ? (
        <div className="space-y-2">
          <span className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
            How it reads you
          </span>
          <TraitBars traits={allUser ? user : user.slice(0, USER_MODEL_PREVIEW)} empty="" />
          {user.length > USER_MODEL_PREVIEW ? (
            <Button size="xs" variant="ghost" onClick={() => setAllUser((value) => !value)}>
              {allUser ? "Show fewer" : `Show all ${user.length}`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
