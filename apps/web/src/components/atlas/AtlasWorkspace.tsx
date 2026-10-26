import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, AtlasTaskId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  LayoutGridIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { atlasEnvironment } from "../../state/atlas";
import { cn } from "../../lib/utils";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { AtlasAgentControlPane } from "./AtlasAgentControlPane";
import { atlasWaitingByInitiativeAtom, atlasWaitingKey } from "./atlasAgentDetails";
import {
  collectAttentionItems,
  countRunningAgents,
  orderProjectsByActivity,
  runningAgentThreads,
  summarizeProject,
} from "./atlasDashboardLogic";
import { AtlasInitiativeDialog } from "./AtlasInitiativeDialog";
import { AtlasOverview } from "./AtlasOverview";
import { AtlasPlannerPanel } from "./AtlasPlannerPanel";
import { AtlasAutoReviewDialog } from "./AtlasAutoReviewDialog";
import { AtlasPlanAdjustmentDialog, type AtlasAdjustmentSource } from "./AtlasPlanAdjustmentDialog";
import { AtlasProgressStrip } from "./AtlasProgress";
import { AtlasProjectPicker } from "./AtlasProjectPicker";
import { AtlasProjectView } from "./AtlasProjectView";
import type { AtlasSearch } from "./atlasSearch";
import { AtlasTaskList } from "./AtlasTaskList";
import { initiativeHasActiveWork, initiativeStatusLabel, taskCounts } from "./atlasLogic";
import { formatRelativeTimeLabel } from "../../timestampFormat";

const ACTIVE_WORK_POLL_MS = 4_000;

function AtlasInitiativeDetail({
  environmentId,
  initiative,
  canDelete,
  openTaskId,
  onOpenTask,
  onEdit,
  onDelete,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly canDelete: boolean;
  readonly openTaskId: string | null;
  readonly onOpenTask: (taskId: AtlasTaskId | null) => void;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const [adjustSource, setAdjustSource] = useState<AtlasAdjustmentSource | null>(null);
  const [autoReviewOpen, setAutoReviewOpen] = useState(false);
  const counts = taskCounts(initiative.tasks);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pt-7 pb-16 sm:px-8">
      <header className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            {/* The breadcrumb switcher is hidden on small screens. */}
            <Link
              to="/atlas"
              search={{ environmentId, projectId: initiative.projectId }}
              className="flex w-fit items-center gap-1 rounded-sm text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:hidden"
            >
              <ChevronLeftIcon aria-hidden className="size-3.5" />
              Initiatives
            </Link>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    initiative.status === "completed"
                      ? "bg-success"
                      : initiativeHasActiveWork(initiative)
                        ? "bg-info"
                        : "bg-muted-foreground/40",
                  )}
                />
                {initiativeStatusLabel(initiative)}
              </span>
              <span aria-hidden>·</span>
              <span>Updated {formatRelativeTimeLabel(initiative.updatedAt)}</span>
            </p>
            <h1 className="text-balance font-semibold text-3xl text-atlas-ink leading-tight tracking-tight sm:text-4xl">
              {initiative.title}
            </h1>
            {initiative.brief ? (
              <p className="max-w-[68ch] whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
                {initiative.brief}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <PencilIcon />
              <span className="max-sm:sr-only">Edit brief</span>
            </Button>
            <Menu>
              <MenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label="Initiative actions" />}
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuItem variant="destructive" disabled={!canDelete} onClick={onDelete}>
                  <Trash2Icon />
                  Delete initiative
                </MenuItem>
              </MenuPopup>
            </Menu>
          </div>
        </div>
        {initiative.deliverables.length > 0 ? (
          <ul aria-label="Deliverables" className="flex flex-wrap gap-2">
            {initiative.deliverables.map((deliverable) => (
              <li
                key={deliverable}
                className="flex max-w-full items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs"
              >
                <PackageIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{deliverable}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {counts.total > 0 ? (
          <div className="max-w-3xl space-y-2.5 pt-1">
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-atlas-ink text-2xl tabular-nums tracking-tight">
                {counts.approved}
                <span className="text-muted-foreground">/{counts.total}</span>
              </span>
              <span className="text-muted-foreground text-sm">tasks done</span>
            </p>
            <AtlasProgressStrip tasks={initiative.tasks} size="lg" legend />
          </div>
        ) : null}
      </header>

      {initiative.tasks.length === 0 ? (
        <AtlasPlannerPanel
          environmentId={environmentId}
          initiative={initiative}
          taskCount={0}
          onAdjust={setAdjustSource}
        />
      ) : (
        <AtlasTaskList
          environmentId={environmentId}
          initiative={initiative}
          openTaskId={openTaskId}
          onOpenTask={onOpenTask}
          onAdjust={(taskId) => setAdjustSource({ kind: "manual", focusTaskId: taskId })}
          onConfigureAutoReview={() => setAutoReviewOpen(true)}
        />
      )}

      {initiative.tasks.length === 0 ? null : (
        <AtlasPlannerPanel
          environmentId={environmentId}
          initiative={initiative}
          taskCount={initiative.tasks.length}
          onAdjust={setAdjustSource}
        />
      )}

      {adjustSource ? (
        <AtlasPlanAdjustmentDialog
          environmentId={environmentId}
          initiative={initiative}
          source={adjustSource}
          onClose={() => setAdjustSource(null)}
        />
      ) : null}
      {autoReviewOpen ? (
        <AtlasAutoReviewDialog
          environmentId={environmentId}
          initiative={initiative}
          open
          onOpenChange={setAutoReviewOpen}
        />
      ) : null}
    </div>
  );
}

/** Switches between a project's initiatives from the breadcrumb. */
function AtlasInitiativeSwitcher({
  environmentId,
  projectId,
  initiatives,
  active,
  onCreate,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly initiatives: ReadonlyArray<AtlasInitiative>;
  readonly active: AtlasInitiative;
  readonly onCreate: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="min-w-0 max-w-full"
            aria-label="Switch initiative"
          />
        }
      >
        <span className="truncate">{active.title}</span>
        <ChevronDownIcon className="opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-80">
        {initiatives.map((initiative) => {
          const counts = taskCounts(initiative.tasks);
          return (
            <MenuItem
              key={initiative.id}
              onClick={() =>
                void navigate({
                  to: "/atlas",
                  search: { environmentId, projectId, initiativeId: initiative.id },
                })
              }
            >
              <span className="flex min-w-0 flex-1 flex-col gap-1.5 py-0.5">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{initiative.title}</span>
                  {initiative.id === active.id ? <CheckIcon className="opacity-70" /> : null}
                </span>
                <span className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
                  <span>{initiativeStatusLabel(initiative)}</span>
                  {counts.total > 0 ? (
                    <span className="tabular-nums">
                      {counts.approved}/{counts.total}
                    </span>
                  ) : null}
                </span>
                {counts.total > 0 ? (
                  <AtlasProgressStrip tasks={initiative.tasks} size="sm" />
                ) : null}
              </span>
            </MenuItem>
          );
        })}
        <MenuSeparator />
        <MenuItem
          onClick={() => void navigate({ to: "/atlas", search: { environmentId, projectId } })}
        >
          <LayoutGridIcon />
          All initiatives
        </MenuItem>
        <MenuItem onClick={onCreate}>
          <PlusIcon />
          New initiative
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

function AtlasLoading() {
  return (
    <div
      aria-busy
      aria-label="Loading Atlas"
      className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 pt-8 pb-16 sm:px-8"
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} shape="card" className="h-28" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} shape="card" className="h-36" />
        ))}
      </div>
    </div>
  );
}

type DialogTarget =
  | { readonly kind: "create"; readonly projectId: ProjectId | null }
  | { readonly kind: "edit"; readonly initiative: AtlasInitiative };

export function AtlasWorkspace({ search }: { readonly search: AtlasSearch }) {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<DialogTarget>({
    kind: "create",
    projectId: null,
  });

  const deleteInitiative = useAtomCommand(atlasEnvironment.deleteInitiative, {
    reportFailure: false,
  });
  // Selection lives in the URL so back/forward and shared links land on the
  // same view; defaults are derived here rather than written back.
  const activeEnvironmentId =
    search.environmentId ?? primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const canDelete = useAtomValue(
    atlasEnvironment.deleteInitiative.permissionAtom(activeEnvironmentId ?? ("" as EnvironmentId)),
  );
  const environmentProjects =
    activeEnvironmentId === null
      ? []
      : projects.filter(
          (project) => project.environmentId === activeEnvironmentId && project.isScratch !== true,
        );
  const projectIds = new Set(environmentProjects.map((project) => project.id));

  // One environment-wide read feeds the overview, the project view, and the
  // rail, so moving between them never waits on another fetch.
  const listAtom =
    activeEnvironmentId !== null
      ? atlasEnvironment.listInitiatives({ environmentId: activeEnvironmentId, input: {} })
      : null;
  const query = useEnvironmentQuery(listAtom);
  const initiatives = (query.data?.initiatives ?? []).filter((initiative) =>
    projectIds.has(initiative.projectId),
  );
  const loading = listAtom !== null && query.data === null && query.error === null;

  const summaries = new Map(
    environmentProjects.map((project) => [project.id, summarizeProject(initiatives, project.id)]),
  );
  const orderedProjects = orderProjectsByActivity(environmentProjects, summaries);
  const selectedInitiative =
    search.initiativeId === undefined
      ? null
      : (initiatives.find((initiative) => initiative.id === search.initiativeId) ?? null);
  const activeProjectId =
    selectedInitiative?.projectId ??
    (search.projectId !== undefined && projectIds.has(search.projectId) ? search.projectId : null);
  const activeProject = environmentProjects.find((project) => project.id === activeProjectId);
  const activeSummary = activeProjectId === null ? undefined : summaries.get(activeProjectId);

  const waiting = useAtomValue(
    atlasWaitingByInitiativeAtom(
      atlasWaitingKey(activeEnvironmentId ?? "", runningAgentThreads(initiatives)),
    ),
  );
  const attention = collectAttentionItems(initiatives, waiting);

  const activeWork = initiatives.some(initiativeHasActiveWork);
  const refresh = query.refresh;
  useEffect(() => {
    if (!activeWork) return;
    const timer = setInterval(refresh, ACTIVE_WORK_POLL_MS);
    return () => clearInterval(timer);
  }, [activeWork, refresh]);

  const go = (next: AtlasSearch) => {
    void navigate({ to: "/atlas", search: next });
  };
  const environmentSearch =
    activeEnvironmentId === null ? {} : { environmentId: activeEnvironmentId };

  const runDelete = async (initiative: AtlasInitiative) => {
    if (activeEnvironmentId === null) return;
    const confirmed = await requestConfirmDialog(
      `Delete “${initiative.title}”?\nThis removes its plan, tasks, and links.`,
    );
    if (!confirmed) return;
    const result = await deleteInitiative({
      environmentId: activeEnvironmentId,
      input: { initiativeId: initiative.id },
    });
    if (result._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not delete initiative",
          description: "The request failed.",
        }),
      );
      return;
    }
    go({ ...environmentSearch, projectId: initiative.projectId });
  };

  const openCreate = (projectId: ProjectId | null) => {
    setDialogTarget({ kind: "create", projectId: projectId ?? orderedProjects[0]?.id ?? null });
    setDialogOpen(true);
  };
  const canCreate = activeEnvironmentId !== null && environmentProjects.length > 0;
  const activeEnvironmentLabel =
    environments.find((environment) => environment.environmentId === activeEnvironmentId)?.label ??
    null;

  let content;
  if (activeEnvironmentId === null) {
    content = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Connect an environment</EmptyTitle>
          <EmptyDescription>
            Atlas plans and runs work in a connected environment&apos;s projects.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else if (query.error && query.data === null) {
    content = (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Could not load initiatives</EmptyTitle>
          <EmptyDescription>{query.error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  } else if (loading) {
    content = <AtlasLoading />;
  } else if (selectedInitiative && activeProjectId !== null) {
    content = (
      // Below xl the whole page scrolls; at xl each pane scrolls on its own so
      // agent requests stay in view while the board moves.
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_22rem] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden xl:[grid-template-areas:'main_control']">
        <aside className="order-last min-w-0 border-t bg-atlas-surface/60 xl:order-none xl:overflow-y-auto xl:border-t-0 xl:border-l xl:[grid-area:control]">
          <AtlasAgentControlPane
            key={selectedInitiative.id}
            environmentId={activeEnvironmentId}
            initiative={selectedInitiative}
          />
        </aside>
        <section
          aria-label="Initiative details"
          className="min-w-0 xl:overflow-y-auto xl:[grid-area:main]"
        >
          <AtlasInitiativeDetail
            key={selectedInitiative.id}
            environmentId={activeEnvironmentId}
            initiative={selectedInitiative}
            canDelete={canDelete}
            openTaskId={search.taskId ?? null}
            onOpenTask={(taskId) =>
              go({
                ...environmentSearch,
                projectId: selectedInitiative.projectId,
                initiativeId: selectedInitiative.id,
                ...(taskId === null ? {} : { taskId }),
              })
            }
            onEdit={() => {
              setDialogTarget({ kind: "edit", initiative: selectedInitiative });
              setDialogOpen(true);
            }}
            onDelete={() => void runDelete(selectedInitiative)}
          />
        </section>
      </div>
    );
  } else if (activeProject && activeSummary) {
    content = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AtlasProjectView
          key={activeProject.id}
          environmentId={activeEnvironmentId}
          project={activeProject}
          summary={activeSummary}
          onCreate={() => openCreate(activeProject.id)}
        />
      </div>
    );
  } else {
    content = (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AtlasOverview
          environmentId={activeEnvironmentId}
          environmentLabel={environments.length > 1 ? activeEnvironmentLabel : null}
          projects={orderedProjects}
          summaries={summaries}
          initiatives={initiatives}
          attention={attention}
          runningAgents={countRunningAgents(initiatives)}
          onStart={openCreate}
        />
      </div>
    );
  }

  return (
    <SidebarInset data-atlas className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1 flex-col bg-atlas-canvas text-atlas-ink">
        <WorkspacePageHeader className="border-b">
          <Link
            to="/atlas"
            search={environmentSearch}
            className="shrink-0 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            Atlas
          </Link>
          {activeEnvironmentId !== null ? (
            <>
              <ChevronRightIcon
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground/60"
              />
              <div className="min-w-0 max-w-64 flex-1 sm:flex-initial">
                <AtlasProjectPicker
                  projects={orderedProjects}
                  summaries={summaries}
                  activeProjectId={activeProjectId}
                  onSelect={(projectId) =>
                    go(projectId === null ? environmentSearch : { ...environmentSearch, projectId })
                  }
                />
              </div>
            </>
          ) : null}
          {selectedInitiative && activeEnvironmentId !== null && activeProjectId !== null ? (
            <>
              <ChevronRightIcon
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground/60 max-md:hidden"
              />
              <div className="min-w-0 max-w-80 max-md:hidden">
                <AtlasInitiativeSwitcher
                  environmentId={activeEnvironmentId}
                  projectId={activeProjectId}
                  initiatives={activeSummary?.initiatives ?? [selectedInitiative]}
                  active={selectedInitiative}
                  onCreate={() => openCreate(activeProjectId)}
                />
              </div>
            </>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {environments.length > 1 ? (
              <Select
                value={activeEnvironmentId}
                onValueChange={(next) => {
                  if (next !== null) go({ environmentId: next as EnvironmentId });
                }}
              >
                <SelectTrigger size="sm" aria-label="Environment">
                  <SelectValue>{activeEnvironmentLabel ?? "Environment"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {environments.map((environment) => (
                    <SelectItem key={environment.environmentId} value={environment.environmentId}>
                      {environment.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
            <Button size="sm" disabled={!canCreate} onClick={() => openCreate(activeProjectId)}>
              <PlusIcon />
              <span className="max-sm:sr-only">New initiative</span>
            </Button>
          </div>
        </WorkspacePageHeader>

        {content}

        {activeEnvironmentId !== null && canCreate && dialogOpen ? (
          <AtlasInitiativeDialog
            key={
              dialogTarget.kind === "edit"
                ? dialogTarget.initiative.id
                : `new:${dialogTarget.projectId ?? ""}`
            }
            environmentId={activeEnvironmentId}
            defaultProjectId={
              dialogTarget.kind === "edit"
                ? dialogTarget.initiative.projectId
                : dialogTarget.projectId
            }
            projects={orderedProjects}
            open={dialogOpen}
            initiative={dialogTarget.kind === "edit" ? dialogTarget.initiative : null}
            onOpenChange={setDialogOpen}
            onSaved={(initiative) =>
              go({
                ...environmentSearch,
                projectId: initiative.projectId,
                initiativeId: initiative.id,
              })
            }
          />
        ) : null}
      </div>
    </SidebarInset>
  );
}
