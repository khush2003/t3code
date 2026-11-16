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
  Layer.provide(Layer.mock(ProjectionStore.ProjectionStoreV2)({})),
  Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);
const atlas = BotName.make("atlas");
const threadId = ThreadId.make("bot:atlas");

describe("BotBoards.context", () => {
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

      yield* store.markContextLost(threadId);
      expect(yield* hasCharter("run-6", ["run-4", "run-5"])).toBe(true);
      expect((yield* store.charterHistory(atlas)).map((past) => past.charter)).toEqual([
        "Prefers small PRs.",
      ]);
    }).pipe(Effect.provide(layer)),
  );
});
