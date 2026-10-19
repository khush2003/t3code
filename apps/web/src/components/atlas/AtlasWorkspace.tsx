import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { atlasEnvironment } from "../../state/atlas";
import { cn } from "../../lib/utils";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { AtlasAgentControlPane } from "./AtlasAgentControlPane";
import { AtlasInitiativeDialog } from "./AtlasInitiativeDialog";
import { AtlasPlannerPanel } from "./AtlasPlannerPanel";
import { AtlasAutoReviewDialog } from "./AtlasAutoReviewDialog";
import { AtlasPlanAdjustmentDialog, type AtlasAdjustmentSource } from "./AtlasPlanAdjustmentDialog";
import { AtlasProgressStrip } from "./AtlasProgress";
import { AtlasTaskList } from "./AtlasTaskList";
import { initiativeHasActiveWork, initiativeStatusLabel, taskCounts } from "./atlasLogic";

const ACTIVE_WORK_POLL_MS = 4_000;

function AtlasInitiativeDetail({
  environmentId,
  initiative,
  canDelete,
  onEdit,
  onDelete,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly canDelete: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const [adjustSource, setAdjustSource] = useState<AtlasAdjustmentSource | null>(null);
  const [autoReviewOpen, setAutoReviewOpen] = useState(false);
  const counts = taskCounts(initiative.tasks);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 pt-6 pb-16 sm:px-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant="outline">{initiativeStatusLabel(initiative)}</Badge>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <PencilIcon />
              Edit brief
            </Button>
            <Button
              size="icon-sm"
              variant="ghost-destructive"
              aria-label="Delete initiative"
              disabled={!canDelete}
              onClick={onDelete}
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>
        <h1 className="text-balance font-semibold text-2xl tracking-tight">{initiative.title}</h1>
        {initiative.brief ? (
          <p className="max-w-[68ch] whitespace-pre-wrap text-muted-foreground text-sm leading-relaxed">
            {initiative.brief}
          </p>
        ) : null}
        {initiative.deliverables.length > 0 ? (
          <div className="space-y-2">
            <h2 className="font-medium text-sm">Deliverables</h2>
            <ul className="max-w-[68ch] space-y-1.5 text-sm">
              {initiative.deliverables.map((deliverable) => (
                <li key={deliverable} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50"
                  />
                  <span>{deliverable}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {counts.total > 0 ? (
          <div className="space-y-2 pt-2">
            <p className="text-sm">
              <span className="font-semibold tabular-nums">{counts.approved}</span>
              <span className="text-muted-foreground"> of {counts.total} tasks approved</span>
              {counts.running > 0 ? (
                <span className="text-muted-foreground">, {counts.running} running</span>
              ) : null}
              {counts.ready > 0 ? (
                <span className="text-muted-foreground">, {counts.ready} ready to run</span>
              ) : null}
            </p>
            <AtlasProgressStrip tasks={initiative.tasks} legend />
          </div>
        ) : null}
      </header>

      <AtlasPlannerPanel
        environmentId={environmentId}
        initiative={initiative}
        taskCount={initiative.tasks.length}
        onAdjust={setAdjustSource}
      />

      {initiative.tasks.length === 0 ? null : (
        <AtlasTaskList
          environmentId={environmentId}
          initiative={initiative}
          onAdjust={(taskId) => setAdjustSource({ kind: "manual", focusTaskId: taskId })}
          onConfigureAutoReview={() => setAutoReviewOpen(true)}
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

function AtlasInitiativeRail({
  initiatives,
  activeInitiativeId,
  onSelect,
  onCreate,
}: {
  readonly initiatives: ReadonlyArray<AtlasInitiative>;
  readonly activeInitiativeId: string | null;
  readonly onSelect: (initiativeId: string) => void;
  readonly onCreate: () => void;
}) {
  return (
    <nav aria-label="Initiatives" className="flex flex-col gap-1 p-3">
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <h2 className="font-medium text-muted-foreground text-xs">Initiatives</h2>
        <Button size="icon-xs" variant="ghost" aria-label="New initiative" onClick={onCreate}>
          <PlusIcon />
        </Button>
      </div>
      {initiatives.map((initiative) => {
        const counts = taskCounts(initiative.tasks);
        const selected = initiative.id === activeInitiativeId;
        return (
          <button
            key={initiative.id}
            type="button"
            aria-current={selected ? "page" : undefined}
            onClick={() => onSelect(initiative.id)}
            className={cn(
              "flex w-full min-w-0 flex-col gap-2 rounded-lg px-2.5 py-2 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              selected && "bg-accent hover:bg-accent",
            )}
          >
            <span className="truncate font-medium text-sm">{initiative.title}</span>
            <span className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
              <span>{initiativeStatusLabel(initiative)}</span>
              {counts.total > 0 ? (
                <span className="tabular-nums">
                  {counts.approved}/{counts.total}
                </span>
              ) : null}
            </span>
            {counts.total > 0 ? <AtlasProgressStrip tasks={initiative.tasks} size="sm" /> : null}
          </button>
        );
      })}
    </nav>
  );
}

export function AtlasWorkspace() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [environmentId, setEnvironmentId] = useState<EnvironmentId | null>(null);
  const [projectId, setProjectId] = useState<ProjectId | null>(null);
  const [selectedInitiativeId, setSelectedInitiativeId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingInitiative, setEditingInitiative] = useState<AtlasInitiative | null>(null);

  const deleteInitiative = useAtomCommand(atlasEnvironment.deleteInitiative, {
    reportFailure: false,
  });
  // Selection defaults are derived during render rather than written back
  // through effects; the explicit state only records a user's choice.
  const activeEnvironmentId =
    environmentId ?? primaryEnvironmentId ?? environments[0]?.environmentId ?? null;
  const canDelete = useAtomValue(
    atlasEnvironment.deleteInitiative.permissionAtom(activeEnvironmentId ?? ("" as EnvironmentId)),
  );
  const environmentProjects =
    activeEnvironmentId === null
      ? []
      : projects.filter(
          (project) => project.environmentId === activeEnvironmentId && project.isScratch !== true,
        );
  const activeProjectId =
    projectId !== null && environmentProjects.some((project) => project.id === projectId)
      ? projectId
      : (environmentProjects[0]?.id ?? null);

  const listAtom =
    activeEnvironmentId !== null && activeProjectId !== null
      ? atlasEnvironment.listInitiatives({
          environmentId: activeEnvironmentId,
          input: { projectId: activeProjectId },
        })
      : null;
  const query = useEnvironmentQuery(listAtom);
  const initiatives = query.data?.initiatives ?? [];
  const activeInitiativeId =
    selectedInitiativeId !== null &&
    initiatives.some((initiative) => initiative.id === selectedInitiativeId)
      ? selectedInitiativeId
      : (initiatives[0]?.id ?? null);
  const selectedInitiative =
    initiatives.find((initiative) => initiative.id === activeInitiativeId) ?? null;

  const activeWork = selectedInitiative !== null && initiativeHasActiveWork(selectedInitiative);
  const refresh = query.refresh;
  useEffect(() => {
    if (!activeWork) return;
    const timer = setInterval(refresh, ACTIVE_WORK_POLL_MS);
    return () => clearInterval(timer);
  }, [activeWork, refresh]);

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
    setSelectedInitiativeId(null);
  };

  const openCreate = () => {
    setEditingInitiative(null);
    setDialogOpen(true);
  };
  const ready = activeEnvironmentId !== null && activeProjectId !== null;

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b">
          <span className="shrink-0 font-medium">Atlas</span>
          <div className="ml-auto flex min-w-0 items-center gap-2 max-sm:flex-1">
            <Select
              value={activeEnvironmentId}
              onValueChange={(next) => {
                if (next !== null) setEnvironmentId(next as EnvironmentId);
              }}
            >
              <SelectTrigger size="sm" aria-label="Environment" className="max-sm:min-w-0">
                <SelectValue>
                  {environments.find(
                    (environment) => environment.environmentId === activeEnvironmentId,
                  )?.label ?? "Environment"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {environments.map((environment) => (
                  <SelectItem key={environment.environmentId} value={environment.environmentId}>
                    {environment.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Select
              value={activeProjectId}
              onValueChange={(next) => {
                if (next !== null) setProjectId(next as ProjectId);
              }}
            >
              <SelectTrigger size="sm" aria-label="Project" className="max-sm:min-w-0">
                <SelectValue>
                  {environmentProjects.find((project) => project.id === activeProjectId)?.title ??
                    "Project"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {environmentProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button size="sm" disabled={!ready} onClick={openCreate}>
              <PlusIcon />
              <span className="max-sm:sr-only">New initiative</span>
            </Button>
          </div>
        </WorkspacePageHeader>

        {!ready ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Choose a project</EmptyTitle>
              <EmptyDescription>
                Connect an environment and pick a project to plan work with Atlas.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : query.error ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Could not load initiatives</EmptyTitle>
              <EmptyDescription>{query.error}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : initiatives.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Start an initiative</EmptyTitle>
              <EmptyDescription>
                Describe what you want built. A planning agent breaks it into tasks, other agents
                run them in parallel, and you review the results.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={openCreate}>
                <PlusIcon />
                New initiative
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          // Below xl the whole page scrolls; at xl each pane scrolls on its own so
          // agent requests stay in view while the board moves.
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[15rem_minmax(0,1fr)] lg:[grid-template-areas:'rail_control'_'rail_main'] xl:grid-cols-[15rem_minmax(0,1fr)_22rem] xl:grid-rows-[minmax(0,1fr)] xl:overflow-hidden xl:[grid-template-areas:'rail_main_control']">
            <aside className="min-w-0 border-b lg:row-span-2 lg:border-r lg:border-b-0 lg:[grid-area:rail] xl:overflow-y-auto">
              <AtlasInitiativeRail
                initiatives={initiatives}
                activeInitiativeId={activeInitiativeId}
                onSelect={setSelectedInitiativeId}
                onCreate={openCreate}
              />
            </aside>
            {selectedInitiative ? (
              <>
                <aside className="min-w-0 border-b lg:[grid-area:control] xl:overflow-y-auto xl:border-b-0 xl:border-l">
                  <AtlasAgentControlPane
                    environmentId={activeEnvironmentId}
                    initiative={selectedInitiative}
                  />
                </aside>
                <section
                  aria-label="Initiative details"
                  className="min-w-0 lg:[grid-area:main] xl:overflow-y-auto"
                >
                  <AtlasInitiativeDetail
                    environmentId={activeEnvironmentId}
                    initiative={selectedInitiative}
                    canDelete={canDelete}
                    onEdit={() => {
                      setEditingInitiative(selectedInitiative);
                      setDialogOpen(true);
                    }}
                    onDelete={() => void runDelete(selectedInitiative)}
                  />
                </section>
              </>
            ) : null}
          </div>
        )}

        {ready ? (
          <AtlasInitiativeDialog
            key={editingInitiative?.id ?? "new"}
            environmentId={activeEnvironmentId}
            projectId={activeProjectId}
            open={dialogOpen}
            initiative={editingInitiative}
            onOpenChange={setDialogOpen}
            onSaved={(initiativeId) => setSelectedInitiativeId(initiativeId)}
          />
        ) : null}
      </div>
    </SidebarInset>
  );
}
