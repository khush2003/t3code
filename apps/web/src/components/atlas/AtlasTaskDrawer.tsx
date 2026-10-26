import type {
  AtlasInitiativeId,
  AtlasTask,
  AtlasTaskId,
  EnvironmentId,
  ProjectId,
} from "@t3tools/contracts";
import {
  ArrowRightLeftIcon,
  CheckIcon,
  CircleIcon,
  ExternalLinkIcon,
  ListPlusIcon,
  PackageIcon,
  PencilIcon,
  PlayIcon,
  RotateCwIcon,
  SendIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldXIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { formatElapsedDurationLabel, formatRelativeTimeLabel } from "../../timestampFormat";
import { cn } from "../../lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Sheet, SheetPopup, SheetTitle } from "../ui/sheet";
import { AtlasDeliverables, ThreadLinkButton } from "./AtlasArtifactViewer";
import { AtlasStatusDot } from "./AtlasProgress";
import {
  useAtlasTaskPublish,
  type AtlasTaskDialogKind,
  type AtlasTaskPermissions,
} from "./AtlasTaskActions";
import { AtlasTaskStatusPill, REASON_TONE } from "./AtlasTaskCard";
import { taskIsEditable } from "./atlasAdjustmentLogic";
import { deliverableEntries, taskStatusPill } from "./atlasArtifactLogic";
import {
  agentReviewStatusLabel,
  canContinueTask,
  canDecideOnTask,
  canExecuteTask,
  canPublishTaskIssue,
  canStartAgentReview,
  reviewLaunchError,
  runFailure,
} from "./atlasLogic";
import { taskTone, type AtlasTaskReason } from "./atlasTaskListLogic";
import { TONE_DOT, TONE_SOFT } from "./atlasTone";

type DrawerTab = "deliverables" | "overview" | "review" | "activity";

/** A review tab exists once the reviewer has finished, whatever its verdict. */
function finishedReview(task: AtlasTask) {
  const review = task.agentReview;
  return review && review.status !== "running" ? review : null;
}

function Section({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Prose({ text, cwd }: { readonly text: string; readonly cwd?: string | undefined }) {
  return <ChatMarkdown text={text} cwd={cwd} className="max-w-[72ch] text-sm" />;
}

function OverviewTab({
  task,
  byId,
  onOpenTask,
}: {
  readonly task: AtlasTask;
  readonly byId: ReadonlyMap<AtlasTaskId, AtlasTask>;
  readonly onOpenTask: (taskId: AtlasTaskId) => void;
}) {
  const approved = task.status === "approved";
  const dependencies = task.dependsOn.flatMap((id) => {
    const dependency = byId.get(id);
    return dependency ? [dependency] : [];
  });
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
      {task.deliverable ? (
        <div className="flex gap-3 rounded-xl border bg-muted/32 p-4">
          <PackageIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-xs text-muted-foreground">What you will review</p>
            <p className="text-sm leading-relaxed wrap-anywhere">{task.deliverable}</p>
          </div>
        </div>
      ) : null}
      <Section title="Description">
        <Prose text={task.description} />
      </Section>
      {task.acceptanceCriteria.length > 0 ? (
        <Section
          title="Acceptance criteria"
          aside={
            approved ? (
              <span className="text-success-foreground text-xs">Met, task approved</span>
            ) : null
          }
        >
          <ul className="max-w-[72ch] space-y-2 text-sm">
            {task.acceptanceCriteria.map((criterion) => (
              <li key={criterion} className="flex gap-2.5">
                {approved ? (
                  <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                ) : (
                  <CircleIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground/60"
                  />
                )}
                <span className="leading-relaxed">{criterion}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {dependencies.length > 0 ? (
        <Section title="Builds on">
          <ul className="flex flex-col gap-1">
            {dependencies.map((dependency) => (
              <li key={dependency.id}>
                <button
                  type="button"
                  onClick={() => onOpenTask(dependency.id)}
                  className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                >
                  <AtlasStatusDot status={dependency.status} />
                  <span className="text-muted-foreground text-xs tabular-nums">
                    #{dependency.ordinal + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{dependency.title}</span>
                  <AtlasTaskStatusPill task={dependency} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function verdictBadge(task: AtlasTask) {
  const review = task.agentReview;
  if (!review) return null;
  if (review.outcome === "approved") return <Badge variant="success">Suggests approval</Badge>;
  if (review.outcome === "changes_requested")
    return <Badge variant="warning">Suggests changes</Badge>;
  return (
    <Badge variant={review.status === "failed" ? "error" : "secondary"}>
      {agentReviewStatusLabel(review.status)}
    </Badge>
  );
}

function verdictDot(task: AtlasTask) {
  const review = task.agentReview;
  const tone =
    review?.outcome === "approved"
      ? "bg-success"
      : review?.outcome === "changes_requested"
        ? "bg-warning"
        : "bg-destructive";
  return <span aria-hidden className={cn("size-1.5 rounded-full", tone)} />;
}

function ReviewTab({
  environmentId,
  task,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: AtlasTask;
}) {
  const review = finishedReview(task);
  if (!review) return null;
  const decision = task.humanDecision;
  const verdict =
    review.status === "failed"
      ? {
          tone: "error" as const,
          Icon: ShieldXIcon,
          title: "The review failed",
          detail: "Nothing was accepted. Re-run the agent review or review the work yourself.",
        }
      : review.outcome === "approved"
        ? {
            tone: "success" as const,
            Icon: ShieldCheckIcon,
            title: "The reviewer suggests approving",
            detail: null,
          }
        : review.outcome === "changes_requested"
          ? {
              tone: "warning" as const,
              Icon: ShieldAlertIcon,
              title: "The reviewer suggests changes",
              detail: null,
            }
          : {
              tone: "error" as const,
              Icon: ShieldXIcon,
              title: "The reviewer's verdict could not be read",
              detail: "Nothing was applied. Read the output below and decide yourself.",
            };
  const decisionNote =
    decision.outcome === "pending"
      ? "Your decision is still needed."
      : decision.decidedBy === "agent"
        ? `Applied automatically: ${decision.outcome === "approved" ? "approved" : "changes requested"}.`
        : `You ${decision.outcome === "approved" ? "approved the task" : "requested changes"}.`;
  const timing = [
    review.finishedAt ? `Finished ${formatRelativeTimeLabel(review.finishedAt)}` : null,
    review.finishedAt
      ? `took ${formatElapsedDurationLabel(review.startedAt, Date.parse(review.finishedAt))}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
      <div
        className={cn(
          "flex gap-3 rounded-xl border p-4",
          verdict.tone === "success" && "border-success/24 bg-success/6",
          verdict.tone === "warning" && "border-warning/24 bg-warning/6",
          verdict.tone === "error" && "border-destructive/24 bg-destructive/6",
        )}
      >
        <verdict.Icon
          aria-hidden
          className={cn(
            "mt-0.5 size-5 shrink-0",
            verdict.tone === "success" && "text-success",
            verdict.tone === "warning" && "text-warning",
            verdict.tone === "error" && "text-destructive",
          )}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-sm">{verdict.title}</p>
          {verdict.detail ? (
            <p className="text-muted-foreground text-xs">{verdict.detail}</p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {[timing, decisionNote].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ThreadLinkButton environmentId={environmentId} threadId={review.threadId} />
      </div>

      {review.feedback ? (
        <Section title="Reviewer feedback">
          <Prose text={review.feedback} />
        </Section>
      ) : review.result ? (
        <Section title="Reviewer output">
          <Prose text={review.result} />
        </Section>
      ) : (
        <p className="text-muted-foreground text-sm">The reviewer left no feedback.</p>
      )}

      {task.acceptanceCriteria.length > 0 ? (
        <Section title="Checked against">
          <ul className="max-w-[72ch] list-disc space-y-1.5 ps-5 text-sm marker:text-muted-foreground">
            {task.acceptanceCriteria.map((criterion) => (
              <li key={criterion} className="leading-relaxed">
                {criterion}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function ActivityTab({
  environmentId,
  task,
  onShowReview,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: AtlasTask;
  readonly onShowReview: () => void;
}) {
  const execution = task.execution;
  const review = task.agentReview;
  const launchError = reviewLaunchError(task);
  const decision = task.humanDecision;
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
      <Section
        title="Implementation run"
        aside={
          execution ? (
            <ThreadLinkButton environmentId={environmentId} threadId={execution.threadId} />
          ) : null
        }
      >
        {execution ? (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="capitalize">{execution.status}</dd>
              <dt className="text-muted-foreground">Started</dt>
              <dd>{formatRelativeTimeLabel(execution.startedAt)}</dd>
              {execution.finishedAt ? (
                <>
                  <dt className="text-muted-foreground">Took</dt>
                  <dd>
                    {formatElapsedDurationLabel(
                      execution.startedAt,
                      Date.parse(execution.finishedAt),
                    )}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Workspace</dt>
              <dd>
                {execution.workspaceStrategy?.type === "worktree"
                  ? "Separate worktree"
                  : "Project checkout"}
              </dd>
              {execution.failure ? (
                <>
                  <dt className="text-muted-foreground">Stopped</dt>
                  <dd className="wrap-anywhere">{execution.failure.message}</dd>
                </>
              ) : null}
            </dl>
            {execution.continuations.length > 0 ? (
              <ol className="mt-3 space-y-1.5 border-s ps-4 text-sm" aria-label="Continuations">
                {execution.continuations.map((continuation) => (
                  <li key={continuation.at} className="flex flex-wrap items-baseline gap-x-2">
                    <span>
                      Continued on{" "}
                      <span className="font-medium">{continuation.modelSelection.model}</span>
                    </span>
                    {continuation.handoff ? (
                      <Badge variant="info">Context handed over</Badge>
                    ) : null}
                    <span className="text-muted-foreground text-xs">
                      {formatRelativeTimeLabel(continuation.at)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Not run yet.</p>
        )}
      </Section>

      {launchError ? (
        <div role="alert" className="space-y-1 rounded-lg bg-warning/8 p-3 text-xs">
          <p className="font-medium text-warning-foreground">Agent review could not start</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{launchError}</p>
          <p className="text-muted-foreground">
            The implementation is unaffected. Retry the agent review, or review it yourself.
          </p>
        </div>
      ) : null}

      {review ? (
        <Section
          title="Agent review"
          aside={
            <>
              {verdictBadge(task)}
              <ThreadLinkButton environmentId={environmentId} threadId={review.threadId} />
            </>
          }
        >
          {review.status === "running" ? (
            <p className="text-muted-foreground text-sm">The reviewer is still working.</p>
          ) : (
            <Button size="xs" variant="outline" onClick={onShowReview}>
              Open review
            </Button>
          )}
        </Section>
      ) : null}

      <Section title="Decision">
        {decision.outcome === "pending" ? (
          <p className="text-muted-foreground text-sm">No decision yet.</p>
        ) : (
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={decision.outcome === "approved" ? "success" : "warning"}>
                {decision.outcome === "approved" ? "Approved" : "Changes requested"}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {decision.decidedBy === "agent" ? "Applied from the review agent" : "By you"}
                {decision.decidedAt ? `, ${formatRelativeTimeLabel(decision.decidedAt)}` : ""}
              </span>
            </p>
            {decision.feedback ? (
              <div className="rounded-lg border bg-muted/24 px-4 py-3">
                <Prose text={decision.feedback} />
              </div>
            ) : null}
          </div>
        )}
      </Section>

      <Section title="Issue">
        {task.issue ? (
          <div className="space-y-1">
            <Button
              size="xs"
              variant="link"
              render={<a href={task.issue.url} target="_blank" rel="noreferrer" />}
            >
              Issue #{task.issue.number}
              <ExternalLinkIcon />
            </Button>
            {task.issue.needsSync === true ? (
              <p className="text-warning-foreground text-xs">
                The task changed since it was published. Update the issue to sync it.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Not published.</p>
        )}
      </Section>
    </div>
  );
}

/** Why the last run stopped and the one-step way back, above every tab. */
function RunStoppedBanner({
  task,
  permissions,
  onAction,
}: {
  readonly task: AtlasTask;
  readonly permissions: AtlasTaskPermissions;
  readonly onAction: (kind: AtlasTaskDialogKind) => void;
}) {
  if (!canContinueTask(task)) return null;
  const failure = runFailure(task);
  const rateLimited = failure?.kind === "rate_limit";
  return (
    <div
      role="status"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3",
        rateLimited ? "bg-warning/8" : "bg-destructive/6",
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <p
          className={cn(
            "font-medium text-sm",
            rateLimited ? "text-warning-foreground" : "text-destructive-foreground",
          )}
        >
          {rateLimited ? "The model hit its rate limit" : "The run stopped before finishing"}
        </p>
        <p className="line-clamp-2 text-muted-foreground text-xs wrap-anywhere">
          {failure?.message ?? "Inspect the thread, or continue where it left off."} Continuing
          keeps the conversation and the workspace.
        </p>
      </div>
      <Button
        size="sm"
        variant={rateLimited ? "default" : "outline"}
        disabled={!permissions.continue}
        onClick={() => onAction("continue")}
      >
        {rateLimited ? <ArrowRightLeftIcon /> : <RotateCwIcon />}
        {rateLimited ? "Switch model" : "Continue"}
      </Button>
    </div>
  );
}

function ReviewBar({
  environmentId,
  initiativeId,
  task,
  permissions,
  onAction,
  onAdjust,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiativeId: AtlasInitiativeId;
  readonly task: AtlasTask;
  readonly permissions: AtlasTaskPermissions;
  readonly onAction: (kind: AtlasTaskDialogKind) => void;
  readonly onAdjust: () => void;
}) {
  const { publish, busy } = useAtlasTaskPublish(environmentId, initiativeId);
  const decidable = canDecideOnTask(task);
  const awaitingReview = task.status === "needs_review";
  const editable = taskIsEditable(task);
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t bg-popover px-4 py-3">
      {decidable ? (
        <>
          <Button
            size="sm"
            variant={awaitingReview ? "default" : "outline"}
            disabled={!permissions.decide}
            onClick={() => onAction("approve")}
          >
            <CheckIcon />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!permissions.decide}
            onClick={() => onAction("changes")}
          >
            <XIcon />
            Request changes
          </Button>
        </>
      ) : null}
      {canExecuteTask(task) ? (
        <Button
          size="sm"
          variant={decidable || canContinueTask(task) ? "outline" : "default"}
          disabled={!permissions.execute}
          onClick={() => onAction("run")}
        >
          <PlayIcon />
          {task.execution ? "Re-run from scratch" : "Run task"}
        </Button>
      ) : null}
      {canStartAgentReview(task) ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!permissions.review}
          onClick={() => onAction("review")}
        >
          <ShieldCheckIcon />
          {task.agentReview
            ? "Re-review"
            : reviewLaunchError(task)
              ? "Retry agent review"
              : "Agent review"}
        </Button>
      ) : null}
      <span className="flex flex-wrap items-center gap-1 sm:ml-auto">
        {canPublishTaskIssue(task) ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={!permissions.publish || busy}
            onClick={() => void publish(task)}
          >
            <SendIcon />
            {task.issue ? "Update issue" : "Publish issue"}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" disabled={!permissions.adjust} onClick={onAdjust}>
          {editable ? <PencilIcon /> : <ListPlusIcon />}
          {editable ? "Edit in plan" : "Add follow-up"}
        </Button>
      </span>
    </div>
  );
}

function DrawerBody({
  environmentId,
  initiativeId,
  projectId,
  task,
  byId,
  reason,
  permissions,
  onOpenTask,
  onAction,
  onAdjust,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiativeId: AtlasInitiativeId;
  readonly projectId: ProjectId;
  readonly task: AtlasTask;
  readonly byId: ReadonlyMap<AtlasTaskId, AtlasTask>;
  readonly reason: AtlasTaskReason;
  readonly permissions: AtlasTaskPermissions;
  readonly onOpenTask: (taskId: AtlasTaskId) => void;
  readonly onAction: (kind: AtlasTaskDialogKind) => void;
  readonly onAdjust: () => void;
}) {
  const [selectedTab, setTab] = useState<DrawerTab>(task.execution ? "deliverables" : "overview");
  const deliverableCount = deliverableEntries(task.execution).length;
  const hasReview = finishedReview(task) !== null;
  // A re-run review hides the tab until it finishes again.
  const tab = selectedTab === "review" && !hasReview ? "deliverables" : selectedTab;
  const tabs: ReadonlyArray<{ id: DrawerTab; label: string; count: number | null }> = [
    { id: "deliverables", label: "Deliverables", count: deliverableCount || null },
    { id: "overview", label: "Overview", count: null },
    ...(hasReview ? [{ id: "review" as const, label: "Review", count: null }] : []),
    { id: "activity", label: "Activity", count: null },
  ];
  return (
    <>
      {/* The full-width mobile sheet sits under the app's floating sidebar toggle. */}
      <header className="shrink-0 space-y-2 border-b bg-atlas-surface px-6 pt-5 pb-4 pe-12 max-sm:ps-12">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
              TONE_SOFT[taskTone(task)],
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT[taskTone(task)])} />
            {taskStatusPill(task).label}
          </span>
          <span className="text-muted-foreground">{task.specialty}</span>
          <span className="text-muted-foreground tabular-nums">#{task.ordinal + 1}</span>
        </div>
        <SheetTitle>{task.title}</SheetTitle>
        {canContinueTask(task) ? null : (
          <p className={cn("text-sm", REASON_TONE[reason.tone])}>{reason.text}</p>
        )}
      </header>

      <RunStoppedBanner task={task} permissions={permissions} onAction={onAction} />

      <div
        role="tablist"
        aria-label="Task sections"
        className="flex shrink-0 gap-1 overflow-x-auto border-b px-3"
      >
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`atlas-task-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`atlas-task-panel-${id}`}
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 py-2.5 font-medium text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              tab === id && "border-foreground text-foreground",
            )}
          >
            {label}
            {id === "review" ? verdictDot(task) : null}
            {count !== null ? (
              <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`atlas-task-panel-${tab}`}
        aria-labelledby={`atlas-task-tab-${tab}`}
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          tab !== "deliverables" && "overflow-y-auto [scrollbar-gutter:stable]",
        )}
      >
        {tab === "deliverables" ? (
          <AtlasDeliverables environmentId={environmentId} projectId={projectId} task={task} />
        ) : tab === "overview" ? (
          <OverviewTab task={task} byId={byId} onOpenTask={onOpenTask} />
        ) : tab === "review" ? (
          <ReviewTab environmentId={environmentId} task={task} />
        ) : (
          <ActivityTab
            environmentId={environmentId}
            task={task}
            onShowReview={() => setTab("review")}
          />
        )}
      </div>

      <ReviewBar
        environmentId={environmentId}
        initiativeId={initiativeId}
        task={task}
        permissions={permissions}
        onAction={onAction}
        onAdjust={onAdjust}
      />
    </>
  );
}

/**
 * The task sheet. Action dialogs render as `children` so they nest inside the
 * sheet's focus scope instead of fighting it.
 */
export function AtlasTaskDrawer({
  environmentId,
  initiativeId,
  projectId,
  task,
  byId,
  reason,
  permissions,
  onClose,
  onOpenTask,
  onAction,
  onAdjust,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly initiativeId: AtlasInitiativeId;
  readonly projectId: ProjectId;
  readonly task: AtlasTask | null;
  readonly byId: ReadonlyMap<AtlasTaskId, AtlasTask>;
  readonly reason: AtlasTaskReason | null;
  readonly permissions: AtlasTaskPermissions;
  readonly onClose: () => void;
  readonly onOpenTask: (taskId: AtlasTaskId) => void;
  readonly onAction: (taskId: AtlasTaskId, kind: AtlasTaskDialogKind) => void;
  readonly onAdjust: (taskId: AtlasTaskId) => void;
  readonly children?: ReactNode;
}) {
  return (
    <Sheet
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup data-atlas side="right" className="max-w-6xl max-sm:w-full">
        {task && reason ? (
          <DrawerBody
            key={task.id}
            environmentId={environmentId}
            initiativeId={initiativeId}
            projectId={projectId}
            task={task}
            byId={byId}
            reason={reason}
            permissions={permissions}
            onOpenTask={onOpenTask}
            onAction={(kind) => onAction(task.id, kind)}
            onAdjust={() => onAdjust(task.id)}
          />
        ) : null}
        {children}
      </SheetPopup>
    </Sheet>
  );
}
