import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import type { AnimaName, EnvironmentId } from "@t3tools/contracts";
import {
  LayoutDashboardIcon,
  LibraryBigIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TentTreeIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { isElectron } from "~/env";
import { animaEnvironment, useAnimaList } from "../../state/anima";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { AnimaDetailView } from "./AnimaDetailView";
import { AnimaLibrary } from "./AnimaLibrary";
import { AnimaDashboard } from "./AnimaDashboard";
import { animaOrder } from "./animaDashboard.logic";
import { ANIMA_SEARCH_INPUT_ID } from "./AnimaPool";
import { AnimaSearchDialog, type AnimaSearchTarget } from "./AnimaSearchPalette";
import { useStableCallback } from "../../hooks/useStableCallback";
import { NewAnimaDialog } from "./NewAnimaDialog";
import type { AnimaHomeView, AnimaTab } from "./anima.logic";
import { AnimaWorld } from "./world/AnimaWorld";

const VIEWS: ReadonlyArray<{
  readonly value: AnimaHomeView;
  readonly label: string;
  readonly icon: typeof UsersIcon;
}> = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { value: "world", label: "World", icon: TentTreeIcon },
  { value: "library", label: "Library", icon: LibraryBigIcon },
];

export function AnimaPage(target: {
  readonly environmentId?: EnvironmentId;
  readonly anima?: string;
  readonly tab?: AnimaTab;
  readonly view?: "world" | "library";
  readonly entry?: string;
  readonly breath?: number;
}) {
  const navigate = useNavigate();
  const [searching, setSearching] = useState(false);
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [creating, setCreating] = useState(false);
  const selected =
    environments.find((entry) => entry.environmentId === target.environmentId) ??
    environments.find((entry) => entry.environmentId === primaryEnvironmentId) ??
    environments[0] ??
    null;
  const environmentId = selected?.environmentId ?? null;
  const canCreate = useAtomValue(animaEnvironment.create.permissionAtom(environmentId));
  const { animas, cliAvailable } = useAnimaList(environmentId);
  const createDisabledReason = !canCreate
    ? "You do not have permission to create animas on this environment."
    : !cliAvailable
      ? "The anima CLI is not installed on this environment."
      : null;
  const view: AnimaHomeView = target.view ?? "dashboard";
  const scope = target.environmentId ? { environmentId: target.environmentId } : {};

  const open = (anima: string | undefined, tab?: AnimaTab) =>
    void navigate({
      to: "/anima",
      search: {
        ...scope,
        ...(anima ? { anima } : view === "dashboard" ? {} : { view }),
        ...(tab && tab !== "overview" ? { tab } : {}),
      },
    });
  const showView = (next: AnimaHomeView, entry?: string) =>
    void navigate({
      to: "/anima",
      search: {
        ...scope,
        ...(next === "dashboard" ? {} : { view: next }),
        ...(next === "library" && entry ? { entry } : {}),
      },
    });
  const pick = (result: AnimaSearchTarget) => {
    if ("library" in result) {
      showView("library", result.library);
      return;
    }
    void navigate({
      to: "/anima",
      search: {
        ...scope,
        anima: result.anima,
        ...(result.tab ? { tab: result.tab } : {}),
        ...(result.breath !== undefined ? { breath: result.breath } : {}),
      },
    });
  };
  const selectEnvironment = (next: EnvironmentId) =>
    void navigate({
      to: "/anima",
      search: { environmentId: next, ...(target.view ? { view: target.view } : {}) },
    });

  const onKey = useStableCallback((event: KeyboardEvent) => {
    const element = event.target as HTMLElement | null;
    if (event.metaKey || event.ctrlKey || event.altKey || creating) return;
    if (element?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
    const order = animaOrder(animas);
    const at = order.findIndex((entry) => entry.name === target.anima);
    if (event.key === "/") {
      event.preventDefault();
      const box = document.getElementById(ANIMA_SEARCH_INPUT_ID);
      if (box) box.focus();
      else setSearching(true);
    } else if (event.key === "Escape" && target.anima) {
      open(undefined);
    } else if (event.key === "j" && order.length > 0) {
      open(order[at < 0 ? 0 : (at + 1) % order.length]!.name, target.tab);
    } else if (event.key === "k" && target.anima && order.length > 0) {
      open(order[(at - 1 + order.length) % order.length]!.name, target.tab);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for page shortcuts on the window, an external event source
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const newAnimaButton = (
    <Tooltip>
      <TooltipTrigger
        render={
          <span>
            <Button
              size="sm"
              disabled={environmentId === null || createDisabledReason !== null}
              onClick={() => setCreating(true)}
            >
              <PlusIcon />
              New anima
            </Button>
          </span>
        }
      />
      {createDisabledReason ? <TooltipPopup>{createDisabledReason}</TooltipPopup> : null}
    </Tooltip>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <WorkspacePageHeader
          electron={isElectron}
          className="relative border-b border-border/60 bg-background"
        >
          <WorkspaceBreadcrumb ariaLabel="Anima breadcrumb">
            <WorkspaceBreadcrumbItem current={!target.anima}>
              {target.anima ? (
                <button
                  type="button"
                  className="truncate hover:text-foreground"
                  onClick={() => open(undefined)}
                >
                  Animas
                </button>
              ) : (
                <h1 className="flex items-center gap-1.5 truncate">
                  <SparklesIcon className="size-3.5 text-muted-foreground" />
                  Animas
                </h1>
              )}
            </WorkspaceBreadcrumbItem>
            {target.anima ? (
              <>
                <WorkspaceBreadcrumbSeparator />
                <WorkspaceBreadcrumbItem current>
                  <h1 className="truncate">{target.anima}</h1>
                </WorkspaceBreadcrumbItem>
              </>
            ) : null}
          </WorkspaceBreadcrumb>
          <div className="min-w-0 flex-1" />
          {target.anima || view !== "dashboard" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Search animas"
                    onClick={() => setSearching(true)}
                  />
                }
              >
                <SearchIcon />
              </TooltipTrigger>
              <TooltipPopup>
                Search animas <Kbd>/</Kbd>
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {target.anima ? null : (
            <ToggleGroup
              aria-label="Anima view"
              value={[view]}
              onValueChange={(next) => {
                const value = next[0] as AnimaHomeView | undefined;
                if (value) showView(value);
              }}
            >
              {VIEWS.map(({ value, label, icon: Icon }) => (
                <Toggle key={value} value={value} aria-label={label}>
                  <Icon />
                  <span className="hidden sm:inline">{label}</span>
                </Toggle>
              ))}
            </ToggleGroup>
          )}
          {environments.length > 1 && selected ? (
            <div className="hidden w-44 md:block">
              <Select
                value={selected.environmentId}
                onValueChange={(next) => next && selectEnvironment(next as EnvironmentId)}
              >
                <SelectTrigger size="sm" aria-label="Environment">
                  <SelectValue>{selected.label}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {environments.map((entry) => (
                    <SelectItem
                      key={entry.environmentId}
                      value={entry.environmentId}
                      label={entry.label}
                    >
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
          ) : null}
          {newAnimaButton}
        </WorkspacePageHeader>

        {environmentId === null ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <UsersIcon />
              </EmptyMedia>
              <EmptyTitle>No environments available</EmptyTitle>
              <EmptyDescription>Connect an environment to meet its animas.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : target.anima ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AnimaDetailView
              key={`${environmentId}:${target.anima}`}
              environmentId={environmentId}
              name={target.anima as AnimaName}
              tab={target.tab ?? "overview"}
              breath={target.breath}
              onTab={(tab) => open(target.anima, tab)}
              onOpenAnima={(name) => open(name)}
            />
          </div>
        ) : view === "world" ? (
          <AnimaWorld animas={animas} onOpen={(name) => open(name)} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <WorkspacePageContainer width="expanded">
              {view === "library" ? (
                <AnimaLibrary
                  environmentId={environmentId}
                  entry={target.entry}
                  onEntry={(entry) => showView("library", entry)}
                />
              ) : (
                <AnimaDashboard
                  environmentId={environmentId}
                  animas={animas}
                  onOpen={(name, tab) => open(name, tab)}
                  onCreate={() => setCreating(true)}
                  onSearchPick={pick}
                  createDisabledReason={createDisabledReason}
                />
              )}
            </WorkspacePageContainer>
          </div>
        )}
      </div>
      {searching ? (
        <AnimaSearchDialog
          open
          onOpenChange={setSearching}
          environmentId={environmentId}
          animas={animas}
          onPick={pick}
        />
      ) : null}
      {creating && environmentId ? (
        <NewAnimaDialog
          environmentId={environmentId}
          onClose={() => setCreating(false)}
          onCreated={(name) => open(name)}
        />
      ) : null}
    </SidebarInset>
  );
}
