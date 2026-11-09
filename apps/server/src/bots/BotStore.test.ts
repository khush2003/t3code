import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as BotStore from "./BotStore.ts";

const layer = BotStore.layerMemory.pipe(
  Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);
const atlas = BotName.make("atlas");
const here = EnvironmentId.make("here");

describe("BotStore", () => {
  it.effect("keeps a bot's items, moves a thread between them, and records each result once", () =>
    Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const bot = yield* store.ensureBot({ name: atlas, purpose: "Ship it", charter: "c" });
      expect(yield* store.ensureBot({ name: atlas, purpose: "other", charter: "x" })).toEqual(bot);

      const first = yield* store.saveItem(atlas, { title: "Fix login" });
      const second = yield* store.saveItem(atlas, { title: "Release" });
      const thread = {
        environmentId: here,
        threadId: ThreadId.make("t1"),
        title: "T",
        where: "app",
      };
      yield* store.linkThread(first.id, thread);
      yield* store.linkThread(second.id, thread);
      expect((yield* store.itemThreads([first.id, second.id])).map((link) => link.itemId)).toEqual([
        second.id,
      ]);

      yield* store.saveItem(atlas, { id: first.id, state: "done", nextStep: "none" });
      expect((yield* store.listItems(atlas)).map((item) => item.title)).toEqual(["Release"]);
      expect(yield* store.listItems(atlas, { includeClosed: true })).toHaveLength(2);

      const episode = {
        ...thread,
        bot: atlas,
        runKey: "task-1",
        outcome: "completed",
        startedAt: null,
        endedAt: "2026-11-09T10:00:00.000Z",
        result: "Done.",
      };
      expect(yield* store.recordEpisode(episode)).toBe(true);
      expect(yield* store.recordEpisode({ ...episode, result: "changed" })).toBe(false);
      expect((yield* store.latestEpisodes([thread]))[0]?.result).toBe("Done.");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses to change another bot's item", () =>
    Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const item = yield* store.saveItem(atlas, { title: "Mine" });
      const error = yield* store
        .saveItem(BotName.make("nova"), { id: item.id, title: "Theirs" })
        .pipe(Effect.flip);
      expect(error._tag).toBe("BotError");
    }).pipe(Effect.provide(layer)),
  );
});
