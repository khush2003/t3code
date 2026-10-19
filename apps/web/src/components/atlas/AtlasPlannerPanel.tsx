import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, EnvironmentId } from "@t3tools/contracts";
import {
  BotIcon,
  DownloadIcon,
  RefreshCwIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  WandSparklesIcon,
} from "lucide-react";
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
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { AtlasRunOptionsDialog } from "./AtlasRunOptionsDialog";
import { formatAdjustmentCounts, taskIsRemovable } from "./atlasAdjustmentLogic";
import { parseAtlasPlanJson, type AtlasBadgeVariant } from "./atlasLogic";
import type { AtlasAdjustmentSource } from "./AtlasPlanAdjustmentDialog";

function plannerBadge(planner: AtlasInitiative["planner"]): {
  readonly variant: AtlasBadgeVariant;
  readonly label: string;
} {
  const adjusting = planner.mode === "adjust";
  switch (planner.status) {
    case "idle":
      return { variant: "secondary", label: "Not planned" };
    case "running":
      return { variant: "info", label: adjusting ? "Proposing adjustment" : "Planning" };
    case "completed":
      return adjusting && planner.adjustment
        ? { variant: "warning", label: "Adjustment proposed" }
        : { variant: "success", label: "Plan ready" };
    case "failed":
      return { variant: "error", label: adjusting ? "Adjustment failed" : "Planning failed" };
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
  onAdjust,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly taskCount: number;
  readonly onAdjust: (source: AtlasAdjustmentSource) => void;
}) {
  const startPlanAdjustment = useAtomCommand(atlasEnvironment.startPlanAdjustment, {
    reportFailure: false,
  });
  const canAskForAdjustment = useAtomValue(
    atlasEnvironment.startPlanAdjustment.permissionAtom(environmentId),
  );
  const canApplyAdjustment = useAtomValue(
    atlasEnvironment.applyPlanAdjustment.permissionAtom(environmentId),
  );
  const [askOpen, setAskOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
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
  const badge = plannerBadge(planner);
  // Once any task has history, replacing the plan would orphan it; the plan
  // only changes through adjustments from then on.
  const untouched = initiative.tasks.every(taskIsRemovable);
  const proposal =
    planner.mode === "adjust" && planner.status === "completed" ? planner.adjustment : null;
  const proposalStale = proposal !== null && planner.baseRevision !== initiative.planRevision;
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
    proposal !== null
      ? proposal.summary
      : planner.mode === "adjust" && planner.status === "running"
        ? "The planning agent is reviewing progress and results to propose changes to the remaining tasks."
        : (initiative.planSummary ??
          (planner.status === "idle"
            ? "A planning agent reads the brief and deliverables, then proposes tasks you can import, edit, and run."
            : planner.status === "running"
              ? "The planning agent is reading the brief. Answer its questions in the agent panel if it asks."
              : planner.status === "completed" && taskCount === 0
                ? "The plan is ready. Import it to create tasks."
                : `${taskCount} task${taskCount === 1 ? "" : "s"} in the current plan.`));

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
            {proposal !== null ? (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-sm">
                  Proposed: <span className="font-medium">{formatAdjustmentCounts(proposal)}</span>
                </span>
                {proposalStale ? (
                  <span className="text-warning-foreground text-xs">
                    The plan changed since. Ask again to apply.
                  </span>
                ) : null}
                <Button
                  size="xs"
                  variant={proposalStale ? "outline" : "default"}
                  disabled={!canApplyAdjustment}
                  onClick={() => onAdjust({ kind: "proposal" })}
                >
                  Review proposal
                </Button>
              </div>
            ) : null}
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
          {untouched && planner.mode === "plan" ? (
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
          ) : null}
          {untouched ? (
            <Button
              size="sm"
              variant={planner.status === "idle" ? "default" : "outline"}
              disabled={!canPlan || planner.status === "running"}
              onClick={() => setPlanDialogOpen(true)}
            >
              <SparklesIcon />
              {planner.status === "idle" ? "Plan tasks" : "Re-plan"}
            </Button>
          ) : null}
          {taskCount > 0 ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!canAskForAdjustment || planner.status === "running"}
                onClick={() => setAskOpen(true)}
              >
                <WandSparklesIcon />
                Ask agent
              </Button>
              <Button
                size="sm"
                variant={untouched ? "outline" : "default"}
                disabled={!canApplyAdjustment}
                onClick={() => onAdjust({ kind: "manual", focusTaskId: null })}
              >
                <SlidersHorizontalIcon />
                Adjust plan
              </Button>
            </>
          ) : null}
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

      <AtlasRunOptionsDialog
        open={askOpen}
        onOpenChange={(open) => {
          setAskOpen(open);
          if (open) setInstructions("");
        }}
        environmentId={environmentId}
        projectId={initiative.projectId}
        title="Ask agent to adjust the plan"
        description="A planning agent reads the current tasks, results, and reviews, then proposes edits, additions, and removals. Nothing changes until you review and apply the proposal."
        confirmLabel="Propose adjustment"
        confirmDisabled={instructions.trim().length === 0}
        onConfirm={async (options) => {
          setAskOpen(false);
          const result = await startPlanAdjustment({
            environmentId,
            input: {
              initiativeId: initiative.id,
              instructions: instructions.trim(),
              modelSelection: options.modelSelection!,
              runtimeMode: options.runtimeMode,
              interactionMode: options.interactionMode,
            },
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            reportFailure("Could not start plan adjustment", squashAtomCommandFailure(result));
          }
        }}
      >
        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor="atlas-adjust-instructions">What should change?</Label>
          <Textarea
            id="atlas-adjust-instructions"
            value={instructions}
            placeholder="e.g. Session logic does not need the scaffold. Split the HUD into its own task."
            onChange={(event) => setInstructions(event.target.value)}
          />
        </div>
      </AtlasRunOptionsDialog>

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
