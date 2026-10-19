import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId } from "@t3tools/contracts";
import { BotIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { atlasEnvironment } from "../../state/atlas";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { AtlasRunOptionsDialog } from "./AtlasRunOptionsDialog";
import { parseAtlasPlanJson, type AtlasBadgeVariant } from "./atlasLogic";

function plannerBadge(status: AtlasInitiative["planner"]["status"]): {
  readonly variant: AtlasBadgeVariant;
  readonly label: string;
} {
  switch (status) {
    case "idle":
      return { variant: "secondary", label: "Not planned" };
    case "running":
      return { variant: "info", label: "Planning" };
    case "completed":
      return { variant: "success", label: "Plan ready" };
    case "failed":
      return { variant: "error", label: "Planning failed" };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The request failed.";
}

export function AtlasPlannerPanel({
  environmentId,
  initiative,
  taskCount,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly taskCount: number;
}) {
  const startPlanning = useAtomCommand(atlasEnvironment.startPlanning, { reportFailure: false });
  const importPlan = useAtomCommand(atlasEnvironment.importPlan, { reportFailure: false });
  const refreshInitiative = useAtomCommand(atlasEnvironment.refreshInitiative, {
    reportFailure: false,
  });
  const canRefresh = useAtomValue(atlasEnvironment.refreshInitiative.permissionAtom(environmentId));
  const canPlan = useAtomValue(atlasEnvironment.startPlanning.permissionAtom(environmentId));
  const canImport = useAtomValue(atlasEnvironment.importPlan.permissionAtom(environmentId));
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [pastedPlan, setPastedPlan] = useState("");
  const [busy, setBusy] = useState(false);

  const planner = initiative.planner;
  const badge = plannerBadge(planner.status);
  const parsed = pastedPlan.trim().length > 0 ? parseAtlasPlanJson(pastedPlan) : null;
  const canImportNow = parsed !== null ? parsed.ok : planner.status === "completed";

  const reportFailure = (title: string, error: unknown) => {
    toastManager.add(
      stackedThreadToast({ type: "error", title, description: errorMessage(error) }),
    );
  };

  const runRefresh = async () => {
    setBusy(true);
    const result = await refreshInitiative({
      environmentId,
      input: { initiativeId: initiative.id },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not refresh initiative", squashAtomCommandFailure(result));
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <BotIcon className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">Planning agent</span>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !canRefresh}
            onClick={() => void runRefresh()}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canImport}
            onClick={() => {
              setPastedPlan("");
              setImportDialogOpen(true);
            }}
          >
            Import plan
          </Button>
          <Button
            size="sm"
            disabled={!canPlan || planner.status === "running"}
            onClick={() => setPlanDialogOpen(true)}
          >
            <SparklesIcon />
            {planner.status === "idle" ? "Plan" : "Re-plan"}
          </Button>
        </div>
      </div>
      {planner.error ? <p className="mt-3 text-destructive text-sm">{planner.error}</p> : null}
      {initiative.planSummary ? (
        <p className="mt-3 text-muted-foreground text-sm">{initiative.planSummary}</p>
      ) : (
        <p className="mt-3 text-muted-foreground text-sm">
          {planner.status === "idle"
            ? "No plan yet. Run the planning agent to turn the brief into tasks."
            : `${taskCount} task${taskCount === 1 ? "" : "s"} in the current plan.`}
        </p>
      )}
      {planner.threadId ? (
        <Button
          size="sm"
          variant="link"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: planner.threadId }}
            />
          }
        >
          Open planning thread
        </Button>
      ) : null}

      <AtlasRunOptionsDialog
        open={planDialogOpen}
        onOpenChange={setPlanDialogOpen}
        environmentId={environmentId}
        projectId={initiative.projectId}
        title={planner.status === "idle" ? "Plan initiative" : "Re-plan initiative"}
        description="A planning agent reads the brief and deliverables and proposes a task breakdown."
        confirmLabel={planner.status === "idle" ? "Start planning" : "Re-plan"}
        onConfirm={async (options) => {
          setPlanDialogOpen(false);
          const result = await startPlanning({
            environmentId,
            input: {
              initiativeId: initiative.id,
              modelSelection: options.modelSelection!,
              runtimeMode: options.runtimeMode,
              interactionMode: options.interactionMode,
            },
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            reportFailure("Could not start planning", squashAtomCommandFailure(result));
          }
        }}
      />

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Import plan</DialogTitle>
            <DialogDescription>
              Import the planner&apos;s output, or paste a plan object to replace the tasks.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Textarea
              value={pastedPlan}
              placeholder='{"summary": "…", "tasks": [{"key": "…", "title": "…", "description": "…", "specialty": "…", "acceptanceCriteria": ["…"], "dependsOn": []}]}'
              onChange={(event) => setPastedPlan(event.target.value)}
            />
            {parsed && !parsed.ok ? (
              <p className="text-destructive text-sm">{parsed.error}</p>
            ) : parsed?.ok ? (
              <p className="text-muted-foreground text-sm">
                {parsed.plan.tasks.length} task{parsed.plan.tasks.length === 1 ? "" : "s"} ready to
                import.
              </p>
            ) : null}
            {!canImportNow ? (
              <p className="text-muted-foreground text-sm">
                The planner has not finished. Wait for it, or paste a plan to import instead.
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button
              disabled={!canImportNow}
              onClick={async () => {
                const plan = parsed?.ok ? parsed.plan : null;
                setImportDialogOpen(false);
                const result = await importPlan({
                  environmentId,
                  input: plan
                    ? { initiativeId: initiative.id, plan }
                    : { initiativeId: initiative.id },
                });
                if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
                  reportFailure("Could not import plan", squashAtomCommandFailure(result));
                }
              }}
            >
              Import plan
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
