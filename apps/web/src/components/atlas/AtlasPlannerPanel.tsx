import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId } from "@t3tools/contracts";
import { BotIcon, DownloadIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
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

  const summary =
    initiative.planSummary ??
    (planner.status === "idle"
      ? "A planning agent reads the brief and deliverables, then proposes tasks you can import, edit, and run."
      : planner.status === "running"
        ? "The planning agent is reading the brief. Answer its questions in the agent panel if it asks."
        : planner.status === "completed" && taskCount === 0
          ? "The plan is ready. Import it to create tasks."
          : `${taskCount} task${taskCount === 1 ? "" : "s"} in the current plan.`);

  return (
    <section
      aria-label="Planning agent"
      className="@container rounded-xl border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-4 @lg:flex-row @lg:items-start">
        <div className="flex min-w-0 flex-1 gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
          >
            <BotIcon className="size-4.5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-sm">Plan</h2>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <p className="max-w-[68ch] text-muted-foreground text-sm leading-relaxed">{summary}</p>
            {planner.error ? (
              <p role="alert" className="text-destructive-foreground text-sm">
                {planner.error}
              </p>
            ) : null}
            {planner.threadId ? (
              <Button
                size="xs"
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
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 @max-lg:pl-12">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh initiative"
            disabled={busy || !canRefresh}
            onClick={() => void runRefresh()}
          >
            <RefreshCwIcon />
          </Button>
          <Button
            size="sm"
            variant={planner.status === "completed" && taskCount === 0 ? "default" : "outline"}
            disabled={!canImport}
            onClick={() => {
              setPastedPlan("");
              setImportDialogOpen(true);
            }}
          >
            <DownloadIcon />
            Import plan
          </Button>
          <Button
            size="sm"
            variant={planner.status === "idle" ? "default" : "outline"}
            disabled={!canPlan || planner.status === "running"}
            onClick={() => setPlanDialogOpen(true)}
          >
            <SparklesIcon />
            {planner.status === "idle" ? "Plan tasks" : "Re-plan"}
          </Button>
        </div>
      </div>

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
    </section>
  );
}
