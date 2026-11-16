import {
  BotError,
  type NodeId,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Subagent,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import { forkParked } from "../serverActivation.ts";
import { taskThread } from "./BotBoard.ts";
import * as BotStore from "./BotStore.ts";

const RESULT_CHARS = 20_000;
/** A machine gone this long keeps its thread's messages; the bot still has the result. */
const COPY_WINDOW = Duration.days(14);
const COPY_RETRY = Duration.minutes(10);
const RUN_ENDED = new Set(["completed", "failed", "cancelled", "interrupted"]);

const kept = (
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): ReadonlyArray<BotStore.BotMessage> =>
  messages.flatMap((message) =>
    message.role === "system" || message.streaming || message.text.trim() === ""
      ? []
      : [
          {
            id: message.id,
            role: message.role,
            createdAt: DateTime.formatIso(message.createdAt),
            text:
              message.text.length <= RemoteDelegation.TRANSCRIPT_MESSAGE_CHARS
                ? message.text
                : `${message.text.slice(0, RemoteDelegation.TRANSCRIPT_MESSAGE_CHARS)}…`,
          },
        ],
  );

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
    /**
     * Copies the messages of a bot's finished threads into its store, so they can be searched
     * and read while their machine is offline. A thread that cannot be read now stays owed.
     */
    readonly copyFinished: (bot: BotStore.BotRecord) => Effect.Effect<number>;
    /** Copies the bot's own conversation: one run's messages, or all of them. */
    readonly copyConversation: (botThreadId: ThreadId, runId?: RunId) => Effect.Effect<void>;
  }
>()("t3/bots/BotJournal") {}

const make = Effect.gen(function* () {
  const store = yield* BotStore.BotStore;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const engine = yield* Orchestrator.OrchestratorV2;
  const remote = yield* RemoteDelegation.RemoteDelegation;
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
      if (recorded > 0) yield* copyFinished(bot);
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

  const copyFinished: BotJournal["Service"]["copyFinished"] = Effect.fn("BotJournal.copyFinished")(
    function* (bot) {
      if (bot.threadId === null) return 0;
      const since = DateTime.formatIso(DateTime.subtractDuration(yield* DateTime.now, COPY_WINDOW));
      let copied = 0;
      for (const thread of yield* store.threadsToCopy(bot.name, since)) {
        const unread = (cause: unknown) => new BotError({ operation: "read a thread", cause });
        const messages =
          thread.environmentId === hereId
            ? projections.getThreadRecords(thread.threadId, ["messages"]).pipe(
                Effect.map((records) => kept(records.messages)),
                Effect.mapError(unread),
              )
            : remote
                .readTranscript(bot.threadId, thread.runKey as NodeId)
                .pipe(Effect.mapError(unread));
        yield* messages.pipe(
          Effect.flatMap((found) => store.saveMessages(bot.name, thread, found)),
          Effect.andThen(store.markCopied(thread, thread.endedAt)),
          Effect.andThen(Effect.sync(() => copied++)),
          // Its machine is asleep or the thread is gone: owed until the window closes.
          Effect.catch((error) =>
            Effect.logDebug("bot journal could not copy a thread yet", { thread, error }),
          ),
        );
      }
      return copied;
    },
    (effect, bot) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.logWarning("bot journal could not copy threads", { bot: bot.name, error }).pipe(
            Effect.as(0),
          ),
        ),
      ),
  );

  const copyConversation: BotJournal["Service"]["copyConversation"] = Effect.fn(
    "BotJournal.copyConversation",
  )(
    function* (botThreadId, runId) {
      const bot = yield* store.botForThread(botThreadId);
      if (bot === null) return;
      const { messages } = yield* projections.getThreadRecords(
        botThreadId,
        ["messages"],
        runId === undefined ? undefined : { messageRunIds: [runId] },
      );
      yield* store.saveMessages(
        bot.name,
        { environmentId: hereId, threadId: botThreadId },
        kept(messages),
      );
    },
    (effect, botThreadId) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.logWarning("bot journal could not copy a conversation", { botThreadId, error }),
        ),
      ),
  );

  const start: BotJournal["Service"]["start"] = Effect.fn("BotJournal.start")(function* () {
    // Results that ended while this server was down.
    const bots = yield* store.listBots.pipe(Effect.orElseSucceed(() => []));
    for (const bot of bots)
      if (bot.threadId !== null) {
        yield* recordFinished(bot.threadId);
        yield* copyConversation(bot.threadId);
      }
    yield* forkParked(
      store.listBots.pipe(
        Effect.orElseSucceed(() => []),
        Effect.flatMap((all) => Effect.forEach(all, copyFinished, { discard: true })),
        Effect.repeat(Schedule.spaced(COPY_RETRY)),
      ),
    );
    yield* forkParked(
      store.backup.pipe(
        Effect.catch((error) => Effect.logWarning("bot memory was not backed up", { error })),
        Effect.repeat(Schedule.spaced(Duration.hours(6))),
      ),
    );
    yield* forkParked(
      // Per domain event; most return at the type check.
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "subagent.updated" && event.payload.result !== null
          ? recordFinished(event.threadId).pipe(Effect.asVoid)
          : // A compacted session may have lost the charter: the next turn sends it again.
            event.type === "turn-item.updated" && event.payload.type === "compaction"
            ? store.markContextLost(event.threadId).pipe(Effect.ignore)
            : event.type === "run.updated" &&
                event.threadId.startsWith("bot:") &&
                RUN_ENDED.has(event.payload.status)
              ? copyConversation(event.threadId, event.payload.id)
              : Effect.void,
      ),
    );
  });

  return BotJournal.of({ start, recordFinished, copyFinished, copyConversation });
});

export const layer = Layer.effect(BotJournal, make);
