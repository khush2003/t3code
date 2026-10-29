import { useState } from "react";
import type { AnimaDetail, AnimaName, EnvironmentId } from "@t3tools/contracts";

import { animaEnvironment } from "../../state/anima";
import { useEnvironmentQuery } from "../../state/query";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { cn } from "../../lib/utils";
import { SettingsGroup } from "../settings/SettingsGroup";
import {
  ANIMA_TABS,
  ANIMA_TAB_LABELS,
  type AnimaTab,
  groupOpens,
  isInboxMessageSettled,
} from "./anima.logic";
import { Portrait, PortraitHero } from "./AnimaPortrait";
import { AnimaHealthRing, HealthTab } from "./AnimaHealth";
import { InboxTab } from "./AnimaInbox";
import { OpensTab } from "./AnimaOpens";
import { PolicyTab } from "./AnimaPolicy";
import { SyncTab } from "./AnimaSyncTab";
import { animaColor } from "./AnimaVisuals";
import { ActivityTab, BreathsTab, IdentityTab, ThreadsTab } from "./AnimaTabs";

function TabMarker({ tab, detail }: { readonly tab: AnimaTab; readonly detail: AnimaDetail }) {
  switch (tab) {
    case "health":
      return <AnimaHealthRing score={detail.summary.health} size={12} />;
    case "inbox": {
      const unread = detail.inbox.filter((message) => !isInboxMessageSettled(message)).length;
      return unread > 0 ? (
        <Badge size="sm" variant="info">
          {unread}
        </Badge>
      ) : null;
    }
    case "opens": {
      const live = groupOpens(detail.opens).live.length;
      return live > 0 ? (
        <Badge size="sm" variant="secondary">
          {live}
        </Badge>
      ) : null;
    }
    case "policy":
      return detail.policy.pending.length > 0 ? (
        <Badge size="sm" variant="warning">
          {detail.policy.pending.length}
        </Badge>
      ) : null;
    default:
      return null;
  }
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 px-3 py-4 sm:px-4">
      <div className="flex items-center gap-4">
        <Skeleton shape="pill" className="size-28 shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-full" />
        </div>
      </div>
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function AnimaDetailView({
  environmentId,
  name,
  tab,
  onTab,
  onOpenAnima,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: AnimaName;
  readonly tab: AnimaTab;
  readonly onTab: (tab: AnimaTab) => void;
  readonly onOpenAnima: (name: string) => void;
}) {
  // Detail defaults to the newest breaths; the full history is fetched only when asked for.
  const [allBreaths, setAllBreaths] = useState(false);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const query = useEnvironmentQuery(
    animaEnvironment.detail({
      environmentId,
      input: allBreaths ? { name, breathLimit: 0 } : { name },
    }),
  );
  const detail = query.data;
  const accent = detail ? animaColor(detail.summary) : null;
  return (
    <div className="@container/anima pb-12">
      <PortraitHero
        environmentId={environmentId}
        name={name}
        detail={detail}
        onHealth={() => onTab("health")}
        onBreathe={() => onTab("breaths")}
        onOpenAnima={onOpenAnima}
        onSelectBreath={(index) => {
          setFocusIndex(index);
          onTab("breaths");
        }}
      />
      <div
        role="tablist"
        aria-label="Anima sections"
        className="sticky top-0 z-10 border-b border-border/60 bg-background/85 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 sm:px-8">
          {ANIMA_TABS.map((entry) => {
            const selected = entry === tab;
            return (
              <button
                key={entry}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn(
                  "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  selected
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                style={selected && accent ? { borderColor: accent } : undefined}
                onClick={() => onTab(entry)}
              >
                {ANIMA_TAB_LABELS[entry]}
                {detail ? <TabMarker tab={entry} detail={detail} /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mx-auto mt-8 max-w-6xl px-5 sm:px-8">
        {detail && tab === "overview" ? (
          <Portrait
            environmentId={environmentId}
            detail={detail}
            onOpenAnima={onOpenAnima}
            onSelectBreath={(index) => {
              setFocusIndex(index);
              onTab("breaths");
            }}
          />
        ) : (
          <SettingsGroup>
            {detail ? (
              tab === "health" ? (
                <HealthTab environmentId={environmentId} name={name} />
              ) : tab === "identity" ? (
                <IdentityTab environmentId={environmentId} detail={detail} />
              ) : tab === "breaths" ? (
                <BreathsTab
                  environmentId={environmentId}
                  detail={detail}
                  allLoaded={allBreaths}
                  onLoadAll={() => setAllBreaths(true)}
                  focusIndex={focusIndex}
                />
              ) : tab === "inbox" ? (
                <InboxTab environmentId={environmentId} detail={detail} />
              ) : tab === "opens" ? (
                <OpensTab
                  environmentId={environmentId}
                  detail={detail}
                  onAttach={() => onTab("overview")}
                />
              ) : tab === "policy" ? (
                <PolicyTab environmentId={environmentId} detail={detail} />
              ) : tab === "activity" ? (
                <ActivityTab environmentId={environmentId} detail={detail} />
              ) : tab === "threads" ? (
                <ThreadsTab environmentId={environmentId} detail={detail} />
              ) : (
                <SyncTab environmentId={environmentId} name={name} />
              )
            ) : query.error ? (
              <p className="px-3 py-4 text-xs text-destructive sm:px-4">{query.error}</p>
            ) : query.isPending ? (
              <DetailSkeleton />
            ) : (
              <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
                Waiting for the environment.
              </p>
            )}
          </SettingsGroup>
        )}
      </div>
    </div>
  );
}
