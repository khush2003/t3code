import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, EnvironmentId, OrchestratorMcpFailure, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as BotJournal from "./BotJournal.ts";
import * as BotStore from "./BotStore.ts";

const here = EnvironmentId.make("here");
const laptop = EnvironmentId.make("laptop");
const atlas = BotName.make("atlas");
const botThread = ThreadId.make("bot:atlas");

describe("BotJournal.copyFinished", () => {
  it.effect("copies finished threads, and owes one whose machine cannot be reached", () =>
    Effect.gen(function* () {
      const laptopUp = yield* Ref.make(false);
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* Effect.gen(function* () {
        const store = yield* BotStore.BotStore;
        const journal = yield* BotJournal.BotJournal;
        const bot = yield* store.ensureBot({ name: atlas, purpose: "p", charter: "c" });
        yield* store.setThread(atlas, botThread);
        const episode = (environmentId: EnvironmentId, threadId: string, runKey: string) =>
          store.recordEpisode({
            environmentId,
            threadId: ThreadId.make(threadId),
            bot: atlas,
            runKey,
            title: threadId,
            where: "app",
            outcome: "completed",
            startedAt: null,
            endedAt: now,
            result: "done",
          });
        yield* episode(here, "local", "task-1");
        yield* episode(laptop, "remote", "task-2");
        const owner = { ...bot, threadId: botThread };

        expect(yield* journal.copyFinished(owner)).toBe(1);
        expect((yield* store.recall(atlas, "migration", 5)).map((hit) => hit.threadId)).toEqual([
          "local",
        ]);
        // Nothing new here, and the laptop is still owed.
        expect(yield* journal.copyFinished(owner)).toBe(0);
        yield* Ref.set(laptopUp, true);
        expect(yield* journal.copyFinished(owner)).toBe(1);
        expect(
          (yield* store.recall(atlas, "migration", 5)).map((hit) => hit.threadId).toSorted(),
        ).toEqual(["local", "remote"]);
        expect(yield* journal.copyFinished(owner)).toBe(0);
      }).pipe(
        Effect.provide(
          BotJournal.layer.pipe(
            Layer.provideMerge(BotStore.layerMemory),
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                NodeCrypto.layer,
                Layer.mock(Orchestrator.OrchestratorV2)({}),
                Layer.mock(ServerEnvironment.ServerEnvironment)({
                  getEnvironmentId: Effect.succeed(here),
                }),
                Layer.mock(ProjectionStore.ProjectionStoreV2)({
                  getThreadRecords: () =>
                    Effect.succeed({
                      messages: [
                        {
                          id: "m1",
                          role: "assistant",
                          streaming: false,
                          text: "The migration ran clean.",
                          createdAt: DateTime.makeUnsafe(now),
                        },
                        { id: "m2", role: "system", streaming: false, text: "migration note" },
                      ],
                    } as never),
                }),
                Layer.mock(RemoteDelegation.RemoteDelegation)({
                  readTranscript: () =>
                    Ref.get(laptopUp).pipe(
                      Effect.flatMap((up) =>
                        up
                          ? Effect.succeed([
                              {
                                id: "r1",
                                role: "assistant" as const,
                                createdAt: now,
                                text: "Migration checked on the laptop.",
                              },
                            ])
                          : Effect.fail(
                              new OrchestratorMcpFailure({
                                code: "orchestration_error",
                                message: "asleep",
                              }),
                            ),
                      ),
                    ),
                }),
              ),
            ),
          ),
        ),
      );
    }),
  );
});
