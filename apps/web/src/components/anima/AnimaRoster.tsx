import { useAtomValue } from "@effect/atom-react";
import { ListIcon, MailIcon, OrbitIcon, PlusIcon, UsersIcon } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { AnimaSummary, EnvironmentId } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { animaEnvironment, useAnimaList } from "../../state/anima";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingsGroup } from "../settings/SettingsGroup";
import {
  ANIMA_HEALTH_LABELS,
  ANIMA_SORT_LABELS,
  animaHealthBucket,
  type AnimaSortMode,
  animaNeedsAttention,
  filterAnimas,
  sortAnimas,
} from "./anima.logic";
import { AnimaLiveDot, AnimaRoleBadge, RelativeTime, useAnimaMutation } from "./AnimaBits";
import { AnimaHealthRing } from "./AnimaHealth";
import { AnimaConstellation, AnimaSigil, animaColor } from "./AnimaVisuals";

function AnimaRosterRow({
  environmentId,
  anima,
  canOperate,
  onOpen,
}: {
  readonly environmentId: EnvironmentId;
  readonly anima: AnimaSummary;
  readonly canOperate: boolean;
  readonly onOpen: (name: string) => void;
}) {
  const setEnabled = useAnimaMutation(animaEnvironment.setEnabled, {
    failureTitle: `Could not update ${anima.name}`,
  });
  const color = animaColor(anima);
  return (
    <div
      className={cn(
        "relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent/30 sm:px-4",
        !anima.enabled && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-border"
        style={color ? { backgroundColor: color } : undefined}
      />
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => onOpen(anima.name)}
      >
        <AnimaSigil anima={anima} size={44} />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{anima.name}</span>
            <AnimaRoleBadge role={anima.role} />
            <AnimaLiveDot live={anima.live} />
          </span>
          {anima.aim ? (
            <span className="block truncate text-xs text-muted-foreground">{anima.aim}</span>
          ) : null}
          <span className="flex flex-wrap gap-x-3 text-2xs text-muted-foreground/80">
            <span>
              {anima.breathCount} {anima.breathCount === 1 ? "breath" : "breaths"}
            </span>
            <span>
              active <RelativeTime value={anima.lastActiveAt} />
            </span>
            {anima.projects.length > 0 ? (
              <span className="truncate">
                {anima.projects.length === 1
                  ? anima.projects[0]
                  : `${anima.projects.length} projects`}
              </span>
            ) : null}
          </span>
        </span>
        {anima.inboxCount > 0 ? (
          <Badge size="sm" variant="info" aria-label={`${anima.inboxCount} unread`}>
            <MailIcon />
            {anima.inboxCount}
          </Badge>
        ) : null}
        <Tooltip>
          <TooltipTrigger render={<span />}>
            <AnimaHealthRing score={anima.health} size={26} />
          </TooltipTrigger>
          <TooltipPopup>
            Health: {ANIMA_HEALTH_LABELS[animaHealthBucket(anima.health)]}
          </TooltipPopup>
        </Tooltip>
      </button>
      <Switch
        checked={anima.enabled}
        disabled={!canOperate}
        aria-label={`Enable ${anima.name}`}
        onCheckedChange={(enabled) =>
          void setEnabled({ environmentId, input: { name: anima.name, enabled } })
        }
      />
    </div>
  );
}

/** A live anima gets the room to show its colour and what it is doing right now. */
function LiveAnimaCard({
  anima,
  onOpen,
}: {
  readonly anima: AnimaSummary;
  readonly onOpen: (name: string) => void;
}) {
  const color = animaColor(anima);
  const style: CSSProperties | undefined = color
    ? {
        backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${color} 16%, transparent), transparent 70%)`,
        borderColor: `color-mix(in srgb, ${color} 40%, var(--border))`,
      }
    : undefined;
  return (
    <button
      type="button"
      className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3 text-left outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      style={style}
      onClick={() => onOpen(anima.name)}
    >
      <AnimaSigil anima={anima} size={52} />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-base font-semibold tracking-tight">{anima.name}</span>
          <AnimaLiveDot live />
        </span>
        <span className="line-clamp-2 text-xs text-foreground/80">
          {anima.aim ?? "No aim recorded yet."}
        </span>
        <span className="block text-2xs text-muted-foreground">
          {anima.breathCount} {anima.breathCount === 1 ? "breath" : "breaths"}, active{" "}
          <RelativeTime value={anima.lastActiveAt} />
        </span>
      </span>
    </button>
  );
}

function RosterSection({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2 px-3 text-sm font-medium sm:px-4">
        {title}
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </h3>
      {children}
    </section>
  );
}

function RosterSummary({
  animas,
  attentionOnly,
  onAttention,
}: {
  readonly animas: ReadonlyArray<AnimaSummary>;
  readonly attentionOnly: boolean;
  readonly onAttention: (next: boolean) => void;
}) {
  const live = animas.filter((anima) => anima.live).length;
  const attention = animas.filter(animaNeedsAttention).length;
  const unread = animas.reduce((sum, anima) => sum + anima.inboxCount, 0);
  const breaths = animas.reduce((sum, anima) => sum + anima.breathCount, 0);
  return (
    <p className="px-3 text-sm text-muted-foreground sm:px-4">
      <span className="font-medium text-foreground">{animas.length} animas</span> have taken{" "}
      {breaths.toLocaleString()} breaths.{" "}
      {live > 0 ? (
        <span className="text-success-foreground">{live} live now. </span>
      ) : (
        "None are live right now. "
      )}
      {attention > 0 ? (
        <button
          type="button"
          className="text-warning-foreground underline-offset-2 hover:underline"
          onClick={() => onAttention(!attentionOnly)}
        >
          {attentionOnly ? "Show everyone" : `${attention} need tending`}
        </button>
      ) : (
        "Every anima is steady"
      )}
      {unread > 0 ? `, ${unread} unread ${unread === 1 ? "message" : "messages"}.` : "."}
    </p>
  );
}

function RosterSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 px-3 sm:px-4">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} shape="card" className="h-14" />
        ))}
      </div>
      <SettingsGroup>
        {[0, 1, 2].map((key) => (
          <div key={key} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
            <Skeleton shape="pill" className="size-11 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
          </div>
        ))}
      </SettingsGroup>
    </div>
  );
}

export function AnimaRoster({
  environmentId,
  onOpen,
  onCreate,
  createDisabledReason,
}: {
  readonly environmentId: EnvironmentId;
  readonly onOpen: (name: string) => void;
  readonly onCreate: () => void;
  readonly createDisabledReason: string | null;
}) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "constellation">("list");
  const [sort, setSort] = useState<AnimaSortMode>("activity");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const { animas, cliAvailable, rootPath, error, isPending, data } = useAnimaList(environmentId);
  const canOperate = useAtomValue(animaEnvironment.setEnabled.permissionAtom(environmentId));
  const visible = filterAnimas(sortAnimas(animas, sort), query, attentionOnly);
  // Sections read as "who is here"; a search or the attention filter wants one flat result list.
  const sectioned = view === "list" && query.trim() === "" && !attentionOnly;
  const liveAnimas = visible.filter((anima) => anima.live);
  const tending = visible.filter((anima) => !anima.live && animaNeedsAttention(anima));
  const resting = visible.filter((anima) => !anima.live && !animaNeedsAttention(anima));
  const renderRow = (anima: AnimaSummary) => (
    <AnimaRosterRow
      key={anima.name}
      environmentId={environmentId}
      anima={anima}
      canOperate={canOperate}
      onOpen={onOpen}
    />
  );
  const createRow = (
    <button
      type="button"
      disabled={createDisabledReason !== null}
      aria-description={createDisabledReason ?? undefined}
      className="flex w-full items-center gap-3 px-3 py-3 text-left text-sm text-muted-foreground outline-none hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 sm:px-4"
      onClick={onCreate}
    >
      <span className="flex size-11 items-center justify-center rounded-full border border-dashed border-border">
        <PlusIcon className="size-4" />
      </span>
      New anima
    </button>
  );

  if (data === null) {
    return error || !isPending ? (
      <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
        {error ?? "Waiting for the environment."}
      </p>
    ) : (
      <RosterSkeleton />
    );
  }
  if (!cliAvailable) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>The anima CLI is not installed here</EmptyTitle>
          <EmptyDescription>
            Install it on this environment's machine to create and manage animas.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (animas.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UsersIcon />
          </EmptyMedia>
          <EmptyTitle>No animas yet</EmptyTitle>
          <EmptyDescription>
            An anima is a persistent identity that carries what it learned across threads
            {rootPath ? `. They live in ${rootPath}.` : "."}
          </EmptyDescription>
          <Button size="sm" disabled={createDisabledReason !== null} onClick={onCreate}>
            <PlusIcon />
            Create your first anima
          </Button>
          {createDisabledReason ? (
            <p className="text-2xs text-muted-foreground">{createDisabledReason}</p>
          ) : null}
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="@container/roster space-y-3">
      <RosterSummary animas={animas} attentionOnly={attentionOnly} onAttention={setAttentionOnly} />
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4">
        <div className="min-w-40 flex-1">
          <Input
            type="search"
            size="sm"
            value={query}
            placeholder="Filter by name, role, aim, or project"
            aria-label="Filter animas"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="w-36">
          <Select value={sort} onValueChange={(value) => setSort(value as AnimaSortMode)}>
            <SelectTrigger size="sm" aria-label="Sort animas">
              <SelectValue>{ANIMA_SORT_LABELS[sort]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {(Object.keys(ANIMA_SORT_LABELS) as AnimaSortMode[]).map((mode) => (
                <SelectItem key={mode} value={mode} label={ANIMA_SORT_LABELS[mode]}>
                  {ANIMA_SORT_LABELS[mode]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <ToggleGroup
          aria-label="Roster view"
          variant="segmented"
          value={[view]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "list" || value === "constellation") setView(value);
          }}
        >
          <Toggle value="list" aria-label="List view">
            <ListIcon />
          </Toggle>
          <Toggle value="constellation" aria-label="Constellation view">
            <OrbitIcon />
          </Toggle>
        </ToggleGroup>
      </div>
      {sectioned && liveAnimas.length > 0 ? (
        <RosterSection title="Live now" count={liveAnimas.length}>
          <div className="grid gap-2 px-3 sm:px-4 @xl/roster:grid-cols-2">
            {liveAnimas.map((anima) => (
              <LiveAnimaCard key={anima.name} anima={anima} onOpen={onOpen} />
            ))}
          </div>
        </RosterSection>
      ) : null}
      {sectioned ? (
        <>
          {tending.length > 0 ? (
            <RosterSection title="Needs tending" count={tending.length}>
              <SettingsGroup>{tending.map(renderRow)}</SettingsGroup>
            </RosterSection>
          ) : null}
          <RosterSection title="Resting" count={resting.length}>
            <SettingsGroup>
              {resting.map(renderRow)}
              {createRow}
            </SettingsGroup>
          </RosterSection>
        </>
      ) : (
        <SettingsGroup>
          {view === "constellation" && visible.length > 0 ? (
            <AnimaConstellation animas={visible} onOpen={onOpen} />
          ) : visible.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
              {attentionOnly && query.trim() === ""
                ? "Every anima is steady."
                : `No animas match "${query.trim()}"${attentionOnly ? " among those needing attention" : ""}.`}
            </p>
          ) : (
            visible.map(renderRow)
          )}
          {createRow}
        </SettingsGroup>
      )}
    </div>
  );
}
