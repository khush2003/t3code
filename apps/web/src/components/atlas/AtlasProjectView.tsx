import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { AtlasInitiative, EnvironmentId } from "@t3tools/contracts";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { AtlasInitiativeCard } from "./AtlasInitiativeCard";
import {
  filterInitiatives,
  initiativeMatchesFilter,
  type AtlasInitiativeFilter,
  type AtlasProjectSummary,
} from "./atlasDashboardLogic";

const FILTERS: ReadonlyArray<{ readonly value: AtlasInitiativeFilter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Drafts" },
  { value: "completed", label: "Completed" },
];

function isFilter(value: unknown): value is AtlasInitiativeFilter {
  return FILTERS.some((filter) => filter.value === value);
}

export function AtlasProjectView({
  environmentId,
  project,
  summary,
  onCreate,
}: {
  readonly environmentId: EnvironmentId;
  readonly project: EnvironmentProject;
  readonly summary: AtlasProjectSummary;
  readonly onCreate: () => void;
}) {
  const initiatives: ReadonlyArray<AtlasInitiative> = summary.initiatives;
  const [filter, setFilter] = useState<AtlasInitiativeFilter>("all");
  const [query, setQuery] = useState("");
  const visible = filterInitiatives(initiatives, filter, query);
  const stats = [
    `${initiatives.length} initiative${initiatives.length === 1 ? "" : "s"}`,
    ...(summary.total > 0 ? [`${summary.approved} of ${summary.total} tasks approved`] : []),
    ...(summary.running > 0
      ? [`${summary.running} agent${summary.running === 1 ? "" : "s"} running`]
      : []),
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 pt-8 pb-16 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <ProjectFavicon project={project} className="size-10 shrink-0" />
          <div className="min-w-0 space-y-1">
            <h1 className="truncate font-semibold text-2xl tracking-tight">{project.title}</h1>
            <p className="truncate font-mono text-muted-foreground text-xs">
              {project.workspaceRoot}
            </p>
          </div>
        </div>
        <Button onClick={onCreate}>
          <PlusIcon />
          New initiative
        </Button>
      </header>

      {initiatives.length === 0 ? (
        <div className="rounded-xl border border-dashed">
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No initiatives in {project.title} yet</EmptyTitle>
              <EmptyDescription>
                Describe what you want built. A planning agent breaks it into tasks, other agents
                run them in parallel, and you review the results.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onCreate}>
                <PlusIcon />
                New initiative
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">{stats.join(" · ")}</p>
            <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full">
              <ToggleGroup
                aria-label="Filter initiatives"
                variant="segmented"
                size="compact"
                value={[filter]}
                onValueChange={(next) => {
                  const value = next[0];
                  if (isFilter(value)) setFilter(value);
                }}
              >
                {FILTERS.map((entry) => {
                  const count = initiatives.filter((initiative) =>
                    initiativeMatchesFilter(initiative, entry.value),
                  ).length;
                  return (
                    <ToggleGroupItem key={entry.value} value={entry.value}>
                      {entry.label}
                      <span className="text-muted-foreground tabular-nums">{count}</span>
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
              <InputGroup className="w-56 max-sm:w-full max-sm:flex-none">
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label="Search initiatives"
                  placeholder="Search initiatives…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </InputGroup>
            </div>
          </div>
          {visible.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-8 text-center">
              <p className="font-medium text-sm">No initiatives match</p>
              <p className="mt-1 text-muted-foreground text-xs">
                Try another filter or clear the search.
              </p>
              <Button
                size="xs"
                variant="ghost"
                className="mt-3"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((initiative) => (
                <li key={initiative.id} className="flex min-w-0">
                  <AtlasInitiativeCard environmentId={environmentId} initiative={initiative} />
                </li>
              ))}
              {filter === "all" && query.trim().length === 0 ? (
                <li className="flex min-w-0">
                  <button
                    type="button"
                    onClick={onCreate}
                    className="flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-muted-foreground text-sm outline-none transition-colors hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <PlusIcon aria-hidden className="size-4" />
                    New initiative
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
