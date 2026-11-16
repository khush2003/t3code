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
      yield* store.addBotMessage({ from: chief, to: atlas, messageId: "m1" });
      yield* store.addBotMessage({ from: atlas, to: chief, messageId: "m2" });
      yield* store.addBotMessage({ from: chief, to: atlas, messageId: "m3" });
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
});
