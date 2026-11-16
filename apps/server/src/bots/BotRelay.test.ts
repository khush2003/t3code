import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as BotRelay from "./BotRelay.ts";
import * as BotStore from "./BotStore.ts";

const rover = BotName.make("rover");
const manager = BotName.make("manager");
const roverThread = ThreadId.make("bot:rover");
const managerThread = ThreadId.make("bot:manager");
const run = RunId.make("run-1");

const message = (id: string, role: "user" | "assistant", text: string) => ({
  id,
  role,
  streaming: false,
  text,
});

describe("BotRelay.answer", () => {
  it.effect("takes a bot's last message back to the bot that told it something, once", () =>
    Effect.gen(function* () {
      const messages = yield* Ref.make<ReadonlyArray<ReturnType<typeof message>>>([]);
      const sent = yield* Ref.make<ReadonlyArray<{ threadId: string; text: string }>>([]);
      yield* Effect.gen(function* () {
        const store = yield* BotStore.BotStore;
        const relay = yield* BotRelay.BotRelay;
        yield* store.ensureBot({ name: rover, purpose: "p", charter: "c", oversees: true });
        yield* store.setThread(rover, roverThread);
        yield* store.ensureBot({ name: manager, purpose: "p", charter: "c" });
        yield* store.setThread(manager, managerThread);

        // A turn its person started owes no bot an answer.
        yield* Ref.set(messages, [message("u1", "user", "hi"), message("a1", "assistant", "Hi.")]);
        yield* relay.answer(managerThread, run, "completed");
        expect(yield* Ref.get(sent)).toEqual([]);

        yield* store.addBotMessage({ from: rover, to: manager, messageId: "tell-1" });
        yield* Ref.set(messages, [
          message("tell-1", "user", 'From the bot "rover": where does the website stand?'),
          message("a2", "assistant", "I'll read the thread."),
          message("a3", "assistant", "Only the sound picks are left."),
        ]);
        yield* relay.answer(managerThread, run, "completed");
        yield* relay.answer(managerThread, run, "completed");
        const [answer, ...rest] = yield* Ref.get(sent);
        expect(rest).toEqual([]);
        expect(answer?.threadId).toBe(roverThread);
        expect(answer?.text).toContain('The bot "manager" answers');
        expect(answer?.text).toContain("Only the sound picks are left.");
        expect(answer?.text).not.toContain("I'll read the thread.");

        // A turn that ended with nothing said still tells the bot that is waiting.
        yield* store.addBotMessage({ from: rover, to: manager, messageId: "tell-2" });
        yield* Ref.set(messages, [message("tell-2", "user", 'From the bot "rover": and now?')]);
        yield* relay.answer(managerThread, run, "interrupted");
        expect((yield* Ref.get(sent))[1]?.text).toContain("without an answer (interrupted)");
      }).pipe(
        Effect.provide(
          BotRelay.layer.pipe(
            Layer.provideMerge(BotStore.layerMemory),
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                NodeCrypto.layer,
                Layer.mock(Orchestrator.OrchestratorV2)({
                  dispatch: (command) =>
                    Ref.update(sent, (all) => [
                      ...all,
                      command.type === "message.dispatch"
                        ? { threadId: command.threadId, text: command.text }
                        : { threadId: "", text: command.type },
                    ]).pipe(Effect.as({ sequence: 0 } as never)),
                }),
                Layer.mock(ProjectionStore.ProjectionStoreV2)({
                  getThreadRecords: () =>
                    Ref.get(messages).pipe(Effect.map((all) => ({ messages: all }) as never)),
                }),
              ),
            ),
          ),
        ),
      );
    }),
  );
});
