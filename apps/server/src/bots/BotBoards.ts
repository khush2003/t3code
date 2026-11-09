import {
  type BotError,
  type BotName,
  type BotSummary,
  EnvironmentId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadShell,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { type BoardSources, deriveBoard, taskThread, unfiledTasks } from "./BotBoard.ts";
import { renderBotContext } from "./BotContext.ts";
import * as BotStore from "./BotStore.ts";

/** Reads a bot's board from its store and the threads it points at. */
export class BotBoards extends Context.Service<
  BotBoards,
  {
    readonly sources: (
      bot: BotName,
      options?: {
        readonly includeClosed?: boolean | undefined;
        /** Already read by the caller, saving a second read of the bot's thread. */
        readonly tasks?: ReadonlyArray<OrchestrationV2Subagent> | undefined;
      },
    ) => Effect.Effect<BoardSources, BotError>;
    readonly summaries: Effect.Effect<ReadonlyArray<BotSummary>, BotError>;
    /** The context a bot's turn starts with; the rules alone when its store cannot be read. */
    readonly context: (
      botThreadId: ThreadId,
      tasks: ReadonlyArray<OrchestrationV2Subagent>,
    ) => Effect.Effect<string>;
  }
>()("t3/bots/BotBoards") {}

const make = Effect.gen(function* () {
  const store = yield* BotStore.BotStore;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  // Orchestration test harnesses run without an environment; their bots have no linked machines.
  const environment = yield* Effect.serviceOption(ServerEnvironment.ServerEnvironment);
  const hereId = Option.isSome(environment)
    ? yield* environment.value.getEnvironmentId
    : EnvironmentId.make("here");

  const readTasks = (bot: BotName) =>
    store.getBot(bot).pipe(
      Effect.flatMap((record) =>
        record?.threadId == null
          ? Effect.succeed([])
          : projections.getThreadRecords(record.threadId, ["subagents"]).pipe(
              Effect.map(({ subagents }) => subagents),
              Effect.orElseSucceed((): ReadonlyArray<OrchestrationV2Subagent> => []),
            ),
      ),
    );

  const sources: BotBoards["Service"]["sources"] = Effect.fn("BotBoards.sources")(
    function* (bot, options) {
      const items = yield* store.listItems(bot, { includeClosed: options?.includeClosed });
      const links = yield* store.itemThreads(items.map((item) => item.id));
      const tasks = options?.tasks ?? (yield* readTasks(bot));
      const here = new Set<ThreadId>([
        ...links.flatMap((link) => (link.environmentId === hereId ? [link.threadId] : [])),
        ...tasks.flatMap((task) => {
          const thread = taskThread(task, hereId);
          return thread?.environmentId === hereId ? [thread.threadId] : [];
        }),
      ]);
      const shells = new Map<ThreadId, OrchestrationV2ThreadShell | null>();
      for (const threadId of here)
        shells.set(
          threadId,
          yield* projections.getThreadShell(threadId).pipe(Effect.orElseSucceed(() => null)),
        );
      const episodes = yield* store.latestEpisodes(links);
      return { hereId, now: yield* DateTime.now, items, links, episodes, tasks, shells };
    },
  );

  const summaries: BotBoards["Service"]["summaries"] = store.listBots.pipe(
    Effect.flatMap((bots) =>
      Effect.forEach(bots, (bot) =>
        store.listItems(bot.name).pipe(
          Effect.map((items): BotSummary => ({
            name: bot.name,
            purpose: bot.purpose,
            threadId: bot.threadId,
            openItems: items.length,
          })),
        ),
      ),
    ),
  );

  const context: BotBoards["Service"]["context"] = Effect.fn("BotBoards.context")(
    function* (botThreadId, tasks) {
      const bot = yield* store.botForThread(botThreadId);
      const others = (yield* summaries).filter((other) => other.name !== bot?.name);
      if (bot === null)
        return renderBotContext({
          bot: null,
          others,
          items: [],
          unfiled: [],
          now: DateTime.formatIso(yield* DateTime.now),
        });
      const board = yield* sources(bot.name, { tasks });
      return renderBotContext({
        bot,
        others,
        items: deriveBoard(board),
        unfiled: unfiledTasks(board),
        now: DateTime.formatIso(board.now),
      });
    },
    (effect, botThreadId) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.logWarning("bot context unavailable", { botThreadId, error }).pipe(
            Effect.andThen(DateTime.now),
            Effect.map((now) =>
              renderBotContext({
                bot: null,
                others: [],
                items: [],
                unfiled: [],
                now: DateTime.formatIso(now),
              }),
            ),
          ),
        ),
      ),
  );

  return BotBoards.of({ sources, summaries, context });
});

const layer = Layer.effect(BotBoards, make);

/** With its store and projections; layers memoize by reference, so every user shares one store. */
export const layerProvided = layer.pipe(
  Layer.provideMerge(BotStore.layer),
  Layer.provide(ProjectionStore.layer),
);
