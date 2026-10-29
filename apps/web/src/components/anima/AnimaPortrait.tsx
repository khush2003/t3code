import { useAtomValue } from "@effect/atom-react";
import type { AnimaDetail, AnimaSummary, EnvironmentId } from "@t3tools/contracts";
import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CompassIcon,
  HeartIcon,
  SparkleIcon,
  ThumbsDownIcon,
  TriangleAlertIcon,
  WindIcon,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "../../lib/utils";
import { animaEnvironment, useAnimaList } from "../../state/anima";
import { useProjects } from "../../state/entities";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { ANIMA_HEALTH_LABELS, animaHealthBucket } from "./anima.logic";
import { AnimaLiveDot, RelativeTime, TraitBars, useAnimaMutation } from "./AnimaBits";
import {
  animaOrder,
  parseUserModel,
  parseVoiceSamples,
  soulMeaning,
  tensionText,
} from "./animaDashboard.logic";
import { AnimaHealthRing } from "./AnimaHealth";
import {
  animaBonds,
  bondLayout,
  parseIdentity,
  starfield,
  type BondKind,
  type IdentityBlock,
} from "./animaPortrait.logic";
import { CreaturePortrait, LifeStrip, SoulOrb, animaSoulColors } from "./AnimaSoul";
import { BreathNarrative, WakePreview } from "./AnimaTabs";
import { AnimaTeamChip, AnimaTeamSection } from "./AnimaTeam";
import { AnimaBodyPanel, TraitRadar } from "./AnimaVisuals";
import { StartAnimaThreadMenu } from "./StartAnimaThread";

type Soul = ReturnType<typeof animaSoulColors>;

function headerValue(detail: AnimaDetail, key: string): string | null {
  const value = detail.header.find((entry) => entry.key === key)?.value.trim();
  return value ? value : null;
}

function latestBreath(detail: AnimaDetail) {
  return detail.breaths.reduce<AnimaDetail["breaths"][number] | null>(
    (best, breath) => (best === null || breath.index > best.index ? breath : best),
    null,
  );
}

function SoulReading({
  label,
  value,
  word,
  fill,
}: {
  readonly label: string;
  readonly value: number;
  readonly word: string;
  readonly fill: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground/90">{word}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(4, Math.min(100, value))}%`, backgroundColor: fill }}
        />
      </div>
    </div>
  );
}

/** The anima's portrait: its soul colour as the room's light, past breaths as stars. */
export function PortraitHero({
  environmentId,
  name,
  detail,
  onHealth,
  onBreathe,
  onOpenAnima,
  onSelectBreath,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly detail: AnimaDetail | null | undefined;
  readonly onHealth: () => void;
  readonly onBreathe: () => void;
  readonly onOpenAnima: (name: string) => void;
  readonly onSelectBreath: (index: number) => void;
}) {
  const canOperate = useAtomValue(animaEnvironment.setEnabled.permissionAtom(environmentId));
  const setEnabled = useAnimaMutation(animaEnvironment.setEnabled, {
    failureTitle: `Could not update ${name}`,
  });
  const order = animaOrder(useAnimaList(environmentId).animas);
  const position = order.findIndex((anima) => anima.name === name);
  const previous = position > 0 ? order[position - 1] : undefined;
  const next = position >= 0 ? order[position + 1] : undefined;
  const full = detail?.summary;
  const soul = full ? animaSoulColors(full) : null;
  const meaning = soulMeaning(full?.hsl ?? null);
  const stars = detail
    ? starfield(Math.min(80, detail.breaths.length * 2)).map((star, index) => ({
        ...star,
        breath: detail.breaths[index % detail.breaths.length]!,
      }))
    : [];
  const style: CSSProperties | undefined = soul
    ? {
        backgroundImage: [
          `radial-gradient(42% 70% at 16% 38%, ${soul.glow}, transparent 72%)`,
          `radial-gradient(50% 80% at 92% 0%, ${soul.haze}, transparent 70%)`,
          `linear-gradient(to bottom, transparent 60%, var(--background))`,
        ].join(", "),
      }
    : undefined;
  return (
    <section className="relative overflow-hidden border-b border-border/50" style={style}>
      {soul ? (
        <svg aria-hidden className="pointer-events-none absolute inset-0 size-full opacity-70">
          {stars.map((star) => (
            <circle
              key={`${star.x}:${star.y}`}
              cx={`${star.x}%`}
              cy={`${star.y * 0.8}%`}
              r={star.r}
              fill={animaSoulColors({ hsl: star.breath.hsl, accent: full?.accent ?? null }).core}
              opacity={0.25 + (star.r / 3.5) * 0.45}
            />
          ))}
        </svg>
      ) : null}
      <div className="relative mx-auto max-w-6xl px-5 pt-5 pb-7 sm:px-8">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-2 tracking-widest uppercase">
            {full ? `${full.role} · born ` : "anima"}
            {full ? <RelativeTime value={full.born} /> : null}
          </span>
          <div className="flex items-center gap-1">
            {previous ? (
              <Button size="xs" variant="ghost" onClick={() => onOpenAnima(previous.name)}>
                <ChevronLeftIcon />
                {previous.name}
              </Button>
            ) : null}
            {next ? (
              <Button size="xs" variant="ghost" onClick={() => onOpenAnima(next.name)}>
                {next.name}
                <ChevronRightIcon />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_15rem]">
          <div className="relative mx-auto w-fit pr-8 pb-3 md:mx-0">
            {full ? (
              <SoulOrb anima={full} size={176} />
            ) : (
              <Skeleton shape="pill" className="size-44" />
            )}
            {full ? (
              <div className="absolute right-0 bottom-0">
                <CreaturePortrait environmentId={environmentId} anima={full} size={76} />
              </div>
            ) : null}
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="truncate text-5xl font-semibold tracking-tight sm:text-6xl">{name}</h2>
              {full ? <AnimaLiveDot live={full.live} /> : null}
            </div>
            {full?.aim ? (
              <p className="max-w-2xl text-xl leading-snug text-balance text-foreground/90">
                {full.aim}
              </p>
            ) : full ? (
              <p className="text-xl text-muted-foreground">
                No aim yet. It sets one when it breathes.
              </p>
            ) : (
              <Skeleton className="h-6 w-2/3" />
            )}
            {full?.vow ? (
              <p className="max-w-2xl font-serif text-lg leading-snug text-muted-foreground italic">
                “{full.vow}”
              </p>
            ) : null}
            {full ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {full.breathCount}
                  </span>{" "}
                  {full.breathCount === 1 ? "breath" : "breaths"}
                </span>
                <span>
                  active <RelativeTime value={full.lastActiveAt ?? full.lastBreathAt} />
                </span>
                {full.homeProject ? <span>lives in {full.homeProject}</span> : null}
                {full.inboxCount > 0 ? <span>{full.inboxCount} unread</span> : null}
                {detail ? <AnimaTeamChip detail={detail} onOpenAnima={onOpenAnima} /> : null}
              </div>
            ) : null}
          </div>

          {full && soul ? (
            <div className="space-y-4 rounded-2xl border border-border/50 bg-background/60 p-4 backdrop-blur-sm md:col-span-2 lg:col-span-1">
              <button
                type="button"
                onClick={onHealth}
                aria-label={`Health: ${ANIMA_HEALTH_LABELS[animaHealthBucket(full.health)]}. Open health details`}
                className="flex w-full items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <AnimaHealthRing score={full.health} size={44} showValue />
                <span className="text-sm">
                  <span className="block font-medium">
                    {ANIMA_HEALTH_LABELS[animaHealthBucket(full.health)]}
                  </span>
                  <span className="text-xs text-muted-foreground">Health</span>
                </span>
              </button>
              {meaning ? (
                <div className="space-y-2.5 border-t border-border/50 pt-3">
                  <p className="text-sm">
                    Working in{" "}
                    <span className="font-semibold capitalize" style={{ color: soul.core }}>
                      {meaning.domain}
                    </span>
                  </p>
                  <SoulReading
                    label="Focus"
                    value={meaning.focus}
                    word={meaning.focusLabel}
                    fill={soul.core}
                  />
                  <SoulReading
                    label="Vitality"
                    value={meaning.vitality}
                    word={meaning.vitalityLabel}
                    fill={soul.core}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {full ? (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <StartAnimaThreadMenu
              environmentId={environmentId}
              animaName={full.name}
              label="Start a thread"
              variant="default"
            />
            {detail && detail.threadIds.length > 0 ? (
              <Button size="sm" variant="outline" onClick={onBreathe}>
                <WindIcon />
                Breathe
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
                <WindIcon className="size-3" />
                Start a thread to breathe
              </span>
            )}
            <label className="ml-auto flex items-center gap-2 text-xs">
              Enabled
              <Switch
                checked={full.enabled}
                disabled={!canOperate}
                onCheckedChange={(enabled) =>
                  void setEnabled({ environmentId, input: { name: full.name, enabled } })
                }
              />
            </label>
          </div>
        ) : null}
        {detail && detail.breaths.length > 0 ? (
          <div className="mt-5">
            <LifeStrip breaths={detail.breaths} onSelect={onSelectBreath} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Chapter({
  id,
  eyebrow,
  title,
  soul,
  children,
}: {
  readonly id: string;
  readonly eyebrow: string;
  readonly title?: ReactNode;
  readonly soul: Soul;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-16 space-y-6 border-t border-border/60 pt-10 first:border-t-0 first:pt-0"
    >
      <header className="space-y-1.5">
        <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: soul.core }}>
          {eyebrow}
        </p>
        {title ? (
          <h3 className="text-2xl font-semibold tracking-tight text-balance">{title}</h3>
        ) : null}
      </header>
      {children}
    </section>
  );
}

function Label({ children }: { readonly children: ReactNode }) {
  return (
    <span className="text-2xs font-medium tracking-widest text-muted-foreground uppercase">
      {children}
    </span>
  );
}

/** Just enough markdown for identity prose: bold, italic and code spans. */
function Inline({ text }: { readonly text: string }) {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/).map((part, index) => {
    const key = `${index}:${part}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-muted px-1 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function Blocks({
  blocks,
  className,
}: {
  readonly blocks: ReadonlyArray<IdentityBlock>;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {blocks.map((block) =>
        block.kind === "list" ? (
          <ul key={block.lines.join("\n")} className="list-disc space-y-1 pl-5">
            {block.lines.map((line) => (
              <li key={line}>
                <Inline text={line} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={block.lines[0]}>
            <Inline text={block.lines[0]!} />
          </p>
        ),
      )}
    </div>
  );
}

function NowChapter({
  detail,
  soul,
  onSelectBreath,
}: {
  readonly detail: AnimaDetail;
  readonly soul: Soul;
  readonly onSelectBreath: (index: number) => void;
}) {
  const latest = latestBreath(detail);
  const tensions = detail.summary.tensions ?? [];
  const { memo } = detail.summary;
  return (
    <Chapter id="now" eyebrow="Now" soul={soul} title="What it is holding">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          {latest ? (
            <>
              <button
                type="button"
                onClick={() => onSelectBreath(latest.index)}
                className="flex items-center gap-2 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{
                    backgroundColor: animaSoulColors({ hsl: latest.hsl, accent: null }).core,
                  }}
                />
                Breath #{latest.index} · <RelativeTime value={latest.ts} />
              </button>
              <BreathNarrative breath={latest} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">It has not breathed yet.</p>
          )}
        </div>
        <div className="min-w-0 space-y-5">
          <div className="space-y-2.5">
            <Label>Tensions</Label>
            {tensions.length > 0 ? (
              <ul className="space-y-2">
                {tensions.map((tension) => (
                  <li key={tension.slug} className="flex items-start gap-2.5 text-sm leading-snug">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded-full px-1.5 text-2xs font-medium tabular-nums",
                        tension.age >= 8
                          ? "bg-warning/15 text-warning"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {tension.age}
                    </span>
                    <span className="min-w-0 break-words">{tensionText(tension.slug)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing held open.</p>
            )}
          </div>
          {memo ? (
            <div className="space-y-1.5 rounded-2xl p-4" style={{ backgroundColor: soul.haze }}>
              <Label>Memo to itself</Label>
              <p className="line-clamp-6 text-sm leading-relaxed break-words whitespace-pre-wrap">
                {memo}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Chapter>
  );
}

function VoiceChapter({
  detail,
  voice,
  soul,
}: {
  readonly detail: AnimaDetail;
  readonly voice: ReadonlyArray<IdentityBlock>;
  readonly soul: Soul;
}) {
  const style = headerValue(detail, "style");
  const biases = headerValue(detail, "biases");
  const samples = parseVoiceSamples(headerValue(detail, "samples") ?? "");
  const [lead, ...rest] = voice;
  return (
    <Chapter id="voice" eyebrow="Voice" soul={soul}>
      {lead ? (
        <blockquote className="relative max-w-3xl pl-8">
          <span
            aria-hidden
            className="absolute top-0 left-0 font-serif text-5xl leading-none"
            style={{ color: soul.core }}
          >
            “
          </span>
          <p className="font-serif text-2xl leading-snug text-foreground/90 italic">
            {lead.lines.join(" ")}
          </p>
          {rest.length > 0 ? (
            <Blocks blocks={rest} className="mt-3 text-sm leading-relaxed text-muted-foreground" />
          ) : null}
        </blockquote>
      ) : null}
      {style || biases ? (
        <div className="grid gap-6 sm:grid-cols-2">
          {style ? (
            <div className="space-y-1.5">
              <Label>Style</Label>
              <p className="text-sm leading-relaxed text-foreground/85">{style}</p>
            </div>
          ) : null}
          {biases ? (
            <div className="space-y-1.5">
              <Label>Biases</Label>
              <p className="text-sm leading-relaxed text-foreground/85">{biases}</p>
            </div>
          ) : null}
        </div>
      ) : null}
      {samples.length > 0 ? (
        <div className="space-y-2.5">
          <Label>How it sounds</Label>
          <ul className="grid gap-3 md:grid-cols-2">
            {samples.map((sample) => (
              <li
                key={sample.tag + sample.text}
                className="space-y-1 rounded-2xl rounded-tl-sm px-4 py-3"
                style={{ backgroundColor: soul.haze }}
              >
                <span
                  className="text-2xs font-semibold tracking-widest uppercase"
                  style={{ color: soul.core }}
                >
                  {sample.tag}
                </span>
                <p className="text-sm leading-snug">{sample.text}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Chapter>
  );
}

const COLLAPSE_AT = 520;

function Collapsible({ blocks }: { readonly blocks: ReadonlyArray<IdentityBlock> }) {
  const [open, setOpen] = useState(false);
  const long = blocks.reduce((sum, block) => sum + block.lines.join(" ").length, 0) > COLLAPSE_AT;
  return (
    <div className="space-y-1.5">
      <div className={cn("relative", long && !open && "max-h-56 overflow-hidden")}>
        <Blocks blocks={blocks} className="text-sm leading-relaxed text-foreground/80" />
        {long && !open ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-background" />
        ) : null}
      </div>
      {long ? (
        <Button size="xs" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Show less" : "Read all"}
        </Button>
      ) : null}
    </div>
  );
}

const SECTION_ICONS: Record<string, typeof HeartIcon> = {
  values: HeartIcon,
  likes: SparkleIcon,
  dislikes: ThumbsDownIcon,
  approach: CompassIcon,
  edges: TriangleAlertIcon,
};

function IdentityChapter({
  detail,
  soul,
  identity,
}: {
  readonly detail: AnimaDetail;
  readonly soul: Soul;
  readonly identity: ReturnType<typeof parseIdentity>;
}) {
  const arc = headerValue(detail, "arc");
  const arcBreath = headerValue(detail, "arc-breath");
  const traits = identity.sections.filter(
    (section) => section.title !== "voice" && !section.title.endsWith("notes"),
  );
  const notes = identity.sections.filter((section) => section.title.endsWith("notes"));
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  return (
    <Chapter id="identity" eyebrow="Identity" soul={soul} title="Who it has become">
      {identity.origin.length > 0 ? (
        <Blocks
          blocks={identity.origin}
          className="max-w-3xl text-base leading-relaxed text-foreground/85"
        />
      ) : null}
      {arc ? (
        <figure className="max-w-3xl border-l-2 pl-5" style={{ borderColor: soul.core }}>
          <p className="font-serif text-lg leading-relaxed text-foreground/90 italic">{arc}</p>
          {arcBreath ? (
            <figcaption className="mt-1.5 text-2xs text-muted-foreground">
              Its arc, written at breath {arcBreath}
            </figcaption>
          ) : null}
        </figure>
      ) : null}
      {traits.length > 0 ? (
        <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
          {traits.map((section) => {
            const Icon = SECTION_ICONS[section.title] ?? BookOpenIcon;
            return (
              <div key={section.title} className="min-w-0 space-y-2.5">
                <h4 className="flex items-center gap-2 text-sm font-semibold capitalize">
                  <span
                    className="grid size-7 place-items-center rounded-full [&_svg]:size-3.5"
                    style={{ backgroundColor: soul.haze, color: soul.core }}
                  >
                    <Icon />
                  </span>
                  {section.title}
                </h4>
                <Collapsible blocks={section.blocks} />
              </div>
            );
          })}
        </div>
      ) : null}
      {notes.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {notes.map((section) => (
            <Button
              key={section.title}
              size="xs"
              variant={openNotes === section.title ? "secondary" : "outline"}
              onClick={() =>
                setOpenNotes((value) => (value === section.title ? null : section.title))
              }
            >
              <BookOpenIcon />
              <span className="capitalize">{section.title}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {openNotes ? (
        <Blocks
          blocks={notes.find((section) => section.title === openNotes)?.blocks ?? []}
          className="max-w-3xl rounded-2xl bg-muted/40 p-5 text-sm leading-relaxed text-foreground/85"
        />
      ) : null}
    </Chapter>
  );
}

const BOND_LABELS: Record<BondKind, string> = {
  lead: "Lead",
  parent: "Parent",
  crew: "Crew",
  child: "Child",
  kin: "Kin",
  neighbour: "Neighbour",
};

function ConstellationChapter({
  detail,
  animas,
  soul,
  onOpenAnima,
}: {
  readonly detail: AnimaDetail;
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly soul: Soul;
  readonly onOpenAnima: (name: string) => void;
}) {
  const bonds = animaBonds(detail, animas);
  const layout = bondLayout(bonds);
  const user = parseUserModel(headerValue(detail, "user") ?? "").toSorted(
    (a, b) => b.mean - a.mean,
  );
  const [allUser, setAllUser] = useState(false);
  const kinds = [...new Set(bonds.map((bond) => bond.kind))];
  return (
    <Chapter
      id="constellation"
      eyebrow="Constellation"
      soul={soul}
      title={
        bonds.length > 0
          ? `Tied to ${bonds.length} ${bonds.length === 1 ? "anima" : "animas"}`
          : "On its own, for now"
      }
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <div
            className="relative h-96 overflow-hidden rounded-3xl border border-border/50"
            style={{
              backgroundImage: `radial-gradient(circle at 50% 50%, ${soul.haze}, transparent 70%)`,
            }}
          >
            <svg
              aria-hidden
              className="absolute inset-0 size-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
            >
              {layout.map(({ bond, x, y }) => (
                <line
                  key={bond.name}
                  x1={50}
                  y1={50}
                  x2={x}
                  y2={y}
                  stroke={bond.anima ? animaSoulColors(bond.anima).core : "var(--muted-foreground)"}
                  strokeOpacity={0.35 + bond.weight * 0.4}
                  strokeWidth={0.75 + bond.weight * 2}
                  strokeDasharray={bond.kind === "neighbour" ? "3 3" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <SoulOrb anima={detail.summary} size={64} />
            </div>
            {layout.map(({ bond, x, y }) => {
              const size = Math.round(16 + bond.weight * 22);
              return (
                <button
                  key={bond.name}
                  type="button"
                  disabled={!bond.anima}
                  onClick={() => onOpenAnima(bond.name)}
                  className="group absolute flex -translate-x-1/2 flex-col items-center gap-1 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
                  style={{ left: `${x}%`, top: `${y}%`, marginTop: -size / 2 }}
                >
                  <span className="transition-transform group-enabled:group-hover:scale-110">
                    {bond.anima ? (
                      <SoulOrb anima={bond.anima} size={size} />
                    ) : (
                      <span
                        className="block rounded-full border border-dashed border-muted-foreground/60"
                        style={{ width: size, height: size }}
                      />
                    )}
                  </span>
                  <span className="max-w-40 rounded-md bg-background/70 px-1.5 text-center text-xs leading-tight font-medium whitespace-nowrap backdrop-blur-sm">
                    {bond.name}
                    <span className="block text-2xs font-normal text-muted-foreground">
                      {bond.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {kinds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {kinds.map((kind) => (
                <Badge key={kind} size="sm" variant="outline">
                  {BOND_LABELS[kind]} · {bonds.filter((bond) => bond.kind === kind).length}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <div className="min-w-0 space-y-3">
          <Label>How it reads you</Label>
          {user.length > 0 ? (
            <>
              <TraitBars traits={allUser ? user : user.slice(0, 8)} empty="" />
              {user.length > 8 ? (
                <Button size="xs" variant="ghost" onClick={() => setAllUser((value) => !value)}>
                  {allUser ? "Show fewer" : `Show all ${user.length}`}
                </Button>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">It has not formed a picture of you yet.</p>
          )}
        </div>
      </div>
    </Chapter>
  );
}

function ShapeChapter({ detail, soul }: { readonly detail: AnimaDetail; readonly soul: Soul }) {
  return (
    <Chapter id="shape" eyebrow="Shape" soul={soul} title="How it thinks and what it can do">
      <div className="grid gap-10 md:grid-cols-3">
        <div className="min-w-0 space-y-2">
          <Label>Body</Label>
          <AnimaBodyPanel breaths={detail.breaths} accent={detail.summary.accent} />
        </div>
        <div className="min-w-0 space-y-2">
          <Label>Self</Label>
          <TraitRadar traits={detail.traits} />
          <TraitBars traits={detail.traits} empty="No traits recorded yet." />
        </div>
        <div className="min-w-0 space-y-2">
          <Label>Skills</Label>
          <TraitRadar traits={detail.skills} />
          <TraitBars traits={detail.skills} empty="No skills recorded yet." />
        </div>
      </div>
    </Chapter>
  );
}

const HIDDEN_HEADER_KEYS = new Set([
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

function WorkspaceChapter({
  environmentId,
  detail,
  soul,
  onOpenAnima,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
  readonly soul: Soul;
  readonly onOpenAnima: (name: string) => void;
}) {
  const { summary } = detail;
  const canOperate = useAtomValue(animaEnvironment.attach.permissionAtom(environmentId));
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const [projectId, setProjectId] = useState("");
  const [showWake, setShowWake] = useState(false);
  const attach = useAnimaMutation(animaEnvironment.attach, {
    failureTitle: "Could not attach project",
    successTitle: "Project attached",
  });
  const selected = projects.find((project) => project.id === projectId);
  const otherHeader = detail.header.filter((entry) => !HIDDEN_HEADER_KEYS.has(entry.key));
  const showTeam = detail.team.length > 0 || detail.lead !== null || summary.role === "lead";
  return (
    <Chapter id="workspace" eyebrow="Workspace" soul={soul}>
      <div className="grid gap-10 md:grid-cols-2">
        <div className="min-w-0 space-y-2.5">
          <Label>Projects</Label>
          <div className="flex flex-wrap gap-1.5">
            {summary.projects.length === 0 ? (
              <span className="text-sm text-muted-foreground">Not attached to any project.</span>
            ) : (
              summary.projects.map((project) => (
                <Badge key={project} variant="outline" size="sm">
                  {project}
                </Badge>
              ))
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Select value={projectId} onValueChange={(value) => setProjectId(String(value))}>
              <SelectTrigger size="sm" aria-label="Project to attach">
                <SelectValue>{selected?.title ?? "Attach to project..."}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id} label={project.title}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button
              size="xs"
              variant="outline"
              disabled={!selected || !canOperate}
              onClick={() =>
                selected &&
                void attach({
                  environmentId,
                  input: { name: summary.name, projectId: selected.id },
                })
              }
            >
              Attach
            </Button>
          </div>
        </div>
        <div className="min-w-0 space-y-2.5">
          <Label>Wake payload</Label>
          <Button size="xs" variant="outline" onClick={() => setShowWake((value) => !value)}>
            {showWake ? "Hide" : "Preview what a new thread receives"}
          </Button>
          {showWake ? <WakePreview environmentId={environmentId} name={summary.name} /> : null}
        </div>
        {showTeam ? (
          <div className="min-w-0 md:col-span-2">
            <AnimaTeamSection
              environmentId={environmentId}
              detail={detail}
              onOpenAnima={onOpenAnima}
            />
          </div>
        ) : null}
        {otherHeader.length > 0 ? (
          <div className="min-w-0 space-y-2.5 md:col-span-2">
            <Label>Other header lines</Label>
            <dl className="grid grid-cols-[minmax(0,7rem)_1fr] gap-x-4 gap-y-1.5 text-xs">
              {otherHeader.map((entry) => (
                <div key={entry.key} className="contents">
                  <dt className="truncate text-muted-foreground">{entry.key}</dt>
                  <dd className="line-clamp-3 min-w-0 break-words">{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>
    </Chapter>
  );
}

/** The detail page's default view: one continuous portrait instead of a grid of panels. */
export function Portrait({
  environmentId,
  detail,
  onSelectBreath,
  onOpenAnima,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
  readonly onSelectBreath: (index: number) => void;
  readonly onOpenAnima: (name: string) => void;
}) {
  const { animas } = useAnimaList(environmentId);
  const soul = animaSoulColors(detail.summary);
  const identity = parseIdentity(detail.identity);
  const voice = identity.sections.find((section) => section.title === "voice")?.blocks ?? [];
  const hasVoice =
    voice.length > 0 || ["style", "biases", "samples"].some((key) => headerValue(detail, key));
  const hasIdentity =
    identity.origin.length > 0 || identity.sections.length > 0 || headerValue(detail, "arc");
  const chapters = [
    { id: "now", label: "Now", show: true },
    { id: "voice", label: "Voice", show: hasVoice },
    { id: "identity", label: "Identity", show: hasIdentity },
    { id: "constellation", label: "Constellation", show: true },
    { id: "shape", label: "Shape", show: true },
    { id: "workspace", label: "Workspace", show: true },
  ].filter((chapter) => chapter.show);
  return (
    <div className="grid gap-10 xl:grid-cols-[9rem_minmax(0,1fr)]">
      <nav aria-label="Portrait chapters" className="hidden xl:block">
        <ol className="sticky top-20 space-y-1 border-l border-border/60">
          {chapters.map((chapter) => (
            <li key={chapter.id}>
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById(chapter.id)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
                className="-ml-px border-l-2 border-transparent py-1 pl-3 text-sm text-muted-foreground outline-none hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                {chapter.label}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div className="min-w-0 space-y-12">
        <NowChapter detail={detail} soul={soul} onSelectBreath={onSelectBreath} />
        {hasVoice ? <VoiceChapter detail={detail} voice={voice} soul={soul} /> : null}
        {hasIdentity ? <IdentityChapter detail={detail} soul={soul} identity={identity} /> : null}
        <ConstellationChapter
          detail={detail}
          animas={animas}
          soul={soul}
          onOpenAnima={onOpenAnima}
        />
        <ShapeChapter detail={detail} soul={soul} />
        <WorkspaceChapter
          environmentId={environmentId}
          detail={detail}
          soul={soul}
          onOpenAnima={onOpenAnima}
        />
      </div>
    </div>
  );
}
