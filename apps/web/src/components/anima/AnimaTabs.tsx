import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { IdCardIcon, WindIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AnimaDetail, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { animaEnvironment } from "../../state/anima";
import { useProjects, useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsGroup } from "../settings/SettingsGroup";
import { breathNoteText, buildAnimaFeed } from "./anima.logic";
import {
  AnimaAccentDot,
  AnimaBlock,
  AnimaEmptyNote,
  RelativeTime,
  TraitBars,
  useAnimaMutation,
} from "./AnimaBits";
import { AnimaTeamSection } from "./AnimaTeam";
import { StartAnimaThreadMenu } from "./StartAnimaThread";
import { AnimaBodyPanel, TraitRadar } from "./AnimaVisuals";

interface TabProps {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
}

function WakePreview({
  environmentId,
  name,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: string;
}) {
  const query = useEnvironmentQuery(
    animaEnvironment.wakePreview({ environmentId, input: { name } }),
  );
  return (
    <pre className="max-h-72 overflow-auto rounded-md bg-muted/40 p-2 text-2xs whitespace-pre-wrap">
      {query.data?.payload ?? query.error ?? "Loading..."}
    </pre>
  );
}

export function OverviewTab({
  environmentId,
  detail,
  onSelectBreath,
  onOpenAnima,
}: TabProps & {
  readonly onSelectBreath: (index: number) => void;
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
  return (
    <div className="grid gap-4 @3xl/anima:grid-cols-3">
      <BentoCard className="@3xl/anima:col-span-2">
        <LatestBreath breaths={detail.breaths} onSelectBreath={onSelectBreath} />
      </BentoCard>
      <BentoCard title="Body" hint="Breadth, depth and coupling of every breath">
        <AnimaBodyPanel breaths={detail.breaths} accent={summary.accent} />
      </BentoCard>
      {summary.voice ? (
        <BentoCard
          title="Voice"
          className={summary.memo ? "@3xl/anima:col-span-2" : "@3xl/anima:col-span-3"}
        >
          <p className="text-base leading-relaxed text-foreground/90">{summary.voice}</p>
        </BentoCard>
      ) : null}
      {summary.memo ? (
        <BentoCard title="Memo" className={summary.voice ? "" : "@3xl/anima:col-span-3"}>
          <p className="line-clamp-6 break-words whitespace-pre-wrap text-sm text-foreground/85">
            {summary.memo}
          </p>
        </BentoCard>
      ) : null}
      <BentoCard title="Traits">
        <TraitRadar traits={detail.traits} />
        <TraitBars traits={detail.traits} empty="No traits recorded yet." />
      </BentoCard>
      <BentoCard title="Skills">
        <TraitRadar traits={detail.skills} />
        <TraitBars traits={detail.skills} empty="No skills recorded yet." />
      </BentoCard>
      <BentoCard title="Projects">
        <div className="flex flex-wrap gap-1.5">
          {summary.projects.length === 0 ? (
            <span className="text-xs text-muted-foreground">Not attached to any project.</span>
          ) : (
            summary.projects.map((project) => (
              <Badge key={project} variant="outline" size="sm">
                {project}
              </Badge>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 pt-1.5">
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
              void attach({ environmentId, input: { name: summary.name, projectId: selected.id } })
            }
          >
            Attach
          </Button>
        </div>
      </BentoCard>
      {detail.team.length > 0 || detail.lead !== null || summary.role === "lead" ? (
        <BentoCard className="@3xl/anima:col-span-3">
          <AnimaTeamSection
            environmentId={environmentId}
            detail={detail}
            onOpenAnima={onOpenAnima}
          />
        </BentoCard>
      ) : null}
      <BentoCard title="Wake payload" className="@3xl/anima:col-span-2">
        <Button size="xs" variant="ghost-muted" onClick={() => setShowWake((value) => !value)}>
          {showWake ? "Hide" : "Preview what a new thread receives"}
        </Button>
        {showWake ? <WakePreview environmentId={environmentId} name={summary.name} /> : null}
      </BentoCard>
      {detail.header.length > 0 ? (
        <BentoCard title="Header">
          <dl className="grid grid-cols-[minmax(0,6rem)_1fr] gap-x-3 gap-y-1 text-xs">
            {detail.header.map((entry) => (
              <div key={entry.key} className="contents">
                <dt className="truncate text-muted-foreground">{entry.key}</dt>
                <dd className="line-clamp-3 min-w-0 break-words">{entry.value}</dd>
              </div>
            ))}
          </dl>
        </BentoCard>
      ) : null}
    </div>
  );
}

function BentoCard({
  title,
  hint,
  className,
  children,
}: {
  readonly title?: string;
  readonly hint?: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-w-0 space-y-3 rounded-2xl border border-border/60 bg-card/70 p-4 shadow-xs",
        className,
      )}
    >
      {title ? (
        <header className="space-y-0.5">
          <h3 className="text-xs font-medium text-foreground/80">{title}</h3>
          {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function AnimaCardPanel({ detail }: { readonly detail: AnimaDetail }) {
  const { card, offers } = detail;
  if (card === null && offers.length === 0) {
    return (
      <AnimaEmptyNote icon={<IdCardIcon />} title="No card yet">
        The anima CLI writes a card describing what this anima can do. It appears here once
        generated.
      </AnimaEmptyNote>
    );
  }
  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card/60 p-3">
      {card ? (
        <>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
              <IdCardIcon className="size-3.5" />
              <span className="font-medium">Card</span>
              {card.version ? <span>v{card.version}</span> : null}
              {card.status ? (
                <Badge size="sm" variant="secondary">
                  {card.status}
                </Badge>
              ) : null}
            </div>
            {card.description ? <p className="text-sm">{card.description}</p> : null}
            {card.generatedAt ? (
              <p className="text-2xs text-muted-foreground">
                generated <RelativeTime value={card.generatedAt} />
              </p>
            ) : null}
          </div>
          {card.skills.length > 0 ? (
            <AnimaBlock title="Skills">
              <TraitBars
                traits={card.skills.map((skill) => ({
                  name: skill.name,
                  mean: skill.confidence,
                  sigma: null,
                }))}
                empty=""
              />
            </AnimaBlock>
          ) : null}
          {card.interfaces.length > 0 ? (
            <AnimaBlock title="Interfaces">
              <div className="flex flex-wrap gap-1">
                {card.interfaces.map((entry) => (
                  <Badge key={entry} size="sm" variant="outline">
                    {entry}
                  </Badge>
                ))}
              </div>
            </AnimaBlock>
          ) : null}
        </>
      ) : null}
      {offers.length > 0 ? (
        <AnimaBlock title="Offers for consults">
          <div className="flex flex-wrap gap-1">
            {offers.map((offer) => (
              <Badge key={offer} size="sm" variant="info">
                {offer}
              </Badge>
            ))}
          </div>
        </AnimaBlock>
      ) : null}
    </div>
  );
}

export function IdentityTab({ environmentId, detail }: TabProps) {
  return (
    <div className="grid gap-5 px-3 py-3 sm:px-4 @2xl/anima:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0 @2xl/anima:order-first">
        {detail.identity.trim() === "" ? (
          <p className="text-xs text-muted-foreground">This anima has no identity file yet.</p>
        ) : (
          <ChatMarkdown text={detail.identity} cwd={undefined} environmentId={environmentId} />
        )}
      </div>
      <aside className="order-first min-w-0 @2xl/anima:order-none @2xl/anima:sticky @2xl/anima:top-3 @2xl/anima:self-start">
        <AnimaCardPanel detail={detail} />
      </aside>
    </div>
  );
}

function scrollIntoCenter(element: HTMLElement | null) {
  element?.scrollIntoView({ block: "center" });
}

function NarrativeLine({
  label,
  tone = "default",
  children,
}: {
  readonly label: string;
  readonly tone?: "default" | "warning" | "info";
  readonly children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-xs">
      <span
        className={cn(
          "text-xs font-medium",
          tone === "warning"
            ? "text-warning-foreground"
            : tone === "info"
              ? "text-info-foreground"
              : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <div className="min-w-0 text-foreground/90">{children}</div>
    </div>
  );
}

/** What a breath recorded: decisions, friction, aim and the rest of its detail file. */
function BreathNarrative({ breath }: { readonly breath: AnimaDetail["breaths"][number] }) {
  return (
    <div className="space-y-1.5">
      {breath.decisions.length > 0 ? (
        <NarrativeLine label="Decided">
          {breath.decisions.length === 1 ? (
            <p>{breath.decisions[0]}</p>
          ) : (
            <ul className="list-disc space-y-0.5 pl-4">
              {breath.decisions.map((decision) => (
                <li key={decision}>{decision}</li>
              ))}
            </ul>
          )}
        </NarrativeLine>
      ) : null}
      {breath.friction ? (
        <NarrativeLine label="Friction" tone="warning">
          <p>{breath.friction}</p>
        </NarrativeLine>
      ) : null}
      {breath.aim ? (
        <NarrativeLine label="Aim" tone="info">
          <p>{breath.aim}</p>
        </NarrativeLine>
      ) : null}
      {breath.corrections.length > 0 ? (
        <NarrativeLine label="Corrected">
          <ul className="space-y-0.5">
            {breath.corrections.map((correction) => {
              const [words, principle] = correction.split("|");
              return (
                <li key={correction}>
                  <span className="italic">{words}</span>
                  {principle ? <span className="text-muted-foreground"> → {principle}</span> : null}
                </li>
              );
            })}
          </ul>
        </NarrativeLine>
      ) : null}
      {breath.seeking ? (
        <NarrativeLine label="Seeking">
          <p>{breath.seeking}</p>
        </NarrativeLine>
      ) : null}
      {breath.resume ? (
        <NarrativeLine label="Resume">
          <p className="whitespace-pre-wrap">{breath.resume}</p>
        </NarrativeLine>
      ) : null}
      {breath.open.length > 0 ? (
        <NarrativeLine label="Open" tone="warning">
          <p>{breath.open.join("; ")}</p>
        </NarrativeLine>
      ) : null}
      {breath.closedOpens.length > 0 ? (
        <NarrativeLine label="Closed">
          <p className="text-muted-foreground">{breath.closedOpens.join("; ")}</p>
        </NarrativeLine>
      ) : null}
      {breath.self.length > 0 ? (
        <NarrativeLine label="Self">
          <div className="flex flex-wrap gap-1">
            {breath.self.map((trait) => (
              <Badge key={trait.name} size="sm" variant="outline">
                {trait.name} {trait.mean.toFixed(2)}
              </Badge>
            ))}
          </div>
        </NarrativeLine>
      ) : null}
    </div>
  );
}

export function LatestBreath({
  breaths,
  onSelectBreath,
}: {
  readonly breaths: AnimaDetail["breaths"];
  readonly onSelectBreath: (index: number) => void;
}) {
  const latest = breaths.reduce<AnimaDetail["breaths"][number] | null>(
    (best, breath) => (best === null || breath.index > best.index ? breath : best),
    null,
  );
  if (latest === null) return null;
  return (
    <AnimaBlock
      title="Latest breath"
      action={
        <Button size="xs" variant="ghost" onClick={() => onSelectBreath(latest.index)}>
          #{latest.index} · <RelativeTime value={latest.ts} />
        </Button>
      }
    >
      <BreathNarrative breath={latest} />
    </AnimaBlock>
  );
}

function BreathRow({
  breath,
  focused,
}: {
  readonly breath: AnimaDetail["breaths"][number];
  readonly focused?: boolean;
}) {
  const note = breathNoteText(breath.note);
  return (
    <li
      ref={focused ? scrollIntoCenter : undefined}
      className={cn("space-y-1.5 px-3 py-2.5 sm:px-4", focused && "bg-accent/40")}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge size="sm" variant="outline">
          #{breath.index}
        </Badge>
        <RelativeTime value={breath.ts} />
        {breath.project ? <span className="truncate">{breath.project}</span> : null}
      </div>
      {note ? <p className="whitespace-pre-wrap text-sm">{note}</p> : null}
      <BreathNarrative breath={breath} />
      {breath.files.length > 0 ? (
        <p className="truncate font-mono text-2xs text-muted-foreground">
          {breath.files.length} {breath.files.length === 1 ? "file" : "files"}:{" "}
          {breath.files.join(", ")}
        </p>
      ) : null}
    </li>
  );
}

export function BreathsTab({
  environmentId,
  detail,
  allLoaded,
  onLoadAll,
  focusIndex,
}: TabProps & {
  readonly allLoaded: boolean;
  readonly onLoadAll: () => void;
  readonly focusIndex: number | null;
}) {
  const canBreathe = useAtomValue(animaEnvironment.breathe.permissionAtom(environmentId));
  const breathe = useAnimaMutation(animaEnvironment.breathe, {
    failureTitle: "Could not request a breath",
    successTitle: "Breath requested",
  });
  const [threadId, setThreadId] = useState<ThreadId | null>(null);
  const chosen = threadId ?? detail.threadIds[0] ?? null;
  const breaths = detail.breaths.toSorted((a, b) => b.index - a.index);
  const hasMore = !allLoaded && detail.summary.breathCount > detail.breaths.length;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2.5 sm:px-4">
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
            ) : (
              <span className="text-xs text-muted-foreground">
                in <ThreadTitle environmentId={environmentId} threadId={chosen} />
              </span>
            )}
            <Button
              size="xs"
              variant="outline"
              disabled={!canBreathe}
              onClick={() => void breathe({ environmentId, input: { threadId: chosen } })}
            >
              <WindIcon className="size-3" />
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
        <span className="ml-auto text-2xs text-muted-foreground">
          {detail.summary.breathCount} total
        </span>
      </div>
      {breaths.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">No breaths yet.</p>
      ) : (
        <ul className="divide-y divide-border/50">
          {breaths.map((breath) => (
            <BreathRow key={breath.index} breath={breath} focused={breath.index === focusIndex} />
          ))}
        </ul>
      )}
      {hasMore ? (
        <div className="border-t border-border/50 px-3 py-2.5 sm:px-4">
          <Button size="xs" variant="ghost-muted" onClick={onLoadAll}>
            Load all {detail.summary.breathCount} breaths
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ThreadTitle({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  return <span className="truncate">{shell?.title ?? threadId}</span>;
}

export function ActivityTab({ detail }: TabProps) {
  const feed = buildAnimaFeed(detail);
  if (feed.pinned.length === 0 && feed.items.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">No activity yet.</p>;
  }
  return (
    <ul className="divide-y divide-border/50">
      {feed.pinned.map((open) => (
        <li key={`open:${open.id}`} className="space-y-0.5 px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-2">
            <Badge size="sm" variant="warning">
              Open
            </Badge>
            <span className="text-2xs text-muted-foreground">
              {open.project}
              {open.assignee ? ` - ${open.assignee}` : ""}
            </span>
          </div>
          <p className="text-sm">{open.question}</p>
        </li>
      ))}
      {feed.items.map((item) =>
        item.kind === "message" ? (
          <li key={item.key} className="space-y-0.5 px-3 py-2.5 sm:px-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge size="sm" variant="info">
                {item.message.type}
              </Badge>
              <span>from {item.message.from}</span>
              <RelativeTime value={item.ts} />
            </div>
            <p className="whitespace-pre-wrap text-sm">{item.message.body}</p>
          </li>
        ) : (
          <BreathRow key={item.key} breath={item.breath} />
        ),
      )}
    </ul>
  );
}

function ThreadLinkRow({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  return (
    <li className="px-3 py-2 text-sm sm:px-4">
      {shell ? (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          className="flex items-center justify-between gap-3 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <span className="truncate">{shell.title || "Untitled thread"}</span>
          <RelativeTime value={shell.updatedAt} />
        </Link>
      ) : (
        <span className="text-muted-foreground">{threadId} (not loaded)</span>
      )}
    </li>
  );
}

export function ThreadsTab({ environmentId, detail }: TabProps) {
  return (
    <div>
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2.5 sm:px-4">
        <span className="text-xs text-muted-foreground">
          {detail.threadIds.length} {detail.threadIds.length === 1 ? "thread uses" : "threads use"}{" "}
          <AnimaAccentDot accent={detail.summary.accent} className="mx-1 size-1.5" />
          {detail.summary.name}
        </span>
        <StartAnimaThreadMenu environmentId={environmentId} animaName={detail.summary.name} />
      </div>
      {detail.threadIds.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
          No thread uses this anima yet.
        </p>
      ) : (
        <SettingsGroup variant="plain" divided={false}>
          <ul className="divide-y divide-border/50">
            {detail.threadIds.map((threadId) => (
              <ThreadLinkRow key={threadId} environmentId={environmentId} threadId={threadId} />
            ))}
          </ul>
        </SettingsGroup>
      )}
    </div>
  );
}
