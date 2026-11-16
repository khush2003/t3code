import { type BotName, CommandId, MessageId, type RunId, type ThreadId } from "@t3tools/contracts";
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

const ANSWER_CHARS = 20_000;
/** An answer older than this is no longer owed after a restart. */
const OWED_FOR = Duration.days(1);
const RUN_ENDED = new Set(["completed", "failed", "cancelled", "interrupted"]);

/** What a bot reads when another bot tells it something. */
export const renderBotMessage = (from: BotName, message: string) =>
  `From the bot "${from}": ${message}\n\n(Your last message this turn is sent back to ${from} by itself, so write it for ${from} and put in it everything ${from} asked for. Do not call t3_bot_tell for it. When the work ends in a later turn, tell ${from} then with t3_bot_tell.)`;

const renderAnswer = (from: BotName, said: string | undefined, status: string) =>
  said === undefined
    ? `The bot "${from}" ended its turn on what you told it without an answer (${status}). Tell it again when you still need one, and tell your person when this holds their work up.`
    : `The bot "${from}" answers what you told it:\n\n${said.length <= ANSWER_CHARS ? said : `${said.slice(0, ANSWER_CHARS)}…`}\n\n(This is its answer and it is not waiting on you. Carry on with what you needed it for, and tell your person what matters in it.)`;

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
        const sender = yield* store.getBot(message.from);
        if (sender !== null && sender.threadId !== null)
          yield* engine.dispatch({
            type: "message.dispatch",
            // One answer per message, however often the run's end is seen.
            commandId: CommandId.make(`server:bot-answer:${message.id}`),
            threadId: sender.threadId,
            messageId: MessageId.make(`message:bot-answer:${message.id}`),
            senderThreadId: botThreadId,
            text: renderAnswer(bot.name, said, status),
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
