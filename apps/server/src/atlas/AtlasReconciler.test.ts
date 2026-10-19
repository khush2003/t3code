import {
  AtlasInitiative,
  AtlasProviderLaunchError,
  type AtlasStartAgentReviewInput,
  EventId,
  CommandId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as TestClock from "effect/testing/TestClock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as AtlasService from "./AtlasService.ts";
import * as AtlasReconciler from "./AtlasReconciler.ts";

const now = "2026-01-01T00:00:00.000Z";
const threadId = ThreadId.make("thread:review");
const runId = RunId.make("run:review");
const instanceId = ProviderInstanceId.make("codex");
const completedEvent: OrchestrationV2DomainEvent = {
  type: "run.updated",
  id: EventId.make("event:review-done"),
  threadId,
  occurredAt: DateTime.makeUnsafe(now),
  payload: {
    id: runId,
    threadId,
    ordinal: 1,
    providerInstanceId: instanceId,
    modelSelection: { instanceId, model: "test" },
    providerThreadId: null,
    userMessageId: MessageId.make("message:review"),
    rootNodeId: null,
    activeAttemptId: null,
    status: "completed",
    requestedAt: DateTime.makeUnsafe(now),
    startedAt: DateTime.makeUnsafe(now),
    completedAt: DateTime.makeUnsafe(now),
    checkpointId: null,
    contextHandoffId: null,
  },
};
const decodeInitiative = Schema.decodeUnknownSync(AtlasInitiative);
const initiative = (id: string, linkedThreadId: string, running: boolean) =>
  decodeInitiative({
    id,
    projectId: "project:test",
    title: "Review work",
    brief: "Ship a reviewed result",
    deliverables: [],
    status: "planning",
    planSummary: null,
    tasks: [],
    createdAt: now,
    updatedAt: now,
    planner: {
      status: running ? "running" : "completed",
      threadId: linkedThreadId,
      runId,
      error: null,
      launch: null,
    },
  });

it.effect("reconciles a completed linked run without an open client", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const refreshed = yield* Deferred.make<void>();
      const calls: string[] = [];
      let lists = 0;
      const linked = initiative("initiative:linked", threadId, true);
      const other = initiative("initiative:other", "thread:other", true);
      const dependencies = Layer.mergeAll(
        Layer.mock(AtlasService.AtlasService)({
          listInitiatives: () =>
            Effect.sync(() => ({ initiatives: ++lists === 1 ? [] : [linked, other] })),
          refreshInitiative: ({ initiativeId }) =>
            Effect.sync(() => calls.push(initiativeId)).pipe(
              Effect.andThen(Deferred.succeed(refreshed, undefined)),
              Effect.as(linked),
            ),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          streamDomainEvents: Stream.make(completedEvent),
        }),
      );
      yield* Effect.gen(function* () {
        const worker = yield* AtlasReconciler.AtlasReconciler;
        yield* worker.start();
        yield* Deferred.await(refreshed);
        yield* worker.drain;
        assert.deepEqual(calls, [linked.id]);
      }).pipe(Effect.provide(AtlasReconciler.layer.pipe(Layer.provide(dependencies))));
    }),
  ),
);

it.effect("startup reconciliation resumes pending work and skips settled initiatives", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const calls: string[] = [];
      const pending = initiative("initiative:pending", threadId, true);
      const settled = initiative("initiative:settled", "thread:settled", false);
      const dependencies = Layer.mergeAll(
        Layer.mock(AtlasService.AtlasService)({
          listInitiatives: () => Effect.succeed({ initiatives: [pending, settled] }),
          refreshInitiative: ({ initiativeId }) =>
            Effect.sync(() => calls.push(initiativeId)).pipe(Effect.as(pending)),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
      );
      yield* Effect.gen(function* () {
        const worker = yield* AtlasReconciler.AtlasReconciler;
        yield* worker.reconcile();
        assert.deepEqual(calls, [pending.id]);
      }).pipe(Effect.provide(AtlasReconciler.layer.pipe(Layer.provide(dependencies))));
    }),
  ),
);

it.effect("periodic recovery reconciles a missed completion after the event stream fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const scanned = yield* Deferred.make<void>();
      const recovered = yield* Deferred.make<void>();
      const pending = initiative("initiative:missed", threadId, true);
      const calls: string[] = [];
      let lists = 0;
      const dependencies = Layer.mergeAll(
        Layer.mock(AtlasService.AtlasService)({
          listInitiatives: () =>
            Effect.gen(function* () {
              lists++;
              if (lists === 1) {
                yield* Deferred.succeed(scanned, undefined);
                return { initiatives: [] };
              }
              return { initiatives: [pending] };
            }),
          refreshInitiative: ({ initiativeId }) =>
            Effect.sync(() => calls.push(initiativeId)).pipe(
              Effect.andThen(Deferred.succeed(recovered, undefined)),
              Effect.as(pending),
            ),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({
          streamDomainEvents: Stream.fail(
            new Orchestrator.OrchestratorProjectionError({ threadId }),
          ),
        }),
      );
      yield* Effect.gen(function* () {
        const worker = yield* AtlasReconciler.AtlasReconciler;
        yield* worker.start();
        yield* Deferred.await(scanned);
        yield* TestClock.adjust("1 minute");
        yield* Deferred.await(recovered);
        yield* worker.drain;
        assert.deepEqual(calls, [pending.id]);
        assert.strictEqual(lists, 2);
      }).pipe(Effect.provide(AtlasReconciler.layer.pipe(Layer.provide(dependencies))));
    }),
  ),
);

const autoReviewPolicy = {
  enabled: true,
  modelSelection: { instanceId, model: "reviewer-model" },
  runtimeMode: "full-access",
  interactionMode: "default",
  autoApplyVerdict: false,
} as const;

function reviewableInitiative() {
  return decodeInitiative({
    ...initiative("initiative:auto-review", "thread:planner", false),
    autoReview: autoReviewPolicy,
    tasks: [
      {
        id: "task:reviewable",
        ordinal: 0,
        title: "Review a completed deliverable",
        description: "Deliver the work",
        specialty: "backend",
        acceptanceCriteria: ["It works"],
        dependsOn: [],
        blockedBy: [],
        status: "needs_review",
        issue: null,
        launch: null,
        createdAt: now,
        updatedAt: now,
        humanDecision: { outcome: "pending", feedback: null, decidedAt: null },
        agentReview: null,
        execution: {
          threadId,
          runId,
          status: "completed",
          startedAt: now,
          finishedAt: now,
          result: "Done",
          workspaceStrategy: { type: "existing_worktree", worktreePath: "/tmp/deliverable" },
        },
      },
    ],
  });
}

it.effect("automatically starts one review after completion using the initiative policy", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let current = reviewableInitiative();
      const calls: AtlasStartAgentReviewInput[] = [];
      const dependencies = Layer.mergeAll(
        Layer.mock(AtlasService.AtlasService)({
          listInitiatives: () => Effect.succeed({ initiatives: [current] }),
          refreshInitiative: () => Effect.succeed(current),
          getInitiative: () => Effect.succeed(current),
          startAgentReview: (input) =>
            Effect.sync(() => {
              calls.push(input);
              current = {
                ...current,
                tasks: current.tasks.map((task) => ({
                  ...task,
                  agentReview: {
                    threadId: ThreadId.make("thread:auto-review"),
                    runId: RunId.make("run:auto-review"),
                    status: "running",
                    outcome: null,
                    feedback: null,
                    startedAt: now,
                    finishedAt: null,
                    result: null,
                    autoApplyVerdict: false,
                  },
                })),
              };
              return current;
            }),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
      );
      yield* Effect.gen(function* () {
        const worker = yield* AtlasReconciler.AtlasReconciler;
        yield* worker.reconcile(threadId);
        yield* worker.reconcile(threadId);
        assert.deepEqual(calls, [
          {
            initiativeId: current.id,
            taskId: current.tasks[0]!.id,
            modelSelection: autoReviewPolicy.modelSelection,
            runtimeMode: "full-access",
            interactionMode: "default",
            autoApplyVerdict: false,
          },
        ]);
      }).pipe(Effect.provide(AtlasReconciler.layer.pipe(Layer.provide(dependencies))));
    }),
  ),
);

it.effect.each([
  "disabled",
  "unconfigured",
  "human decision",
  "review exists",
  "incomplete execution",
])("does not automatically review when $0", (reason) =>
  Effect.scoped(
    Effect.gen(function* () {
      const original = reviewableInitiative();
      const first = original.tasks[0]!;
      const current: AtlasInitiative = {
        ...original,
        autoReview:
          reason === "disabled"
            ? { ...autoReviewPolicy, enabled: false }
            : reason === "unconfigured"
              ? null
              : autoReviewPolicy,
        tasks: [
          {
            ...first,
            humanDecision:
              reason === "human decision"
                ? { outcome: "approved", feedback: null, decidedAt: now }
                : first.humanDecision,
            execution:
              reason === "incomplete execution"
                ? { ...first.execution!, status: "running" }
                : first.execution,
            agentReview:
              reason === "review exists"
                ? {
                    threadId,
                    runId,
                    status: "failed",
                    outcome: null,
                    feedback: null,
                    startedAt: now,
                    finishedAt: now,
                    result: "Failed",
                    autoApplyVerdict: false,
                  }
                : null,
          },
        ],
      };
      let calls = 0;
      const dependencies = Layer.mergeAll(
        Layer.mock(AtlasService.AtlasService)({
          listInitiatives: () => Effect.succeed({ initiatives: [current] }),
          refreshInitiative: () => Effect.succeed(current),
          getInitiative: () => Effect.succeed(current),
          startAgentReview: () =>
            Effect.sync(() => {
              calls++;
              return current;
            }),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
      );
      yield* Effect.gen(function* () {
        const worker = yield* AtlasReconciler.AtlasReconciler;
        yield* worker.reconcile(threadId);
        assert.equal(calls, 0);
      }).pipe(Effect.provide(AtlasReconciler.layer.pipe(Layer.provide(dependencies))));
    }),
  ),
);

it.effect("does not automatically retry a persisted review launch error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let current = reviewableInitiative();
      let calls = 0;
      const dependencies = Layer.mergeAll(
        Layer.mock(AtlasService.AtlasService)({
          listInitiatives: () => Effect.succeed({ initiatives: [current] }),
          refreshInitiative: () => Effect.succeed(current),
          getInitiative: () => Effect.succeed(current),
          startAgentReview: () =>
            Effect.suspend(() => {
              calls++;
              current = {
                ...current,
                tasks: current.tasks.map((task) => ({
                  ...task,
                  launch: {
                    operation: "review",
                    commandId: CommandId.make("command:failed-review"),
                    messageId: MessageId.make("message:failed-review"),
                    createdAt: now,
                    error: "Reviewer model is unavailable",
                  },
                })),
              };
              return Effect.fail(
                new AtlasProviderLaunchError({
                  operation: "review",
                  cause: "Reviewer model is unavailable",
                }),
              );
            }),
        }),
        Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
      );
      yield* Effect.gen(function* () {
        const worker = yield* AtlasReconciler.AtlasReconciler;
        yield* worker.reconcile();
        yield* worker.reconcile();
        yield* worker.reconcile(threadId);
        assert.equal(calls, 1);
        assert.equal(current.tasks[0]!.launch?.error, "Reviewer model is unavailable");
      }).pipe(Effect.provide(AtlasReconciler.layer.pipe(Layer.provide(dependencies))));
    }),
  ),
);
