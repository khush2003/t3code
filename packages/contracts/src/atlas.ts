import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommandId,
  ForwardCompatibleArray,
  IsoDateTime,
  MessageId,
  ProjectId,
  RunId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { OrchestrationV2ThreadLaunchWorkspaceStrategy } from "./orchestrationV2.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

export const AtlasInitiativeId = TrimmedNonEmptyString.pipe(Schema.brand("AtlasInitiativeId"));
export type AtlasInitiativeId = typeof AtlasInitiativeId.Type;

export const AtlasTaskId = TrimmedNonEmptyString.pipe(Schema.brand("AtlasTaskId"));
export type AtlasTaskId = typeof AtlasTaskId.Type;

const ShortText = TrimmedNonEmptyString.check(Schema.isMaxLength(200));
const BodyText = TrimmedNonEmptyString.check(Schema.isMaxLength(50_000));
const AcceptanceCriterion = TrimmedNonEmptyString.check(Schema.isMaxLength(4_000));
const PlanKey = TrimmedNonEmptyString.check(Schema.isMaxLength(120));

export const AtlasInitiativeStatus = Schema.Literals([
  "draft",
  "planning",
  "plan_ready",
  "in_progress",
  "completed",
]);
export type AtlasInitiativeStatus = typeof AtlasInitiativeStatus.Type;

export const AtlasPlannerStatus = Schema.Literals(["idle", "running", "completed", "failed"]);
export type AtlasPlannerStatus = typeof AtlasPlannerStatus.Type;

export const AtlasTaskStatus = Schema.Literals([
  "proposed",
  "running",
  "needs_review",
  "changes_requested",
  "approved",
  "failed",
]);
export type AtlasTaskStatus = typeof AtlasTaskStatus.Type;

export const AtlasExecutionStatus = Schema.Literals([
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
export type AtlasExecutionStatus = typeof AtlasExecutionStatus.Type;

export const AtlasAgentReviewStatus = Schema.Literals(["none", "running", "completed", "failed"]);
export type AtlasAgentReviewStatus = typeof AtlasAgentReviewStatus.Type;

export const AtlasAgentReviewOutcome = Schema.Literals(["approved", "changes_requested"]);
export type AtlasAgentReviewOutcome = typeof AtlasAgentReviewOutcome.Type;

export const AtlasHumanDecisionOutcome = Schema.Literals([
  "pending",
  "approved",
  "changes_requested",
]);
export type AtlasHumanDecisionOutcome = typeof AtlasHumanDecisionOutcome.Type;

export const AtlasRunOptions = Schema.Struct({
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspaceStrategy: Schema.optional(OrchestrationV2ThreadLaunchWorkspaceStrategy).annotate({
    description: "Workspace for the launched thread. Defaults to the project root.",
  }),
});
export type AtlasRunOptions = typeof AtlasRunOptions.Type;

export const AtlasAutoReviewPolicy = Schema.Struct({
  enabled: Schema.Boolean,
  modelSelection: AtlasRunOptions.fields.modelSelection,
  runtimeMode: AtlasRunOptions.fields.runtimeMode,
  interactionMode: AtlasRunOptions.fields.interactionMode,
  autoApplyVerdict: Schema.Boolean,
}).annotate({
  description:
    "Starts an agent review when a task's execution completes. Reviews run in the execution workspace.",
});
export type AtlasAutoReviewPolicy = typeof AtlasAutoReviewPolicy.Type;

export const AtlasTaskDraft = Schema.Struct({
  key: PlanKey.annotate({ description: "Planner-local key, unique within the plan." }),
  title: ShortText,
  description: BodyText,
  specialty: ShortText,
  acceptanceCriteria: Schema.Array(AcceptanceCriterion).check(Schema.isMinLength(1)).annotate({
    description: "Non-empty acceptance criteria. A task is not complete until these are met.",
  }),
  dependsOn: Schema.Array(PlanKey).annotate({
    description: "Local keys this task depends on. They must exist and must not form a cycle.",
  }),
});
export type AtlasTaskDraft = typeof AtlasTaskDraft.Type;

export const AtlasPlanDraft = Schema.Struct({
  summary: BodyText,
  tasks: Schema.Array(AtlasTaskDraft).check(Schema.isMinLength(1)),
});
export type AtlasPlanDraft = typeof AtlasPlanDraft.Type;

export const AtlasIssue = Schema.Struct({
  number: Schema.Int.check(Schema.isGreaterThan(0)),
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2_048)),
  publishedAt: IsoDateTime.annotate({ description: "When the issue was first published." }),
  needsSync: Schema.optional(Schema.Boolean).annotate({
    description:
      "True when the task changed after publication; publishing again updates the issue. Absent means in sync.",
  }),
});
export type AtlasIssue = typeof AtlasIssue.Type;

export const AtlasLaunchAttempt = Schema.Struct({
  operation: Schema.Literals(["planner", "execution", "review"]),
  commandId: CommandId,
  messageId: MessageId,
  workspaceStrategy: Schema.optional(OrchestrationV2ThreadLaunchWorkspaceStrategy),
  createdAt: IsoDateTime,
  error: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))).annotate({
    description: "Why the last launch with this attempt failed. Retrying reuses the attempt.",
  }),
});
export type AtlasLaunchAttempt = typeof AtlasLaunchAttempt.Type;

export const AtlasTaskExecution = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  status: AtlasExecutionStatus,
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
  result: Schema.NullOr(Schema.String),
  workspaceStrategy: Schema.optional(OrchestrationV2ThreadLaunchWorkspaceStrategy),
});
export type AtlasTaskExecution = typeof AtlasTaskExecution.Type;

export const AtlasAgentReview = Schema.Struct({
  threadId: ThreadId,
  runId: RunId,
  status: AtlasAgentReviewStatus,
  outcome: Schema.NullOr(AtlasAgentReviewOutcome),
  feedback: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  finishedAt: Schema.NullOr(IsoDateTime),
  result: Schema.NullOr(Schema.String),
  autoApplyVerdict: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type AtlasAgentReview = typeof AtlasAgentReview.Type;

export const AtlasHumanDecision = Schema.Struct({
  outcome: AtlasHumanDecisionOutcome,
  decidedBy: Schema.optional(Schema.Literals(["human", "agent"])),
  feedback: Schema.NullOr(Schema.String),
  decidedAt: Schema.NullOr(IsoDateTime),
});
export type AtlasHumanDecision = typeof AtlasHumanDecision.Type;

export const AtlasPlannerMode = Schema.Literals(["plan", "adjust"]);
export type AtlasPlannerMode = typeof AtlasPlannerMode.Type;

const TaskOrDraftRef = TrimmedNonEmptyString.check(Schema.isMaxLength(200)).annotate({
  description: "An existing task id, or the local key of a task added in the same adjustment.",
});

export const AtlasTaskUpdate = Schema.Struct({
  taskId: AtlasTaskId,
  title: Schema.optional(ShortText),
  description: Schema.optional(BodyText),
  specialty: Schema.optional(ShortText),
  acceptanceCriteria: Schema.optional(
    Schema.Array(AcceptanceCriterion).check(Schema.isMinLength(1)),
  ),
  dependsOn: Schema.optional(Schema.Array(TaskOrDraftRef)).annotate({
    description: "Replaces the dependency list. Only hard artifact prerequisites belong here.",
  }),
});
export type AtlasTaskUpdate = typeof AtlasTaskUpdate.Type;

export const AtlasTaskAddition = Schema.Struct({
  ...AtlasTaskDraft.fields,
  dependsOn: Schema.Array(TaskOrDraftRef).annotate({
    description: "Existing task ids or keys of other additions. Must stay acyclic.",
  }),
});
export type AtlasTaskAddition = typeof AtlasTaskAddition.Type;

const emptyArray = <S extends Schema.Top>(item: S) =>
  Schema.Array(item).pipe(Schema.withDecodingDefault(Effect.succeed([])));

export const AtlasPlanAdjustment = Schema.Struct({
  summary: BodyText,
  updates: emptyArray(AtlasTaskUpdate).annotate({
    description:
      "Edits to tasks that have not started. Started tasks are immutable; edited published tasks are marked needsSync.",
  }),
  additions: emptyArray(AtlasTaskAddition),
  removals: emptyArray(AtlasTaskId).annotate({
    description: "Ids of tasks that have not started or been published as issues.",
  }),
});
export type AtlasPlanAdjustment = typeof AtlasPlanAdjustment.Type;

export const AtlasPlanner = Schema.Struct({
  status: AtlasPlannerStatus,
  threadId: Schema.NullOr(ThreadId),
  runId: Schema.NullOr(RunId),
  error: Schema.NullOr(Schema.String),
  launch: Schema.NullOr(AtlasLaunchAttempt),
  mode: AtlasPlannerMode.pipe(Schema.withDecodingDefault(Effect.succeed("plan" as const))),
  baseRevision: Schema.NullOr(Schema.Int).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  instructions: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  adjustment: Schema.NullOr(AtlasPlanAdjustment)
    .pipe(Schema.withDecodingDefault(Effect.succeed(null)))
    .annotate({
      description: "The parsed proposal of a completed adjust run, awaiting preview and apply.",
    }),
});
export type AtlasPlanner = typeof AtlasPlanner.Type;

export const AtlasTask = Schema.Struct({
  id: AtlasTaskId,
  ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  title: ShortText,
  description: BodyText,
  specialty: ShortText,
  acceptanceCriteria: Schema.Array(AcceptanceCriterion),
  dependsOn: Schema.Array(AtlasTaskId),
  blockedBy: Schema.Array(AtlasTaskId).annotate({
    description: "Dependencies that are not approved yet; they gate execution.",
  }),
  status: AtlasTaskStatus,
  issue: Schema.NullOr(AtlasIssue),
  execution: Schema.NullOr(AtlasTaskExecution),
  agentReview: Schema.NullOr(AtlasAgentReview),
  humanDecision: AtlasHumanDecision,
  launch: Schema.NullOr(AtlasLaunchAttempt),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AtlasTask = typeof AtlasTask.Type;

export const AtlasInitiative = Schema.Struct({
  id: AtlasInitiativeId,
  projectId: ProjectId,
  title: ShortText,
  brief: BodyText,
  deliverables: Schema.Array(AcceptanceCriterion),
  status: AtlasInitiativeStatus,
  planSummary: Schema.NullOr(Schema.String),
  planRevision: Schema.Int.pipe(Schema.withDecodingDefault(Effect.succeed(0))).annotate({
    description: "Increments whenever the task plan is imported or adjusted.",
  }),
  planner: AtlasPlanner,
  autoReview: Schema.NullOr(AtlasAutoReviewPolicy).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  tasks: Schema.Array(AtlasTask),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AtlasInitiative = typeof AtlasInitiative.Type;

export const AtlasListInitiativesInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});
export type AtlasListInitiativesInput = typeof AtlasListInitiativesInput.Type;

export const AtlasListInitiativesResult = Schema.Struct({
  initiatives: ForwardCompatibleArray(AtlasInitiative),
});
export type AtlasListInitiativesResult = typeof AtlasListInitiativesResult.Type;

export const AtlasGetInitiativeInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
});
export type AtlasGetInitiativeInput = typeof AtlasGetInitiativeInput.Type;

export const AtlasCreateInitiativeInput = Schema.Struct({
  projectId: ProjectId,
  title: ShortText,
  brief: BodyText,
  deliverables: Schema.Array(AcceptanceCriterion),
});
export type AtlasCreateInitiativeInput = typeof AtlasCreateInitiativeInput.Type;

export const AtlasUpdateInitiativeInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  title: Schema.optional(ShortText),
  brief: Schema.optional(BodyText),
  deliverables: Schema.optional(Schema.Array(AcceptanceCriterion)),
  autoReview: Schema.optional(Schema.NullOr(AtlasAutoReviewPolicy)).annotate({
    description: "Omit to keep the current policy; null clears it.",
  }),
});
export type AtlasUpdateInitiativeInput = typeof AtlasUpdateInitiativeInput.Type;

export const AtlasDeleteInitiativeInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
});
export type AtlasDeleteInitiativeInput = typeof AtlasDeleteInitiativeInput.Type;

export const AtlasDeleteInitiativeResult = Schema.Struct({
  deleted: Schema.Literal(true),
});
export type AtlasDeleteInitiativeResult = typeof AtlasDeleteInitiativeResult.Type;

export const AtlasStartPlanningInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  ...AtlasRunOptions.fields,
});
export type AtlasStartPlanningInput = typeof AtlasStartPlanningInput.Type;

export const AtlasImportPlanInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  plan: Schema.optional(AtlasPlanDraft).annotate({
    description:
      "A caller-supplied plan. Omit to import the completed planner thread's final assistant output.",
  }),
});
export type AtlasImportPlanInput = typeof AtlasImportPlanInput.Type;

export const AtlasStartPlanAdjustmentInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  instructions: BodyText,
  ...AtlasRunOptions.fields,
});
export type AtlasStartPlanAdjustmentInput = typeof AtlasStartPlanAdjustmentInput.Type;

export const AtlasApplyPlanAdjustmentInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  expectedPlanRevision: Schema.Int,
  adjustment: Schema.optional(AtlasPlanAdjustment).annotate({
    description: "The adjustment to apply. Omit to apply the planner's stored proposal.",
  }),
});
export type AtlasApplyPlanAdjustmentInput = typeof AtlasApplyPlanAdjustmentInput.Type;

export const AtlasRefreshInitiativeInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
});
export type AtlasRefreshInitiativeInput = typeof AtlasRefreshInitiativeInput.Type;

export const AtlasExecuteTaskInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  taskId: AtlasTaskId,
  ...AtlasRunOptions.fields,
});
export type AtlasExecuteTaskInput = typeof AtlasExecuteTaskInput.Type;

export const AtlasApproveTaskInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  taskId: AtlasTaskId,
  feedback: Schema.optional(Schema.String.check(Schema.isMaxLength(20_000))),
});
export type AtlasApproveTaskInput = typeof AtlasApproveTaskInput.Type;

export const AtlasRequestChangesInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  taskId: AtlasTaskId,
  feedback: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
});
export type AtlasRequestChangesInput = typeof AtlasRequestChangesInput.Type;

export const AtlasStartAgentReviewInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  taskId: AtlasTaskId,
  autoApplyVerdict: Schema.optional(Schema.Boolean).annotate({
    description:
      "Apply a valid completed verdict to the human decision. Defaults to false; invalid output never auto-approves.",
  }),
  ...AtlasRunOptions.fields,
});
export type AtlasStartAgentReviewInput = typeof AtlasStartAgentReviewInput.Type;

export const AtlasPublishTaskIssueInput = Schema.Struct({
  initiativeId: AtlasInitiativeId,
  taskId: AtlasTaskId,
});
export type AtlasPublishTaskIssueInput = typeof AtlasPublishTaskIssueInput.Type;

export class AtlasInitiativeNotFoundError extends Schema.TaggedError<AtlasInitiativeNotFoundError>()(
  "AtlasInitiativeNotFoundError",
  { initiativeId: AtlasInitiativeId },
) {
  override get message(): string {
    return `Atlas initiative ${this.initiativeId} was not found.`;
  }
}

export class AtlasTaskNotFoundError extends Schema.TaggedError<AtlasTaskNotFoundError>()(
  "AtlasTaskNotFoundError",
  { initiativeId: AtlasInitiativeId, taskId: AtlasTaskId },
) {
  override get message(): string {
    return `Atlas task ${this.taskId} was not found in initiative ${this.initiativeId}.`;
  }
}

export class AtlasProjectNotFoundError extends Schema.TaggedError<AtlasProjectNotFoundError>()(
  "AtlasProjectNotFoundError",
  { projectId: ProjectId },
) {
  override get message(): string {
    return `Project ${this.projectId} was not found.`;
  }
}

export class AtlasDependencyNotApprovedError extends Schema.TaggedError<AtlasDependencyNotApprovedError>()(
  "AtlasDependencyNotApprovedError",
  { taskId: AtlasTaskId, blockedBy: Schema.Array(AtlasTaskId) },
) {
  override get message(): string {
    return `Task ${this.taskId} is blocked by unapproved dependencies.`;
  }
}

export class AtlasExecutionNotFinishedError extends Schema.TaggedError<AtlasExecutionNotFinishedError>()(
  "AtlasExecutionNotFinishedError",
  { threadId: ThreadId, status: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} has not finished (status: ${this.status}).`;
  }
}

export class AtlasPlanImportError extends Schema.TaggedError<AtlasPlanImportError>()(
  "AtlasPlanImportError",
  { reason: Schema.String.check(Schema.isMaxLength(2_000)) },
) {
  override get message(): string {
    return `Atlas could not import the plan: ${this.reason}`;
  }
}

export class AtlasPlanValidationError extends Schema.TaggedError<AtlasPlanValidationError>()(
  "AtlasPlanValidationError",
  { reason: Schema.String.check(Schema.isMaxLength(2_000)) },
) {
  override get message(): string {
    return `Atlas rejected the plan: ${this.reason}`;
  }
}

export class AtlasPlanRevisionConflictError extends Schema.TaggedError<AtlasPlanRevisionConflictError>()(
  "AtlasPlanRevisionConflictError",
  {
    initiativeId: AtlasInitiativeId,
    expectedPlanRevision: Schema.Int,
    actualPlanRevision: Schema.Int,
  },
) {
  override get message(): string {
    return `The plan changed since this adjustment was prepared (revision ${this.expectedPlanRevision}, now ${this.actualPlanRevision}). Review it again.`;
  }
}

export class AtlasGitHubRepositoryError extends Schema.TaggedError<AtlasGitHubRepositoryError>()(
  "AtlasGitHubRepositoryError",
  {
    projectId: ProjectId,
    reason: Schema.Literals(["missing_remote", "unsupported_remote"]),
  },
) {
  override get message(): string {
    return this.reason === "missing_remote"
      ? `Project ${this.projectId} has no origin remote to publish an issue to.`
      : `Project ${this.projectId}'s origin remote is not a GitHub repository.`;
  }
}

export class AtlasIssuePublishError extends Schema.TaggedError<AtlasIssuePublishError>()(
  "AtlasIssuePublishError",
  {
    taskId: AtlasTaskId,
    operation: Schema.Literals(["create", "update"]),
    exitCode: Schema.NullOr(Schema.Int),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return this.operation === "update"
      ? `Failed to update the GitHub issue for Atlas task ${this.taskId}.`
      : `Failed to publish a GitHub issue for Atlas task ${this.taskId}.`;
  }
}

export class AtlasPersistenceError extends Schema.TaggedError<AtlasPersistenceError>()(
  "AtlasPersistenceError",
  {
    operation: Schema.Literals(["list", "get", "save", "delete", "decode"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Atlas persistence failed during ${this.operation}.`;
  }
}

export class AtlasProviderLaunchError extends Schema.TaggedError<AtlasProviderLaunchError>()(
  "AtlasProviderLaunchError",
  {
    operation: Schema.Literals(["planner", "task", "review"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Atlas failed to launch its ${this.operation} thread.`;
  }
}

export class AtlasInitiativeBusyError extends Schema.TaggedError<AtlasInitiativeBusyError>()(
  "AtlasInitiativeBusyError",
  {
    initiativeId: AtlasInitiativeId,
    active: Schema.Literals(["planner", "task", "review"]),
  },
) {
  override get message(): string {
    return `Atlas initiative ${this.initiativeId} still has an active ${this.active} run.`;
  }
}

export class AtlasProjectBusyError extends Schema.TaggedError<AtlasProjectBusyError>()(
  "AtlasProjectBusyError",
  {
    projectId: ProjectId,
    activeInitiativeId: AtlasInitiativeId,
    activeTaskId: AtlasTaskId,
  },
) {
  override get message(): string {
    return `Atlas is already implementing task ${this.activeTaskId} in initiative ${this.activeInitiativeId} in the requested workspace. Choose a separate worktree to run in parallel.`;
  }
}

export class AtlasTaskNotRunnableError extends Schema.TaggedError<AtlasTaskNotRunnableError>()(
  "AtlasTaskNotRunnableError",
  { taskId: AtlasTaskId, status: AtlasTaskStatus },
) {
  override get message(): string {
    return `Atlas task ${this.taskId} cannot run from status ${this.status}.`;
  }
}

export const AtlasError = Schema.Union([
  AtlasInitiativeNotFoundError,
  AtlasTaskNotFoundError,
  AtlasProjectNotFoundError,
  AtlasDependencyNotApprovedError,
  AtlasExecutionNotFinishedError,
  AtlasPlanImportError,
  AtlasPlanValidationError,
  AtlasPlanRevisionConflictError,
  AtlasIssuePublishError,
  AtlasGitHubRepositoryError,
  AtlasPersistenceError,
  AtlasProviderLaunchError,
  AtlasInitiativeBusyError,
  AtlasProjectBusyError,
  AtlasTaskNotRunnableError,
]);
export type AtlasError = typeof AtlasError.Type;
