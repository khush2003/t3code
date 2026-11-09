import type { OrchestrationV2Subagent, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../serverActivation.ts";
import { taskThread } from "./BotBoard.ts";
import * as BotStore from "./BotStore.ts";

const RESULT_CHARS = 20_000;

/**
 * Keeps what each of a bot's tasks ended with in the bot's own store, so the result outlives the
 * task's thread, its machine going offline, and the bot's conversation being compacted.
 */
export class BotJournal extends Context.Service<
  BotJournal,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** Records every finished task of a bot thread not recorded yet. */
    readonly recordFinished: (botThreadId: ThreadId) => Effect.Effect<number>;
  }
>()("t3/bots/BotJournal") {}

const make = Effect.gen(function* () {
  const store = yield* BotStore.BotStore;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const hereId = yield* ServerEnvironment.ServerEnvironment.pipe(
    Effect.flatMap((environment) => environment.getEnvironmentId),
  );

  const record = (bot: BotStore.BotRecord, task: OrchestrationV2Subagent) => {
    const thread = taskThread(task, hereId);
    if (thread === null || task.result === null) return Effect.succeed(false);
    return store.recordEpisode({
      ...thread,
      bot: bot.name,
      runKey: task.id,
      title: task.title ?? task.prompt.slice(0, 60).trim(),
      outcome: task.status,
      startedAt: task.startedAt === null ? null : DateTime.formatIso(task.startedAt),
      endedAt: DateTime.formatIso(task.completedAt ?? task.updatedAt),
      result: task.result.slice(0, RESULT_CHARS),
    });
  };

  const recordFinished: BotJournal["Service"]["recordFinished"] = Effect.fn(
    "BotJournal.recordFinished",
  )(
    function* (botThreadId) {
      const bot = yield* store.botForThread(botThreadId);
      if (bot === null) return 0;
      const { subagents } = yield* projections.getThreadRecords(botThreadId, ["subagents"]);
      let recorded = 0;
      for (const task of subagents) if (yield* record(bot, task)) recorded++;
      return recorded;
    },
    (effect, botThreadId) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.logWarning("bot journal could not record results", { botThreadId, error }).pipe(
            Effect.as(0),
          ),
        ),
      ),
  );

  const start: BotJournal["Service"]["start"] = Effect.fn("BotJournal.start")(function* () {
    // Results that ended while this server was down.
    const bots = yield* store.listBots.pipe(Effect.orElseSucceed(() => []));
    for (const bot of bots) if (bot.threadId !== null) yield* recordFinished(bot.threadId);
    yield* forkParked(
      // Per domain event; most return at the type check.
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "subagent.updated" && event.payload.result !== null
          ? recordFinished(event.threadId).pipe(Effect.asVoid)
          : Effect.void,
      ),
    );
  });

  return BotJournal.of({ start, recordFinished });
});

export const layer = Layer.effect(BotJournal, make).pipe(Layer.provide(ProjectionStore.layer));
