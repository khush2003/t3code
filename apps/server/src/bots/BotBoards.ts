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
import { BOT_SPOKEN_PREFIX } from "@t3tools/shared/botShow";

import { type BoardSources, deriveBoard, taskThread, unfiledTasks } from "./BotBoard.ts";
import { renderBotContext, renderBotStanding } from "./BotContext.ts";
import * as BotStore from "./BotStore.ts";

/** Reads a bot's board from its store and the threads it points at. */
export class BotBoards extends Context.Service<
  BotBoards,
  {
    readonly sources: (
      bot: BotName,
      options?: {
        readonly includeClosed?: boolean | undefined;
        /** Every conversation's tasks, when the caller has them already. */
        readonly tasks?: ReadonlyArray<OrchestrationV2Subagent> | undefined;
      },
    ) => Effect.Effect<BoardSources, BotError>;
    readonly summaries: Effect.Effect<ReadonlyArray<BotSummary>, BotError>;
    /** A bot's conversations that are neither settled nor deleted, its main chat first. */
    readonly conversations: (
      bot: BotName,
    ) => Effect.Effect<ReadonlyArray<BotStore.BotConversation>, BotError>;
    /**
     * The context a bot's turn starts with, or "" when its store cannot be read. The charter
     * and full board go only to a session that does not hold them: `startedRunIds` shows
     * whether the run that last carried them ever reached the model.
     */
    /**
     * Whether the bot's person is at the screen that shows their bots: the last thing they said
     * to it came from there, a short while ago. Turns a task or another bot started in between
     * do not change that, so the bot can still show them what came back.
     */
    readonly atScreen: (botThreadId: ThreadId) => Effect.Effect<boolean>;
    readonly context: (
      botThreadId: ThreadId,
      tasks: ReadonlyArray<OrchestrationV2Subagent>,
      turn: {
        readonly runId: string;
        readonly startedRunIds: ReadonlySet<string>;
        /** The session is new, so it holds nothing whatever was sent before. */
        readonly fresh?: boolean;
      },
    ) => Effect.Effect<string>;
  }
>()("t3/bots/BotBoards") {}

const NO_LOOK = { icon: null, color: null, avatarAttachmentId: null };
/** How far back to look for the person's last message among turns that others started. */
const RUNS_BACK = 12;
/** After this long without a word from the screen, the person is taken to have left it. */
const AT_SCREEN_MS = 20 * 60_000;

const make = Effect.gen(function* () {
  const store = yield* BotStore.BotStore;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  // Orchestration test harnesses run without an environment; their bots have no linked machines.
  const environment = yield* Effect.serviceOption(ServerEnvironment.ServerEnvironment);
  const hereId = Option.isSome(environment)
    ? yield* environment.value.getEnvironmentId
    : EnvironmentId.make("here");

  // Every conversation's tasks are on the one board, settled conversations included.
  const readTasks = (bot: BotName, except?: ThreadId) =>
    store.conversations(bot).pipe(
      Effect.flatMap((all) =>
        Effect.forEach(
          all.filter((conversation) => conversation.threadId !== except),
          (conversation) =>
            projections.getThreadRecords(conversation.threadId, ["subagents"]).pipe(
              Effect.map(({ subagents }) => subagents),
              Effect.orElseSucceed((): ReadonlyArray<OrchestrationV2Subagent> => []),
            ),
        ),
      ),
      Effect.map((tasks) => tasks.flat()),
    );

  const conversations: BotBoards["Service"]["conversations"] = Effect.fn("BotBoards.conversations")(
    function* (bot) {
      const live: Array<BotStore.BotConversation> = [];
      for (const conversation of yield* store.conversations(bot)) {
        const shell = yield* projections
          .getThreadShell(conversation.threadId)
          .pipe(Effect.orElseSucceed(() => null));
        // A thread renamed in T3 goes by its new name.
        if (shell !== null && shell.deletedAt === null && shell.archivedAt === null)
          live.push(
            conversation.title === "" ? conversation : { ...conversation, title: shell.title },
          );
      }
      return live;
    },
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
      const files = yield* store.itemFiles(items.map((item) => item.id));
      return { hereId, now: yield* DateTime.now, items, links, files, episodes, tasks, shells };
    },
  );

  const summaries: BotBoards["Service"]["summaries"] = Effect.all([
    store.listBots,
    store.looks,
  ]).pipe(
    Effect.flatMap(([bots, looks]) =>
      Effect.forEach(bots, (bot) =>
        store.listItems(bot.name).pipe(
          Effect.map((items): BotSummary => ({
            name: bot.name,
            purpose: bot.purpose,
            threadId: bot.threadId,
            openItems: items.length,
            waitingOnYou: items.filter((item) => item.waitingOnPerson).length,
            oversees: bot.oversees,
            look: looks.get(bot.name) ?? NO_LOOK,
            threads: [],
          })),
        ),
      ),
    ),
  );

  const context: BotBoards["Service"]["context"] = Effect.fn("BotBoards.context")(
    function* (botThreadId, tasks, turn) {
      const here = yield* store.conversation(botThreadId);
      const bot = here === null ? null : yield* store.getBot(here.bot);
      if (here === null || bot === null) return "";
      const standing = renderBotStanding(
        bot,
        (yield* summaries).filter((other) => other.name !== bot.name),
        yield* store.activeNotes(bot.name),
        {
          here,
          others: (yield* conversations(bot.name)).filter(
            (other) => other.threadId !== botThreadId,
          ),
        },
      );
      const { sent, runId, due } = here.context;
      // A run retried is sent it again: nothing shows its first try reached the model.
      const held =
        turn.fresh !== true &&
        !due &&
        sent === standing &&
        runId !== null &&
        runId !== turn.runId &&
        turn.startedRunIds.has(runId);
      if (!held) yield* store.setContextSent(botThreadId, standing, turn.runId);
      const board = yield* sources(bot.name, {
        tasks: [...tasks, ...(yield* readTasks(bot.name, botThreadId))],
      });
      const others = bot.oversees
        ? yield* Effect.forEach(
            (yield* store.listBots).filter((other) => other.name !== bot.name),
            (other) =>
              sources(other.name).pipe(
                Effect.map((theirs) => ({ name: other.name, items: deriveBoard(theirs) })),
              ),
          )
        : undefined;
      return renderBotContext({
        standing: held ? undefined : standing,
        fresh: turn.fresh === true,
        ...(others === undefined ? {} : { others }),
        items: deriveBoard(board),
        unfiled: unfiledTasks(board),
        now: DateTime.formatIso(board.now),
      });
    },
    (effect, botThreadId) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.logWarning("bot context unavailable", { botThreadId, error }).pipe(Effect.as("")),
        ),
      ),
  );

  const atScreen: BotBoards["Service"]["atScreen"] = Effect.fn("BotBoards.atScreen")(
    function* (botThreadId) {
      const { runs } = yield* projections.getThreadRecords(botThreadId, ["runs"], {
        latestRunLimit: RUNS_BACK,
      });
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      for (const run of runs.toReversed()) {
        const message = yield* projections.getRunMessage(botThreadId, run.id);
        // A task ending or another bot answering starts a turn too; those are not the person.
        if (
          message === undefined ||
          message.notification !== undefined ||
          message.senderThreadId !== undefined
        )
          continue;
        return (
          message.text.startsWith(BOT_SPOKEN_PREFIX) &&
          now - DateTime.toEpochMillis(run.requestedAt) <= AT_SCREEN_MS
        );
      }
      return false;
    },
    // Unknown is no: a bot told it showed something nobody can see would say so to its person.
    (effect) => effect.pipe(Effect.orElseSucceed(() => false)),
  );

  return BotBoards.of({ sources, summaries, conversations, atScreen, context });
});

export const layer = Layer.effect(BotBoards, make);

/** With its store and projections; layers memoize by reference, so every user shares one store. */
export const layerProvided = layer.pipe(
  Layer.provideMerge(BotStore.layer),
  Layer.provide(ProjectionStore.layer),
);
