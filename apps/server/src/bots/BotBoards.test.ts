import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as BotBoards from "./BotBoards.ts";
import * as BotStore from "./BotStore.ts";

const layer = BotBoards.layer.pipe(
  Layer.provideMerge(BotStore.layerMemory),
  Layer.provide(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadRecords: () => Effect.succeed({ subagents: [] } as never),
      getThreadShell: () =>
        Effect.succeed({ deletedAt: null, archivedAt: null, title: "Powerups plan" } as never),
    }),
  ),
  Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);
const atlas = BotName.make("atlas");
const threadId = ThreadId.make("bot:atlas");

describe("BotBoards.context", () => {
  it.effect("shows a bot that oversees the others what each of them has open", () =>
    Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const boards = yield* BotBoards.BotBoards;
      const chief = BotName.make("chief");
      yield* store.ensureBot({ name: chief, purpose: "Everything", charter: "c", oversees: true });
      yield* store.setThread(chief, ThreadId.make("bot:chief"));
      yield* store.ensureBot({ name: atlas, purpose: "Ship it", charter: "c" });
      yield* store.setThread(atlas, threadId);
      yield* store.saveItem(atlas, { title: "Fix the posters" });
      const turn = { runId: "run-1", startedRunIds: new Set<string>() };

      const overseer = yield* boards.context(ThreadId.make("bot:chief"), [], turn);
      expect(overseer).toContain("You oversee the other bots");
      expect(overseer).toContain("- atlas: 1 open");
      expect(overseer).toContain("Fix the posters (0 working)");
      const other = yield* boards.context(threadId, [], turn);
      expect(other).toContain("- chief, oversees the other bots: Everything");
      expect(other).not.toContain("other-bots-work");

      // The twelfth message in an hour is the last one a bot may send another.
      const since = "1960-01-01T00:00:00.000Z";
      const told = (from: BotName, to: BotName, messageId: string) =>
        store.addBotMessage({ from, fromThreadId: ThreadId.make(`bot:${from}`), to, messageId });
      yield* told(chief, atlas, "m1");
      yield* told(atlas, chief, "m2");
      yield* told(chief, atlas, "m3");
      expect(yield* store.countBotMessages(chief, atlas, since)).toBe(2);
      expect(yield* store.countBotMessages(atlas, chief, since)).toBe(1);
      expect(yield* store.countBotMessages(chief, atlas, "2999-01-01T00:00:00.000Z")).toBe(0);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("sends the charter only to a session that does not hold it", () =>
    Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const boards = yield* BotBoards.BotBoards;
      yield* store.ensureBot({ name: atlas, purpose: "Ship it", charter: "Prefers small PRs." });
      yield* store.setThread(atlas, threadId);
      const hasCharter = (runId: string, started: ReadonlyArray<string>) =>
        boards
          .context(threadId, [], { runId, startedRunIds: new Set(started) })
          .pipe(Effect.map((text) => text.includes("Prefers") || text.includes("Ships daily")));

      expect(yield* hasCharter("run-1", [])).toBe(true);
      // run-1 never reached the model, and a run tried again proves nothing either.
      expect(yield* hasCharter("run-2", [])).toBe(true);
      expect(yield* hasCharter("run-2", ["run-2"])).toBe(true);
      expect(yield* hasCharter("run-3", ["run-2"])).toBe(false);

      yield* store.setCharter(atlas, "Ships daily.");
      expect(yield* hasCharter("run-4", ["run-2", "run-3"])).toBe(true);
      expect(yield* hasCharter("run-5", ["run-4"])).toBe(false);

      // A fresh session holds nothing, whatever an earlier one was sent.
      const fresh = yield* boards.context(threadId, [], {
        runId: "run-5b",
        startedRunIds: new Set(["run-4", "run-5"]),
        fresh: true,
      });
      expect(fresh).toContain("Ships daily");
      expect(fresh).toContain("fresh session");

      yield* store.markContextLost(threadId);
      expect(yield* hasCharter("run-6", ["run-4", "run-5", "run-5b"])).toBe(true);
      expect((yield* store.charterHistory(atlas)).map((past) => past.charter)).toEqual([
        "Prefers small PRs.",
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("keeps a session per conversation and one charter for all of them", () =>
    Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const boards = yield* BotBoards.BotBoards;
      const beside = ThreadId.make("bot:atlas:t:1");
      yield* store.ensureBot({ name: atlas, purpose: "Ship it", charter: "Prefers small PRs." });
      yield* store.setThread(atlas, threadId);
      yield* store.addConversation({
        threadId: beside,
        bot: atlas,
        title: "Powerups plan",
        anchor: { messageId: "m1", text: "where are we on powerups?" },
      });
      expect((yield* store.botForThread(beside))?.name).toBe(atlas);
      const context = (thread: ThreadId, runId: string, started: ReadonlyArray<string>) =>
        boards.context(thread, [], { runId, startedRunIds: new Set(started) });

      const main = yield* context(threadId, "main-1", []);
      expect(main).toContain("Prefers small PRs.");
      expect(main).toContain('the thread "Powerups plan"');
      expect(main).not.toContain("<this-thread");
      // The main chat holding the charter says nothing about the thread's session.
      const thread = yield* context(beside, "beside-1", ["main-1"]);
      expect(thread).toContain("Prefers small PRs.");
      expect(thread).toContain('<this-thread title="Powerups plan">');
      expect(thread).toContain("where are we on powerups?");
      expect(thread).toContain("your main chat");
      expect(yield* context(threadId, "main-2", ["main-1"])).not.toContain("Prefers");
      expect(yield* context(beside, "beside-2", ["beside-1"])).not.toContain("Prefers");

      // A charter changed in one conversation reaches the other on its next turn.
      yield* store.setCharter(atlas, "Ships daily.");
      expect(yield* context(beside, "beside-3", ["beside-1", "beside-2"])).toContain("Ships daily");
      expect(yield* context(threadId, "main-3", ["main-1", "main-2"])).toContain("Ships daily");
    }).pipe(Effect.provide(layer)),
  );
});
