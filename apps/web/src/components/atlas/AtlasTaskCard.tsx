import { useAtomValue } from "@effect/atom-react";
import type { AtlasInitiative, AtlasTask, EnvironmentId } from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  PlayIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { atlasEnvironment } from "../../state/atlas";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
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
import {
  agentReviewStatusLabel,
  canDecideOnTask,
  canExecuteTask,
  canPublishTaskIssue,
  canStartAgentReview,
  taskIsRunning,
  taskStatusBadgeVariant,
  taskStatusLabel,
} from "./atlasLogic";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The request failed.";
}

function ThreadLink({
  environmentId,
  threadId,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly label: string;
}) {
  return (
    <Button
      size="sm"
      variant="link"
      render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
    >
      {label}
      <ExternalLinkIcon />
    </Button>
  );
}

function ExecutionSection({
  environmentId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: AtlasTask;
}) {
  const execution = task.execution;
  if (!execution) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span>Execution</span>
        <Badge variant={execution.status === "failed" ? "error" : "outline"}>
          {execution.status}
        </Badge>
        <span>started {formatRelativeTimeLabel(execution.startedAt)}</span>
        <ThreadLink environmentId={environmentId} threadId={execution.threadId} label="View run" />
      </div>
      {execution.result ? (
        <p className="whitespace-pre-wrap rounded-md bg-muted/48 p-2 text-xs">{execution.result}</p>
      ) : null}
    </div>
  );
}

function AgentReviewSection({
  environmentId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: AtlasTask;
}) {
  const review = task.agentReview;
  if (!review) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
        <span>Agent review</span>
        <Badge
          variant={
            review.status === "failed"
              ? "error"
              : review.outcome === "approved"
                ? "success"
                : review.outcome === "changes_requested"
                  ? "warning"
                  : "outline"
          }
        >
          {review.outcome ?? agentReviewStatusLabel(review.status)}
        </Badge>
        <ThreadLink environmentId={environmentId} threadId={review.threadId} label="View review" />
      </div>
      {(review.feedback ?? review.result) ? (
        <p className="whitespace-pre-wrap rounded-md bg-muted/48 p-2 text-xs">
          {review.feedback ?? review.result}
        </p>
      ) : null}
    </div>
  );
}

export function AtlasTaskCard({
  environmentId,
  initiative,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiative: AtlasInitiative;
  readonly task: AtlasTask;
}) {
  const executeTask = useAtomCommand(atlasEnvironment.executeTask, { reportFailure: false });
  const approveTask = useAtomCommand(atlasEnvironment.approveTask, { reportFailure: false });
  const requestChanges = useAtomCommand(atlasEnvironment.requestChanges, {
    reportFailure: false,
  });
  const startAgentReview = useAtomCommand(atlasEnvironment.startAgentReview, {
    reportFailure: false,
  });
  const publishTaskIssue = useAtomCommand(atlasEnvironment.publishTaskIssue, {
    reportFailure: false,
  });
  const canExecute = useAtomValue(atlasEnvironment.executeTask.permissionAtom(environmentId));
  const canDecide = useAtomValue(atlasEnvironment.approveTask.permissionAtom(environmentId));
  const canReview = useAtomValue(atlasEnvironment.startAgentReview.permissionAtom(environmentId));
  const canPublish = useAtomValue(atlasEnvironment.publishTaskIssue.permissionAtom(environmentId));

  const [executeOpen, setExecuteOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [autoApplyVerdict, setAutoApplyVerdict] = useState(false);
  const [decision, setDecision] = useState<"approve" | "changes" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const byId = new Map(initiative.tasks.map((entry) => [entry.id, entry]));
  const blockedByTitles = task.blockedBy
    .map((id) => byId.get(id)?.title ?? null)
    .filter((title): title is string => title !== null);

  const reportFailure = (title: string, error: unknown) => {
    toastManager.add(
      stackedThreadToast({ type: "error", title, description: errorMessage(error) }),
    );
  };

  const runPublish = async () => {
    setBusy(true);
    const result = await publishTaskIssue({
      environmentId,
      input: { initiativeId: initiative.id, taskId: task.id },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure("Could not publish issue", squashAtomCommandFailure(result));
    }
  };

  const runDecision = async (outcome: "approve" | "changes") => {
    const trimmed = feedback.trim();
    if (outcome === "changes" && trimmed.length === 0) return;
    setBusy(true);
    const result =
      outcome === "approve"
        ? await approveTask({
            environmentId,
            input: {
              initiativeId: initiative.id,
              taskId: task.id,
              ...(trimmed.length > 0 ? { feedback: trimmed } : {}),
            },
          })
        : await requestChanges({
            environmentId,
            input: { initiativeId: initiative.id, taskId: task.id, feedback: trimmed },
          });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(
        outcome === "approve" ? "Could not approve task" : "Could not request changes",
        squashAtomCommandFailure(result),
      );
      return;
    }
    setDecision(null);
    setFeedback("");
  };

  const suggestion = task.agentReview?.outcome ?? null;
  const humanDecision = task.humanDecision.outcome;

  return (
    <div className="rounded-lg border bg-card">
      <Collapsible defaultOpen={task.status !== "proposed"}>
        <div className="flex items-start justify-between gap-3 p-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={taskStatusBadgeVariant(task.status)}>
                {taskStatusLabel(task.status)}
              </Badge>
              <Badge variant="outline">{task.specialty}</Badge>
              {task.issue ? (
                <Button
                  size="sm"
                  variant="link"
                  render={<a href={task.issue.url} target="_blank" rel="noreferrer" />}
                >
                  #{task.issue.number}
                  <ExternalLinkIcon />
                </Button>
              ) : null}
            </div>
            <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left">
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180" />
              <span className="font-medium text-sm">{task.title}</span>
            </CollapsibleTrigger>
            {blockedByTitles.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                Blocked by {blockedByTitles.join(", ")}
              </p>
            ) : null}
            {task.humanDecision.decidedBy ? (
              <p className="text-muted-foreground text-xs">
                Decision by{" "}
                {task.humanDecision.decidedBy === "agent" ? "review agent" : "human reviewer"}
              </p>
            ) : null}
            {suggestion ? (
              <p className="text-muted-foreground text-xs">
                Agent review suggests {suggestion === "approved" ? "approval" : "changes"}
                {humanDecision === "pending" ? " · awaiting your decision" : ""}
              </p>
            ) : null}
          </div>
        </div>

        <CollapsiblePanel>
          <div className="space-y-4 border-t p-3">
            {task.description ? (
              <p className="whitespace-pre-wrap text-sm">{task.description}</p>
            ) : null}
            {task.acceptanceCriteria.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium text-xs uppercase text-muted-foreground">
                  Acceptance criteria
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {task.acceptanceCriteria.map((criterion) => (
                    <li key={criterion}>{criterion}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ExecutionSection environmentId={environmentId} task={task} />
            <AgentReviewSection environmentId={environmentId} task={task} />

            <div className="flex flex-wrap items-center gap-2">
              {canPublishTaskIssue(task) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canPublish || busy}
                  onClick={() => void runPublish()}
                >
                  <SendIcon />
                  Publish issue
                </Button>
              ) : null}
              {canExecuteTask(task) ? (
                <Button size="sm" disabled={!canExecute} onClick={() => setExecuteOpen(true)}>
                  <PlayIcon />
                  {task.execution ? "Re-run task" : "Run task"}
                </Button>
              ) : null}
              {canStartAgentReview(task) ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canReview}
                  onClick={() => setReviewOpen(true)}
                >
                  <ShieldCheckIcon />
                  {task.agentReview ? "Re-run agent review" : "Agent review"}
                </Button>
              ) : null}
              {canDecideOnTask(task) ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canDecide || busy}
                    onClick={() => {
                      setFeedback("");
                      setDecision("approve");
                    }}
                  >
                    <CheckIcon />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canDecide || busy}
                    onClick={() => {
                      setFeedback("");
                      setDecision("changes");
                    }}
                  >
                    <XIcon />
                    Request changes
                  </Button>
                </>
              ) : null}
              {taskIsRunning(task) ? (
                <span className="flex items-center gap-1 text-muted-foreground text-xs">
                  <RefreshCwIcon className="size-3.5 animate-spin" />
                  Working…
                </span>
              ) : null}
            </div>
            {task.dependsOn.length > 0 ? (
              <p className="flex items-center gap-1 text-muted-foreground text-xs">
                <GitBranchIcon className="size-3.5" />
                Depends on {task.dependsOn.length} approved task
                {task.dependsOn.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        </CollapsiblePanel>

        <AtlasRunOptionsDialog
          open={executeOpen}
          onOpenChange={setExecuteOpen}
          environmentId={environmentId}
          projectId={initiative.projectId}
          title={task.execution ? "Re-run task" : "Run task"}
          description="Launches a real implementation agent for this task in the project workspace."
          confirmLabel={task.execution ? "Re-run" : "Run task"}
          onConfirm={async (options) => {
            setExecuteOpen(false);
            const result = await executeTask({
              environmentId,
              input: {
                initiativeId: initiative.id,
                taskId: task.id,
                modelSelection: options.modelSelection!,
                runtimeMode: options.runtimeMode,
                interactionMode: options.interactionMode,
              },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              reportFailure("Could not run task", squashAtomCommandFailure(result));
            }
          }}
        />

        <AtlasRunOptionsDialog
          open={reviewOpen}
          onOpenChange={(open) => {
            setReviewOpen(open);
            if (open) setAutoApplyVerdict(false);
          }}
          environmentId={environmentId}
          projectId={initiative.projectId}
          title={task.agentReview ? "Re-run agent review" : "Start agent review"}
          description="A reviewer agent checks the task against its acceptance criteria and the execution result."
          confirmLabel={task.agentReview ? "Re-run review" : "Start review"}
          onConfirm={async (options) => {
            setReviewOpen(false);
            const result = await startAgentReview({
              environmentId,
              input: {
                initiativeId: initiative.id,
                taskId: task.id,
                modelSelection: options.modelSelection!,
                runtimeMode: options.runtimeMode,
                interactionMode: options.interactionMode,
                autoApplyVerdict: task.humanDecision.outcome === "pending" && autoApplyVerdict,
              },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              reportFailure("Could not start agent review", squashAtomCommandFailure(result));
            }
          }}
        >
          {task.humanDecision.outcome === "pending" ? (
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

        <Dialog
          open={decision !== null}
          onOpenChange={(open) => {
            if (!open) {
              setDecision(null);
              setFeedback("");
            }
          }}
        >
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>
                {decision === "changes" ? "Request changes" : "Approve task"}
              </DialogTitle>
              <DialogDescription>
                {decision === "changes"
                  ? "Tell the agent what must change. The task returns to the executor."
                  : "Mark the task approved. Approved dependencies unblock their dependents."}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <Label htmlFor="atlas-task-feedback">
                {decision === "changes" ? "Required feedback" : "Feedback (optional)"}
              </Label>
              <Textarea
                id="atlas-task-feedback"
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
                placeholder={
                  decision === "changes"
                    ? "What is wrong, and what must be true instead?"
                    : "Any notes for the record."
                }
              />
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button
                disabled={busy || (decision === "changes" && feedback.trim().length === 0)}
                onClick={() => void runDecision(decision === "changes" ? "changes" : "approve")}
              >
                {decision === "changes" ? "Request changes" : "Approve"}
              </Button>
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      </Collapsible>
    </div>
  );
}
