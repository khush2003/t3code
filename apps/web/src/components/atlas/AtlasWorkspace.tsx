import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId, ProjectId } from "@t3tools/contracts";
import { LayersIcon, ListIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { atlasEnvironment } from "../../state/atlas";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { AtlasAgentControlPane } from "./AtlasAgentControlPane";
import { AtlasInitiativeDialog } from "./AtlasInitiativeDialog";
import { AtlasPlannerPanel } from "./AtlasPlannerPanel";
import { AtlasTaskCard } from "./AtlasTaskCard";
import {
  ATLAS_BOARD_COLUMNS,
  initiativeHasActiveWork,
  initiativeStatusLabel,
  taskCounts,
} from "./atlasLogic";

const ACTIVE_WORK_POLL_MS = 4_000;

function AtlasInitiativeDetail({
  environmentId,
  initiative,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
}) {
  const [view, setView] = useState<"board" | "list">("board");
  const counts = taskCounts(initiative.tasks);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="order-2 min-w-0 space-y-4 2xl:order-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-semibold text-lg">{initiative.title}</h2>
            <p className="text-muted-foreground text-sm">
              {counts.approved}/{counts.total} approved · {counts.running} running · {counts.ready}{" "}
              ready
            </p>
          </div>
          <ToggleGroup
            value={[view]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "board" || next === "list") setView(next);
            }}
          >
            <ToggleGroupItem value="board">
              <LayersIcon />
              Board
            </ToggleGroupItem>
            <ToggleGroupItem value="list">
              <ListIcon />
              List
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {initiative.brief ? (
          <p className="whitespace-pre-wrap text-sm">{initiative.brief}</p>
        ) : null}
        {initiative.deliverables.length > 0 ? (
          <div className="space-y-1">
            <p className="font-medium text-xs uppercase text-muted-foreground">Deliverables</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {initiative.deliverables.map((deliverable) => (
                <li key={deliverable}>{deliverable}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <AtlasPlannerPanel
          environmentId={environmentId}
          initiative={initiative}
          taskCount={initiative.tasks.length}
        />

        {initiative.tasks.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No tasks yet. Run the planning agent, then import its plan.
          </p>
        ) : view === "board" ? (
          <div className="grid grid-cols-1 gap-3">
            {ATLAS_BOARD_COLUMNS.map((column) => {
              const tasks = initiative.tasks.filter((task) => task.status === column.status);
              if (tasks.length === 0) return null;
              return (
                <div key={column.status} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs uppercase text-muted-foreground">
                      {column.label}
                    </span>
                    <Badge variant="secondary">{tasks.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <AtlasTaskCard
                        key={task.id}
                        environmentId={environmentId}
                        initiative={initiative}
                        task={task}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">
            {initiative.tasks.map((task) => (
              <AtlasTaskCard
                key={task.id}
                environmentId={environmentId}
                initiative={initiative}
                task={task}
              />
            ))}
          </div>
        )}
      </div>

      <div className="order-1 min-w-0 space-y-4 2xl:order-2">
        <AtlasAgentControlPane environmentId={environmentId} initiative={initiative} />
      </div>
    </div>
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

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="relative flex min-h-0 flex-1 flex-col">
        <WorkspacePageHeader>
          <span className="font-medium">Atlas</span>
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={activeEnvironmentId}
              onValueChange={(next) => {
                if (next !== null) setEnvironmentId(next as EnvironmentId);
              }}
            >
              <SelectTrigger size="sm" aria-label="Environment">
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
              <SelectTrigger size="sm" aria-label="Project">
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
            <Button
              size="sm"
              disabled={activeEnvironmentId === null || activeProjectId === null}
              onClick={() => {
                setEditingInitiative(null);
                setDialogOpen(true);
              }}
            >
              <PlusIcon />
              New initiative
            </Button>
          </div>
        </WorkspacePageHeader>

        <div className="topbar-scroll-fade min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="expanded">
            {activeEnvironmentId === null || activeProjectId === null ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>No project selected</EmptyTitle>
                  <EmptyDescription>
                    Connect an environment and choose a project to start an Atlas initiative.
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
                  <EmptyTitle>No initiatives yet</EmptyTitle>
                  <EmptyDescription>
                    Create an initiative with a brief and deliverables, then plan it into tasks.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                <aside className="space-y-2">
                  {initiatives.map((initiative) => {
                    const isSelected = initiative.id === selectedInitiativeId;
                    return (
                      <div
                        key={initiative.id}
                        className={`flex items-start gap-1 rounded-lg border p-3 ${
                          isSelected ? "border-primary bg-accent/40" : "bg-card"
                        }`}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setSelectedInitiativeId(initiative.id)}
                        >
                          <p className="truncate font-medium text-sm">{initiative.title}</p>
                          <p className="text-muted-foreground text-xs">
                            {initiativeStatusLabel(initiative)} · {initiative.tasks.length} task
                            {initiative.tasks.length === 1 ? "" : "s"}
                          </p>
                        </button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Delete initiative"
                          disabled={!canDelete}
                          onClick={() => void runDelete(initiative)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingInitiative(null);
                      setDialogOpen(true);
                    }}
                  >
                    <PlusIcon />
                    New initiative
                  </Button>
                </aside>

                <div className="min-w-0">
                  {selectedInitiative ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingInitiative(selectedInitiative);
                            setDialogOpen(true);
                          }}
                        >
                          Edit brief
                        </Button>
                      </div>
                      <AtlasInitiativeDetail
                        environmentId={activeEnvironmentId}
                        initiative={selectedInitiative}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </WorkspacePageContainer>
        </div>

        {activeEnvironmentId !== null && activeProjectId !== null ? (
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
