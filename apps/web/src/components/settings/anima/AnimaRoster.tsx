import { useAtomValue } from "@effect/atom-react";
import { ListIcon, OrbitIcon, PlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import type { AnimaSummary, EnvironmentId } from "@t3tools/contracts";

import { animaEnvironment, useAnimaList } from "../../../state/anima";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../../ui/empty";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { SettingsGroup } from "../SettingsGroup";
import { filterAnimas, sortAnimas } from "../animaSettings.logic";
import { AnimaLiveDot, AnimaRoleBadge, RelativeTime, useAnimaMutation } from "./AnimaBits";
import { AnimaConstellation, AnimaSigil } from "./AnimaVisuals";

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
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
            {anima.inboxCount > 0 ? <span>{anima.inboxCount} unread</span> : null}
          </span>
        </span>
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
  const { animas, cliAvailable, rootPath, error, isPending, data } = useAnimaList(environmentId);
  const canOperate = useAtomValue(animaEnvironment.setEnabled.permissionAtom(environmentId));
  const visible = filterAnimas(sortAnimas(animas), query);

  if (data === null) {
    return (
      <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
        {error ?? (isPending ? "Loading animas..." : "Waiting for the environment.")}
      </p>
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
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-3 sm:px-4">
        <Input
          type="search"
          size="sm"
          value={query}
          placeholder="Filter by name, role, aim, or project"
          aria-label="Filter animas"
          onChange={(event) => setQuery(event.target.value)}
        />
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
      <SettingsGroup>
        {view === "constellation" && visible.length > 0 ? (
          <AnimaConstellation animas={visible} onOpen={onOpen} />
        ) : visible.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground sm:px-4">
            No animas match "{query.trim()}".
          </p>
        ) : (
          visible.map((anima) => (
            <AnimaRosterRow
              key={anima.name}
              environmentId={environmentId}
              anima={anima}
              canOperate={canOperate}
              onOpen={onOpen}
            />
          ))
        )}
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
      </SettingsGroup>
    </div>
  );
}
