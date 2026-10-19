import type { AtlasInitiative, AtlasPersistenceError, ThreadId } from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { forkParked } from "../serverActivation.ts";
import * as AtlasService from "./AtlasService.ts";

function usesThread(initiative: AtlasInitiative, threadId: ThreadId): boolean {
  return (
    initiative.planner.threadId === threadId ||
    initiative.tasks.some(
      (task) => task.execution?.threadId === threadId || task.agentReview?.threadId === threadId,
    )
  );
}

function hasPendingWork(initiative: AtlasInitiative): boolean {
  return (
    initiative.planner.status === "running" ||
    initiative.tasks.some(
      (task) => task.execution?.status === "running" || task.agentReview?.status === "running",
    )
  );
}

export class AtlasReconciler extends Context.Service<
  AtlasReconciler,
  {
    readonly reconcile: (threadId?: ThreadId) => Effect.Effect<void, AtlasPersistenceError>;
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/atlas/AtlasReconciler") {}

const make = Effect.gen(function* () {
  const atlas = yield* AtlasService.AtlasService;
  const orchestrator = yield* Orchestrator.OrchestratorV2;

  const reconcile: AtlasReconciler["Service"]["reconcile"] = (threadId) =>
    atlas.listInitiatives({}).pipe(
      Effect.flatMap(({ initiatives }) =>
        Effect.forEach(
          initiatives.filter((initiative) =>
            threadId === undefined ? hasPendingWork(initiative) : usesThread(initiative, threadId),
          ),
          (initiative) =>
            atlas
              .refreshInitiative({ initiativeId: initiative.id })
              .pipe(Effect.catchTags({ AtlasInitiativeNotFoundError: () => Effect.void })),
          { discard: true, concurrency: 1 },
        ),
      ),
    );
  const worker = yield* makeDrainableWorker<ThreadId | undefined, AtlasPersistenceError, never>(
    reconcile,
  );

  const start: AtlasReconciler["Service"]["start"] = () =>
    forkParked(
      Stream.unwrap(
        worker.enqueue(undefined).pipe(Effect.as(orchestrator.streamDomainEvents)),
      ).pipe(
        Stream.filter(
          (event) =>
            (event.type === "run.updated" &&
              ["completed", "failed", "cancelled", "interrupted", "rolled_back"].includes(
                event.payload.status,
              )) ||
            (event.type === "subagent.updated" &&
              ["completed", "failed", "cancelled", "interrupted"].includes(event.payload.status)),
        ),
        Stream.runForEach((event) => worker.enqueue(event.threadId)),
        Effect.tapCause((cause) =>
          Effect.logWarning("Atlas completion reconciliation stream failed", { cause }),
        ),
        Effect.retry(Schedule.spaced("1 second")),
      ),
    );
  return AtlasReconciler.of({ reconcile, start, drain: worker.drain });
});

export const layer = Layer.effect(AtlasReconciler, make);
