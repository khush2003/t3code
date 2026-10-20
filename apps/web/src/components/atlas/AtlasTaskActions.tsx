import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiativeId, AtlasTask, EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { atlasEnvironment } from "../../state/atlas";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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

export interface AtlasTaskPermissions {
  readonly execute: boolean;
  readonly decide: boolean;
  readonly review: boolean;
  readonly publish: boolean;
  readonly adjust: boolean;
}

export function useAtlasTaskPermissions(environmentId: EnvironmentId): AtlasTaskPermissions {
  return {
    execute: useAtomValue(atlasEnvironment.executeTask.permissionAtom(environmentId)),
    decide: useAtomValue(atlasEnvironment.approveTask.permissionAtom(environmentId)),
    review: useAtomValue(atlasEnvironment.startAgentReview.permissionAtom(environmentId)),
    publish: useAtomValue(atlasEnvironment.publishTaskIssue.permissionAtom(environmentId)),
    adjust: useAtomValue(atlasEnvironment.applyPlanAdjustment.permissionAtom(environmentId)),
  };
}

/** Actions that confirm through a dialog before reaching the server. */
export type AtlasTaskDialogKind = "run" | "review" | "approve" | "changes";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The request failed.";
}

function reportFailure(title: string, error: unknown) {
  toastManager.add(stackedThreadToast({ type: "error", title, description: errorMessage(error) }));
}

/** Publishing has no options, so it runs straight from the button. */
export function useAtlasTaskPublish(environmentId: EnvironmentId, initiativeId: AtlasInitiativeId) {
  const publishTaskIssue = useAtomCommand(atlasEnvironment.publishTaskIssue, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const publish = async (task: AtlasTask) => {
    setBusy(true);
    const result = await publishTaskIssue({
      environmentId,
      input: { initiativeId, taskId: task.id },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(
        task.issue ? "Could not update issue" : "Could not publish issue",
        squashAtomCommandFailure(result),
      );
    }
  };
  return { publish, busy };
}

/**
 * The confirmation for one task action. Mount it only while an action is
 * pending, keyed by task and kind, so every open starts from a clean form.
 */
export function AtlasTaskActionDialog({
  environmentId,
  initiativeId,
  projectId,
  task,
  kind,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiativeId: AtlasInitiativeId;
  readonly projectId: ProjectId;
  readonly task: AtlasTask;
  readonly kind: AtlasTaskDialogKind;
  readonly onClose: () => void;
}) {
  const executeTask = useAtomCommand(atlasEnvironment.executeTask, { reportFailure: false });
  const approveTask = useAtomCommand(atlasEnvironment.approveTask, { reportFailure: false });
  const requestChanges = useAtomCommand(atlasEnvironment.requestChanges, {
    reportFailure: false,
  });
  const startAgentReview = useAtomCommand(atlasEnvironment.startAgentReview, {
    reportFailure: false,
  });
  const [autoApplyVerdict, setAutoApplyVerdict] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const runDecision = async (outcome: "approve" | "changes") => {
    const trimmed = feedback.trim();
    if (outcome === "changes" && trimmed.length === 0) return;
    setBusy(true);
    const result =
      outcome === "approve"
        ? await approveTask({
            environmentId,
            input: {
              initiativeId,
              taskId: task.id,
              ...(trimmed.length > 0 ? { feedback: trimmed } : {}),
            },
          })
        : await requestChanges({
            environmentId,
            input: { initiativeId, taskId: task.id, feedback: trimmed },
          });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(
        outcome === "approve" ? "Could not approve task" : "Could not request changes",
        squashAtomCommandFailure(result),
      );
      return;
    }
    onClose();
  };

  const onOpenChange = (open: boolean) => {
    if (!open) onClose();
  };

  if (kind === "run") {
    return (
      <AtlasRunOptionsDialog
        open
        onOpenChange={onOpenChange}
        environmentId={environmentId}
        projectId={projectId}
        title={task.execution ? "Re-run task" : "Run task"}
        description="Choose an agent and workspace for this implementation task."
        workspaceChoice
        reuseWorkspace={task.execution !== null}
        confirmLabel={task.execution ? "Re-run" : "Run task"}
        onConfirm={async (options) => {
          onClose();
          const result = await executeTask({
            environmentId,
            input: {
              initiativeId,
              taskId: task.id,
              modelSelection: options.modelSelection!,
              runtimeMode: options.runtimeMode,
              interactionMode: options.interactionMode,
              ...(options.workspaceStrategy
                ? { workspaceStrategy: options.workspaceStrategy }
                : {}),
            },
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            reportFailure("Could not run task", squashAtomCommandFailure(result));
          }
        }}
      />
    );
  }

  if (kind === "review") {
    const decisionPending = task.humanDecision.outcome === "pending";
    return (
      <AtlasRunOptionsDialog
        open
        onOpenChange={onOpenChange}
        environmentId={environmentId}
        projectId={projectId}
        title={task.agentReview ? "Re-run agent review" : "Start agent review"}
        description="A reviewer agent checks the task against its acceptance criteria and the execution result."
        confirmLabel={task.agentReview ? "Re-run review" : "Start review"}
        onConfirm={async (options) => {
          onClose();
          const result = await startAgentReview({
            environmentId,
            input: {
              initiativeId,
              taskId: task.id,
              modelSelection: options.modelSelection!,
              runtimeMode: options.runtimeMode,
              interactionMode: options.interactionMode,
              autoApplyVerdict: decisionPending && autoApplyVerdict,
            },
          });
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            reportFailure("Could not start agent review", squashAtomCommandFailure(result));
          }
        }}
      >
        {decisionPending ? (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              aria-label="Apply the review decision automatically"
              checked={autoApplyVerdict}
              onCheckedChange={(checked) => setAutoApplyVerdict(checked === true)}
            />
            <span>
              Apply the review decision automatically
              <span className="block text-muted-foreground text-xs">
                The reviewer&apos;s verdict is applied once it finishes. You can still change the
                decision yourself.
              </span>
            </span>
          </label>
        ) : null}
      </AtlasRunOptionsDialog>
    );
  }

  const changes = kind === "changes";
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{changes ? "Request changes" : "Approve task"}</DialogTitle>
          <DialogDescription>
            {changes
              ? "Tell the agent what must change. The task returns to the executor."
              : "Mark the task approved. Approved dependencies unblock their dependents."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Label htmlFor={`atlas-task-feedback-${task.id}`}>
            {changes ? "Required feedback" : "Feedback (optional)"}
          </Label>
          <Textarea
            id={`atlas-task-feedback-${task.id}`}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder={
              changes
                ? "What is wrong, and what must be true instead?"
                : "Any notes for the record."
            }
          />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={busy || (changes && feedback.trim().length === 0)}
            onClick={() => void runDecision(changes ? "changes" : "approve")}
          >
            {changes ? "Request changes" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
