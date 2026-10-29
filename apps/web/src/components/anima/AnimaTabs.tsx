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
import { SettingsGroup } from "../settings/SettingsGroup";
import { AnimaAccentDot, AnimaBlock, AnimaEmptyNote, RelativeTime, TraitBars } from "./AnimaBits";
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
