import { useAtomValue } from "@effect/atom-react";
import type { AnimaBreath, AnimaDetail, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { CircleHelpIcon, FileIcon, MailIcon, WindIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import { animaEnvironment, useAnimaList } from "../../state/anima";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { breathNoteText, buildAnimaFeed } from "./anima.logic";
import { RelativeTime, useAnimaMutation, useAnimaSoul } from "./AnimaBits";
import { groupByDay } from "./animaPortrait.logic";
import { SoulOrb, animaSoulColors } from "./AnimaSoul";
import { BreathNarrative, ThreadTitle } from "./AnimaTabs";
import { parseBreathNote } from "./soul.logic";
import { StartAnimaThreadMenu } from "./StartAnimaThread";

const ALL_PROJECTS = "\u0000all";

function timeOfDay(ts: string | null): string | null {
  if (ts === null) return null;
  const time = Date.parse(ts);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(time);
}

function scrollIntoCenter(element: HTMLElement | null) {
  element?.scrollIntoView({ block: "center" });
}

/** One node on the spine: a dot in the breath's own colour, with the line running through it. */
function SpineNode({
  color,
  glow,
  icon,
  last,
}: {
  readonly color: string;
  readonly glow: string;
  readonly icon?: ReactNode;
  readonly last: boolean;
}) {
  return (
    <div className="relative flex justify-center">
      <span
        aria-hidden
        className={cn("absolute top-0 w-px bg-border", last ? "h-4" : "bottom-0")}
      />
      <span
        className="relative mt-1.5 grid size-3.5 place-items-center rounded-full ring-4 ring-background [&_svg]:size-2.5 [&_svg]:text-background"
        style={{ backgroundColor: color, boxShadow: `0 0 12px ${glow}` }}
      >
        {icon}
      </span>
    </div>
  );
}

function ShapeBars({ breath }: { readonly breath: AnimaBreath }) {
  const soul = useAnimaSoul();
  if (!breath.shape) return null;
  const entries = [
    ["breadth", breath.shape.breadth],
    ["depth", breath.shape.depth],
    ["coupling", breath.shape.coupling],
  ] as const;
  return (
    <span className="inline-flex items-end gap-1">
      {entries.map(([label, value]) => (
        <span key={label} className="flex flex-col items-center gap-0.5">
          <span className="relative h-4 w-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className="absolute inset-x-0 bottom-0 rounded-full"
              style={{
                height: `${Math.max(8, value * 100)}%`,
                backgroundColor: soul?.core ?? "var(--primary)",
              }}
            />
          </span>
        </span>
      ))}
    </span>
  );
}

function BreathEntry({
  breath,
  focused,
  last,
}: {
  readonly breath: AnimaBreath;
  readonly focused: boolean;
  readonly last: boolean;
}) {
  const colors = animaSoulColors({ hsl: breath.hsl, accent: null });
  const note = parseBreathNote(breath.note);
  const text = breathNoteText(breath.note);
  const [showFiles, setShowFiles] = useState(false);
  return (
    <li
      ref={focused ? scrollIntoCenter : undefined}
      className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3"
    >
      <SpineNode color={colors.core} glow={colors.glow} last={last} />
      <div
        className={cn("min-w-0 space-y-2 rounded-2xl pb-7", focused && "-mx-3 px-3 pt-2")}
        style={focused ? { backgroundColor: colors.haze } : undefined}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground tabular-nums">#{breath.index}</span>
          {timeOfDay(breath.ts) ? <span>{timeOfDay(breath.ts)}</span> : null}
          {breath.project ? (
            <Badge size="sm" variant="outline">
              {breath.project}
            </Badge>
          ) : null}
          {note ? (
            <span className="font-mono text-2xs">
              {note.pitch} {note.quality} · vel {note.velocity} · {note.tempo} bpm
            </span>
          ) : null}
          <span className="ml-auto">
            <ShapeBars breath={breath} />
          </span>
        </div>
        {breath.aim ? (
          <p className="text-base leading-snug font-medium text-balance text-foreground/90">
            {breath.aim}
          </p>
        ) : null}
        {text ? <p className="text-sm whitespace-pre-wrap text-foreground/80">{text}</p> : null}
        <BreathNarrative breath={{ ...breath, aim: null }} />
        {breath.files.length > 0 ? (
          <div className="space-y-1">
            <Button size="xs" variant="ghost" onClick={() => setShowFiles((value) => !value)}>
              <FileIcon />
              {breath.files.length} {breath.files.length === 1 ? "file" : "files"}
            </Button>
            {showFiles ? (
              <ul className="space-y-0.5 pl-2 font-mono text-2xs text-muted-foreground">
                {breath.files.map((file) => (
                  <li key={file} className="truncate">
                    {file}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function DayHeading({ label, count }: { readonly label: string; readonly count: number }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
      <div className="relative flex justify-center">
        <span aria-hidden className="absolute inset-y-0 w-px bg-border" />
      </div>
      <h3 className="pt-1 pb-4 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
        <span className="ml-2 font-normal tracking-normal normal-case">
          {count} {count === 1 ? "entry" : "entries"}
        </span>
      </h3>
    </li>
  );
}

function PageHeading({
  eyebrow,
  title,
  children,
}: {
  readonly eyebrow: string;
  readonly title: ReactNode;
  readonly children?: ReactNode;
}) {
  const soul = useAnimaSoul();
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1.5">
        <p
          className="text-xs font-semibold tracking-widest uppercase"
          style={soul ? { color: soul.core } : undefined}
        >
          {eyebrow}
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </header>
  );
}

export { PageHeading };

export function BreathsTab({
  environmentId,
  detail,
  allLoaded,
  onLoadAll,
  focusIndex,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
  readonly allLoaded: boolean;
  readonly onLoadAll: () => void;
  readonly focusIndex: number | null;
}) {
  const now = Date.parse(useNowMinute());
  const canBreathe = useAtomValue(animaEnvironment.breathe.permissionAtom(environmentId));
  const breathe = useAnimaMutation(animaEnvironment.breathe, {
    failureTitle: "Could not request a breath",
    successTitle: "Breath requested",
  });
  const [threadId, setThreadId] = useState<ThreadId | null>(null);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState(ALL_PROJECTS);
  const chosen = threadId ?? detail.threadIds[0] ?? null;
  const projects = [
    ...new Set(detail.breaths.flatMap((breath) => (breath.project ? [breath.project] : []))),
  ];
  const needle = query.trim().toLowerCase();
  const breaths = detail.breaths
    .toSorted((a, b) => b.index - a.index)
    .filter((breath) => project === ALL_PROJECTS || breath.project === project)
    .filter(
      (breath) =>
        needle === "" ||
        [breath.aim, breath.note, breath.friction, ...breath.decisions, ...breath.open]
          .join(" ")
          .toLowerCase()
          .includes(needle),
    );
  const days = groupByDay(breaths, (breath) => breath.ts, now);
  const hasMore = !allLoaded && detail.summary.breathCount > detail.breaths.length;
  const firstTs = detail.breaths.reduce<string | null>(
    (first, breath) =>
      breath.ts !== null && (first === null || breath.ts < first) ? breath.ts : first,
    null,
  );
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Breaths"
        title={
          <>
            {detail.summary.breathCount} breaths
            {firstTs ? (
              <span className="text-muted-foreground">
                {" "}
                since <RelativeTime value={firstTs} />
              </span>
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {chosen ? (
            <>
              {detail.threadIds.length > 1 ? (
                <Select value={chosen} onValueChange={(value) => setThreadId(value as ThreadId)}>
                  <SelectTrigger size="sm" aria-label="Thread to breathe in">
                    <SelectValue>
                      <ThreadTitle environmentId={environmentId} threadId={chosen} />
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {detail.threadIds.map((id) => (
                      <SelectItem key={id} value={id} label={id}>
                        <ThreadTitle environmentId={environmentId} threadId={id} />
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              ) : null}
              <Button
                size="sm"
                disabled={!canBreathe}
                onClick={() => void breathe({ environmentId, input: { threadId: chosen } })}
              >
                <WindIcon />
                Breathe now
              </Button>
            </>
          ) : (
            <StartAnimaThreadMenu
              environmentId={environmentId}
              animaName={detail.summary.name}
              label="Start a thread to breathe"
            />
          )}
        </div>
      </PageHeading>

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-56 flex-1">
          <Input
            size="sm"
            value={query}
            placeholder="Search breaths: aims, decisions, friction..."
            aria-label="Search breaths"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {projects.length > 1 ? (
          <Select value={project} onValueChange={(value) => setProject(String(value))}>
            <SelectTrigger size="sm" aria-label="Project" className="w-48">
              <SelectValue>{project === ALL_PROJECTS ? "All projects" : project}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={ALL_PROJECTS} label="All projects">
                All projects
              </SelectItem>
              {projects.map((entry) => (
                <SelectItem key={entry} value={entry} label={entry}>
                  {entry}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
      </div>

      {breaths.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {detail.breaths.length === 0 ? "No breaths yet." : "No breath matches."}
        </p>
      ) : (
        <ol>
          {days.map((day, dayIndex) => (
            <DayGroup key={day.key} label={day.label} count={day.items.length}>
              {day.items.map((breath, index) => (
                <BreathEntry
                  key={breath.index}
                  breath={breath}
                  focused={breath.index === focusIndex}
                  last={dayIndex === days.length - 1 && index === day.items.length - 1 && !hasMore}
                />
              ))}
            </DayGroup>
          ))}
        </ol>
      )}
      {hasMore ? (
        <Button size="sm" variant="outline" onClick={onLoadAll}>
          Load all {detail.summary.breathCount} breaths
        </Button>
      ) : null}
    </div>
  );
}

function DayGroup({
  label,
  count,
  children,
}: {
  readonly label: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <>
      <DayHeading label={label} count={count} />
      {children}
    </>
  );
}

/** Breaths, messages and open questions on one spine, newest first. */
export function ActivityTab({
  environmentId,
  detail,
}: {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
}) {
  const now = Date.parse(useNowMinute());
  const { animas } = useAnimaList(environmentId);
  const byName = new Map(animas.map((anima) => [anima.name, anima]));
  const feed = buildAnimaFeed(detail);
  const days = groupByDay(feed.items, (item) => item.ts, now);
  const soul = useAnimaSoul();
  return (
    <div className="space-y-8">
      <PageHeading eyebrow="Activity" title="Everything that has happened, in order" />
      {feed.pinned.length > 0 ? (
        <div className="space-y-2">
          <p className="text-2xs font-medium tracking-widest text-muted-foreground uppercase">
            Open questions
          </p>
          <ul className="grid gap-2 md:grid-cols-2">
            {feed.pinned.map((open) => (
              <li
                key={open.id}
                className="space-y-1 rounded-2xl px-4 py-3"
                style={{ backgroundColor: soul?.haze ?? "var(--muted)" }}
              >
                <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                  <CircleHelpIcon className="size-3" />
                  {open.project}
                  {open.assignee ? ` · ${open.assignee}` : ""}
                </span>
                <p className="text-sm leading-snug">{open.question}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {feed.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ol>
          {days.map((day, dayIndex) => (
            <DayGroup key={day.key} label={day.label} count={day.items.length}>
              {day.items.map((item, index) => {
                const last = dayIndex === days.length - 1 && index === day.items.length - 1;
                if (item.kind === "breath") {
                  return (
                    <BreathEntry key={item.key} breath={item.breath} focused={false} last={last} />
                  );
                }
                const sender = byName.get(item.message.from);
                const colors = sender
                  ? animaSoulColors(sender)
                  : { core: "var(--muted-foreground)", glow: "transparent" };
                return (
                  <li key={item.key} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
                    <SpineNode
                      color={colors.core}
                      glow={colors.glow}
                      icon={<MailIcon />}
                      last={last}
                    />
                    <div className="min-w-0 space-y-1.5 pb-7">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {sender ? <SoulOrb anima={sender} size={16} /> : null}
                        <span className="font-medium text-foreground">{item.message.from}</span>
                        <Badge size="sm" variant="outline">
                          {item.message.type}
                        </Badge>
                        <RelativeTime value={item.ts} />
                      </div>
                      <p className="max-w-3xl rounded-2xl rounded-tl-sm bg-muted/50 px-4 py-2.5 text-sm whitespace-pre-wrap">
                        {item.message.body}
                      </p>
                    </div>
                  </li>
                );
              })}
            </DayGroup>
          ))}
        </ol>
      )}
    </div>
  );
}
