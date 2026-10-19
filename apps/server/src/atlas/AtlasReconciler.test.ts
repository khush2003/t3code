import {
  AtlasInitiative,
  EventId,
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
