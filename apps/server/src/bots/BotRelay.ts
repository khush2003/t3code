import { CommandId, MessageId, type RunId, type ThreadId } from "@t3tools/contracts";
import { renderBotAnswer } from "@t3tools/shared/botMessages";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as BotStore from "./BotStore.ts";

/** An answer older than this is no longer owed after a restart. */
const OWED_FOR = Duration.days(1);
const RUN_ENDED = new Set(["completed", "failed", "cancelled", "interrupted"]);

/**
 * Carries a bot's reply back to the bot that told it something. A bot writes its reply in its own
 * conversation, as it does for its person, so nothing arrives unless the server takes it there.
 */
export class BotRelay extends Context.Service<
  BotRelay,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    /** After a bot's run ends: what it said goes to each bot whose message that run carried. */
    readonly answer: (botThreadId: ThreadId, runId: RunId, status: string) => Effect.Effect<void>;
  }
>()("t3/bots/BotRelay") {}

const make = Effect.gen(function* () {
  const store = yield* BotStore.BotStore;
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  const answer: BotRelay["Service"]["answer"] = Effect.fn("BotRelay.answer")(
    function* (botThreadId, runId, status) {
      const bot = yield* store.botForThread(botThreadId);
      if (bot === null) return;
      const { messages } = yield* projections.getThreadRecords(botThreadId, ["messages"], {
        messageRunIds: [runId],
      });
      const told = yield* store.unansweredBotMessages(
        messages.filter((message) => message.role === "user").map((message) => message.id),
      );
      if (told.length === 0) return;
      const said = messages
        .findLast(
          (message) =>
            message.role === "assistant" && !message.streaming && message.text.trim() !== "",
        )
        ?.text.trim();
      for (const message of told) {
        // Back to the conversation that asked, so a thread's question is answered in that thread.
        const askedFrom =
          message.fromThreadId ?? (yield* store.getBot(message.from))?.threadId ?? null;
        if (askedFrom !== null)
          yield* engine.dispatch({
            type: "message.dispatch",
            // One answer per message, however often the run's end is seen.
            commandId: CommandId.make(`server:bot-answer:${message.id}`),
            threadId: askedFrom,
            messageId: MessageId.make(`message:bot-answer:${message.id}`),
            senderThreadId: botThreadId,
            text: renderBotAnswer(bot.name, said, status),
            attachments: [],
            dispatchMode: { type: "queue_after_active" },
            createdBy: "agent",
            creationSource: "server",
          });
        yield* store.markBotMessageAnswered(message.id);
      }
    },
    (effect, botThreadId) =>
      effect.pipe(
        Effect.catch((error) =>
          Effect.logWarning("a bot's answer did not reach the bot that asked", {
            botThreadId,
            error,
          }),
        ),
      ),
  );

  // Runs that ended while this server was down.
  const catchUp = Effect.gen(function* () {
    const since = DateTime.formatIso(DateTime.subtractDuration(yield* DateTime.now, OWED_FOR));
    for (const told of yield* store.unansweredBotMessagesSince(since)) {
      const recipient = yield* store.getBot(told.to);
      if (recipient === null || recipient.threadId === null) continue;
      const { runs } = yield* projections.getThreadRecords(recipient.threadId, ["runs"]);
      const run = runs.find((run) => run.userMessageId === told.messageId);
      if (run !== undefined && RUN_ENDED.has(run.status))
        yield* answer(recipient.threadId, run.id, run.status);
    }
  }).pipe(Effect.catch((error) => Effect.logWarning("bot answers were not caught up", { error })));

  const start: BotRelay["Service"]["start"] = Effect.fn("BotRelay.start")(function* () {
    yield* catchUp;
    yield* forkParked(
      // Per domain event; most return at the type check.
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        event.type === "run.updated" &&
        event.threadId.startsWith("bot:") &&
        RUN_ENDED.has(event.payload.status)
          ? answer(event.threadId, event.payload.id, event.payload.status)
          : Effect.void,
      ),
    );
  });

  return BotRelay.of({ start, answer });
});

export const layer = Layer.effect(BotRelay, make);
