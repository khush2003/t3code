import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { IdCardIcon } from "lucide-react";
import { type ReactNode } from "react";
import type { AnimaDetail, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { animaEnvironment } from "../../state/anima";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  AnimaBlock,
  AnimaEmptyNote,
  PageHeading,
  RelativeTime,
  TraitBars,
  useAnimaSoul,
} from "./AnimaBits";
import { StartAnimaThreadMenu } from "./StartAnimaThread";

interface TabProps {
  readonly environmentId: EnvironmentId;
  readonly detail: AnimaDetail;
}

export function WakePreview({
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
    <div className="space-y-4 rounded-2xl bg-muted/30 p-5">
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
    <div className="space-y-8">
      <PageHeading eyebrow="Identity" title="Its own words, as it keeps them" />
      <div className="grid gap-10 @3xl/anima:grid-cols-[minmax(0,1fr)_18rem]">
        <article className="min-w-0 max-w-3xl">
          {detail.identity.trim() === "" ? (
            <p className="text-sm text-muted-foreground">This anima has no identity file yet.</p>
          ) : (
            <ChatMarkdown text={detail.identity} cwd={undefined} environmentId={environmentId} />
          )}
        </article>
        <aside className="min-w-0 @3xl/anima:sticky @3xl/anima:top-16 @3xl/anima:self-start">
          <AnimaCardPanel detail={detail} />
        </aside>
      </div>
    </div>
  );
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
export function BreathNarrative({ breath }: { readonly breath: AnimaDetail["breaths"][number] }) {
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

export function ThreadTitle({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  return <span className="truncate">{shell?.title ?? threadId}</span>;
}

function ThreadLinkRow({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const shell = useThreadShell(scopeThreadRef(environmentId, threadId));
  const soul = useAnimaSoul();
  return (
    <li>
      {shell ? (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId, threadId }}
          className="flex h-full flex-col gap-1.5 rounded-2xl border-l-4 bg-muted/30 px-5 py-4 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          style={{ borderLeftColor: soul?.core ?? "var(--border)" }}
        >
          <span className="truncate text-base font-medium">{shell.title || "Untitled thread"}</span>
          <span className="text-xs text-muted-foreground">
            updated <RelativeTime value={shell.updatedAt} />
          </span>
        </Link>
      ) : (
        <span className="block rounded-2xl bg-muted/30 px-5 py-4 text-sm text-muted-foreground">
          {threadId} (not loaded)
        </span>
      )}
    </li>
  );
}

export function ThreadsTab({ environmentId, detail }: TabProps) {
  const count = detail.threadIds.length;
  return (
    <div className="space-y-8">
      <PageHeading
        eyebrow="Threads"
        title={`${count} ${count === 1 ? "thread runs" : "threads run"} with ${detail.summary.name}`}
      >
        <StartAnimaThreadMenu environmentId={environmentId} animaName={detail.summary.name} />
      </PageHeading>
      {count === 0 ? (
        <p className="text-sm text-muted-foreground">No thread uses this anima yet.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {detail.threadIds.map((threadId) => (
            <ThreadLinkRow key={threadId} environmentId={environmentId} threadId={threadId} />
          ))}
        </ul>
      )}
    </div>
  );
}
