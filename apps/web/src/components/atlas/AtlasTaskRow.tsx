import type {
  AtlasInitiativeId,
  AtlasTask,
  AtlasTaskId,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  ListPlusIcon,
  PencilIcon,
  PlayIcon,
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
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
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
import { AtlasStatusDot } from "./AtlasProgress";
import { AtlasRunOptionsDialog } from "./AtlasRunOptionsDialog";
import { taskIsEditable } from "./atlasAdjustmentLogic";
import {
  agentReviewStatusLabel,
  canDecideOnTask,
  canExecuteTask,
  canPublishTaskIssue,
  canStartAgentReview,
  reviewLaunchError,
} from "./atlasLogic";
import type { AtlasTaskReason } from "./atlasTaskListLogic";

export interface AtlasTaskPermissions {
  readonly execute: boolean;
  readonly decide: boolean;
  readonly review: boolean;
  readonly publish: boolean;
  readonly adjust: boolean;
}

const REASON_TONE: Record<AtlasTaskReason["tone"], string> = {
  muted: "text-muted-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive-foreground",
  success: "text-success-foreground",
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The request failed.";
}

function ThreadLink({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
}) {
  return (
    <Button
      size="xs"
      variant="link"
      render={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
    >
      Open thread
      <ExternalLinkIcon />
    </Button>
  );
}

function ResultBlock({ text }: { readonly text: string }) {
  return (
    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/48 p-2.5 text-xs leading-relaxed">
      {text}
    </p>
  );
}

function TaskDetails({
  environmentId,
  task,
  byId,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: AtlasTask;
  readonly byId: ReadonlyMap<AtlasTaskId, AtlasTask>;
}) {
  const review = task.agentReview;
  const launchError = reviewLaunchError(task);
  const dependencies = task.dependsOn.flatMap((id) => {
    const dependency = byId.get(id);
    return dependency ? [dependency] : [];
  });
  return (
    <div className="space-y-4">
      <p className="max-w-[72ch] whitespace-pre-wrap text-sm leading-relaxed">{task.description}</p>
      {task.acceptanceCriteria.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="font-medium text-muted-foreground text-xs">Acceptance criteria</h4>
          <ul className="max-w-[72ch] space-y-1 text-sm">
            {task.acceptanceCriteria.map((criterion) => (
              <li key={criterion} className="flex gap-2">
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span>{criterion}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {dependencies.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="font-medium text-muted-foreground text-xs">Needs approved</h4>
          <ul className="flex flex-wrap gap-1.5">
            {dependencies.map((dependency) => (
              <li key={dependency.id}>
                <Badge variant="outline">
                  <AtlasStatusDot status={dependency.status} />#{dependency.ordinal + 1}{" "}
                  {dependency.title}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {task.execution ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <span className="font-medium text-foreground">Run</span>
            <span>{task.execution.status}</span>
            <span>{formatRelativeTimeLabel(task.execution.startedAt)}</span>
            {task.execution.workspaceStrategy?.type === "worktree" ? <span>worktree</span> : null}
            <ThreadLink environmentId={environmentId} threadId={task.execution.threadId} />
          </div>
          {task.execution.result ? <ResultBlock text={task.execution.result} /> : null}
        </div>
      ) : null}
      {launchError ? (
        <div role="alert" className="space-y-1 rounded-md bg-warning/8 p-2.5 text-xs">
          <p className="font-medium text-warning-foreground">Agent review could not start</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{launchError}</p>
          <p className="text-muted-foreground">
            The implementation is unaffected. Retry with Agent review below, or review it yourself.
          </p>
        </div>
      ) : null}
      {review ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
            <span className="font-medium text-foreground">Review</span>
            <span>
              {review.outcome === "approved"
                ? "suggests approval"
                : review.outcome === "changes_requested"
                  ? "suggests changes"
                  : agentReviewStatusLabel(review.status).toLowerCase()}
            </span>
            <ThreadLink environmentId={environmentId} threadId={review.threadId} />
          </div>
          {(review.feedback ?? review.result) ? (
            <ResultBlock text={(review.feedback ?? review.result)!} />
          ) : null}
        </div>
      ) : null}
      {task.issue?.needsSync === true ? (
        <p className="text-warning-foreground text-xs">
          Issue #{task.issue.number} needs update: this task changed since it was published.
        </p>
      ) : null}
      {task.humanDecision.feedback ? (
        <div className="space-y-1.5">
          <h4 className="font-medium text-muted-foreground text-xs">
            Decision feedback
            {task.humanDecision.decidedBy === "agent" ? " (applied from review agent)" : ""}
          </h4>
          <ResultBlock text={task.humanDecision.feedback} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One task as a dense row. The row carries the next action; everything else
 * (brief, criteria, run output, review) opens below it on demand.
 */
export function AtlasTaskRow({
  environmentId,
  initiativeId,
  projectId,
  task,
  byId,
  wave,
  reason,
  selected,
  permissions,
  onSelectedChange,
  onAdjust,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiativeId: AtlasInitiativeId;
  readonly projectId: ProjectId;
  readonly task: AtlasTask;
  readonly byId: ReadonlyMap<AtlasTaskId, AtlasTask>;
  readonly wave: number;
  readonly reason: AtlasTaskReason;
  readonly selected: boolean;
  readonly permissions: AtlasTaskPermissions;
  readonly onSelectedChange: (taskId: AtlasTaskId, selected: boolean) => void;
  readonly onAdjust: (taskId: AtlasTaskId) => void;
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

  const [expanded, setExpanded] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [autoApplyVerdict, setAutoApplyVerdict] = useState(false);
  const [decision, setDecision] = useState<"approve" | "changes" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const reportFailure = (title: string, error: unknown) => {
    toastManager.add(
      stackedThreadToast({ type: "error", title, description: errorMessage(error) }),
    );
  };

  const runPublish = async () => {
    setBusy(true);
    const result = await publishTaskIssue({
      environmentId,
      input: { initiativeId: initiativeId, taskId: task.id },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(
        task.issue ? "Could not update issue" : "Could not publish issue",
        squashAtomCommandFailure(result),
      );
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
              initiativeId: initiativeId,
              taskId: task.id,
              ...(trimmed.length > 0 ? { feedback: trimmed } : {}),
            },
          })
        : await requestChanges({
            environmentId,
            input: { initiativeId: initiativeId, taskId: task.id, feedback: trimmed },
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

  const openDecision = (next: "approve" | "changes") => {
    setFeedback("");
    setDecision(next);
  };

  const executable = canExecuteTask(task);
  const decidable = canDecideOnTask(task);
  const editable = taskIsEditable(task);
  const primary =
    task.status === "needs_review" && decidable ? (
      <Button
        size="xs"
        variant="outline"
        disabled={!permissions.decide || busy}
        onClick={() => openDecision("approve")}
      >
        <CheckIcon />
        Approve
      </Button>
    ) : executable ? (
      <Button
        size="xs"
        variant="outline"
        disabled={!permissions.execute}
        onClick={() => setExecuteOpen(true)}
      >
        <PlayIcon />
        {task.execution ? "Re-run" : "Run"}
      </Button>
    ) : null;

  return (
    <li className={cn("min-w-0", expanded && "bg-muted/24")}>
      <div className="group/row flex min-h-10 items-center gap-2.5 px-3 py-1.5">
        <Checkbox
          aria-label={`Select ${task.title}`}
          checked={selected}
          onCheckedChange={(next) => onSelectedChange(task.id, next === true)}
        />
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((previous) => !previous)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-sm py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="flex min-w-0 flex-[1_1_16rem] items-center gap-2">
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-90",
              )}
            />
            <AtlasStatusDot status={task.status} />
            <span className="w-7 shrink-0 text-muted-foreground text-xs tabular-nums">
              #{task.ordinal + 1}
            </span>
            <span className="min-w-0 truncate font-medium text-sm">{task.title}</span>
          </span>
          <span className="flex min-w-0 flex-[0_1_auto] items-center gap-2 pl-5.5 text-xs @2xl:pl-0">
            <span className={cn("truncate", REASON_TONE[reason.tone])}>{reason.text}</span>
            <span className="max-w-32 shrink-0 truncate text-muted-foreground">
              {task.specialty}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              <span aria-hidden>S{wave}</span>
              <span className="sr-only">Stage {wave}</span>
            </span>
          </span>
        </button>
        {task.issue ? (
          <Button
            size="xs"
            variant="ghost-muted"
            render={<a href={task.issue.url} target="_blank" rel="noreferrer" />}
          >
            #{task.issue.number}
            {task.issue.needsSync === true ? (
              <span aria-hidden className="size-1.5 rounded-full bg-warning" />
            ) : null}
            {task.issue.needsSync === true ? <span className="sr-only">, needs update</span> : null}
          </Button>
        ) : null}
        {expanded ? null : primary}
      </div>

      {expanded ? (
        <div className="space-y-4 border-t border-dashed px-3 py-3">
          <TaskDetails environmentId={environmentId} task={task} byId={byId} />
          <div className="flex flex-wrap items-center gap-1.5">
            {executable ? (
              <Button
                size="xs"
                disabled={!permissions.execute}
                onClick={() => setExecuteOpen(true)}
              >
                <PlayIcon />
                {task.execution ? "Re-run" : "Run task"}
              </Button>
            ) : null}
            {decidable ? (
              <>
                <Button
                  size="xs"
                  variant={task.status === "needs_review" ? "default" : "outline"}
                  disabled={!permissions.decide || busy}
                  onClick={() => openDecision("approve")}
                >
                  <CheckIcon />
                  Approve
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!permissions.decide || busy}
                  onClick={() => openDecision("changes")}
                >
                  <XIcon />
                  Request changes
                </Button>
              </>
            ) : null}
            {canStartAgentReview(task) ? (
              <Button
                size="xs"
                variant="outline"
                disabled={!permissions.review}
                onClick={() => setReviewOpen(true)}
              >
                <ShieldCheckIcon />
                {task.agentReview
                  ? "Re-review"
                  : reviewLaunchError(task)
                    ? "Retry agent review"
                    : "Agent review"}
              </Button>
            ) : null}
            {canPublishTaskIssue(task) ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={!permissions.publish || busy}
                onClick={() => void runPublish()}
              >
                <SendIcon />
                {task.issue ? "Update issue" : "Publish issue"}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant="ghost"
              disabled={!permissions.adjust}
              onClick={() => onAdjust(task.id)}
            >
              {editable ? <PencilIcon /> : <ListPlusIcon />}
              {editable ? "Edit in plan" : "Add follow-up"}
            </Button>
          </div>
        </div>
      ) : null}

      <AtlasRunOptionsDialog
        open={executeOpen}
        onOpenChange={setExecuteOpen}
        environmentId={environmentId}
        projectId={projectId}
        title={task.execution ? "Re-run task" : "Run task"}
        description="Choose an agent and workspace for this implementation task."
        workspaceChoice
        reuseWorkspace={task.execution !== null}
        confirmLabel={task.execution ? "Re-run" : "Run task"}
        onConfirm={async (options) => {
          setExecuteOpen(false);
          const result = await executeTask({
            environmentId,
            input: {
              initiativeId: initiativeId,
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

      <AtlasRunOptionsDialog
        open={reviewOpen}
        onOpenChange={(open) => {
          setReviewOpen(open);
          if (open) setAutoApplyVerdict(false);
        }}
        environmentId={environmentId}
        projectId={projectId}
        title={task.agentReview ? "Re-run agent review" : "Start agent review"}
        description="A reviewer agent checks the task against its acceptance criteria and the execution result."
        confirmLabel={task.agentReview ? "Re-run review" : "Start review"}
        onConfirm={async (options) => {
          setReviewOpen(false);
          const result = await startAgentReview({
            environmentId,
            input: {
              initiativeId: initiativeId,
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
            <DialogTitle>{decision === "changes" ? "Request changes" : "Approve task"}</DialogTitle>
            <DialogDescription>
              {decision === "changes"
                ? "Tell the agent what must change. The task returns to the executor."
                : "Mark the task approved. Approved dependencies unblock their dependents."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Label htmlFor={`atlas-task-feedback-${task.id}`}>
              {decision === "changes" ? "Required feedback" : "Feedback (optional)"}
            </Label>
            <Textarea
              id={`atlas-task-feedback-${task.id}`}
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
    </li>
  );
}
