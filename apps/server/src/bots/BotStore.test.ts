import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";

import * as BotStore from "./BotStore.ts";

const layer = BotStore.layerMemory.pipe(
  Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
);
const atlas = BotName.make("atlas");
const here = EnvironmentId.make("here");

describe("BotStore", () => {
  it.effect("searches a bot's copied messages and reads a copied thread", () =>
    Effect.gen(function* () {
      const store = yield* BotStore.BotStore;
      const other = BotName.make("other");
      const posters = { environmentId: here, threadId: ThreadId.make("posters") };
      const item = yield* store.saveItem(atlas, { title: "Launch" });
      yield* store.linkThread(item.id, { ...posters, title: "Fix the posters", where: "site" });
      const message = (id: string, text: string, createdAt = "2026-03-01T10:00:00.000Z") => ({
        id,
        role: "assistant" as const,
        createdAt,
        text,
      });
      yield* store.saveMessages(atlas, posters, [
        message("m1", "The poster fonts were switched to Inter after the review."),
        message("m2", "Exported all posters as PDF.", "2026-03-01T11:00:00.000Z"),
      ]);
      yield* store.saveMessages(other, { environmentId: here, threadId: ThreadId.make("x") }, [
        message("m1", "Posters are not this bot's business."),
      ]);

      // Every word first, any word when none has them all; stemmed, and never search syntax.
      expect((yield* store.recall(atlas, "poster fonts", 5)).map((hit) => hit.messageId)).toEqual([
        "m1",
      ]);
      expect(yield* store.recall(atlas, 'fonts "AND (videos', 5)).toMatchObject([
        { messageId: "m1", title: "Fix the posters", where: "site" },
      ]);
      expect(yield* store.recall(atlas, "!!!", 5)).toEqual([]);

      // A message sent again replaces itself, in the search too.
      yield* store.saveMessages(atlas, posters, [message("m1", "The headings use Geist now.")]);
      expect(yield* store.recall(atlas, "Inter", 5)).toEqual([]);
      expect((yield* store.recall(atlas, "Geist", 5)).map((hit) => hit.messageId)).toEqual(["m1"]);
      expect((yield* store.threadMessages(atlas, posters, 1)).map((hit) => hit.text)).toEqual([
        "Exported all posters as PDF.",
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("backs the store up once a day and keeps the last week", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped({ prefix: "bot-store-" });
      const config = yield* Layer.build(ServerConfig.ServerConfig.layerTest(process.cwd(), base));
      const { stateDir } = Context.get(config, ServerConfig.ServerConfig);
      const directory = path.join(stateDir, "bots-backups");
      yield* Effect.gen(function* () {
        const store = yield* BotStore.BotStore;
        yield* store.ensureBot({ name: atlas, purpose: "Ship it", charter: "c" });
        yield* fs.makeDirectory(directory, { recursive: true });
        // The test clock starts in 1970, so these are the older copies.
        for (let day = 1; day <= 8; day++)
          yield* fs.writeFileString(path.join(directory, `bots-1960-01-0${day}.sqlite`), "old");
        yield* store.backup;
        yield* store.backup;
      }).pipe(Effect.provide(BotStore.layer.pipe(Layer.provide(Layer.succeedContext(config)))));

      const kept = (yield* fs.readDirectory(directory)).toSorted();
      expect(kept).toHaveLength(7);
      expect(kept.slice(0, 6)).toEqual(
        [3, 4, 5, 6, 7, 8].map((day) => `bots-1960-01-0${day}.sqlite`),
      );
      const copy = yield* Layer.build(
        NodeSqliteClient.layer({ filename: path.join(directory, kept[6]!) }),
      );
      const rows = yield* Context.get(copy, SqlClient.SqlClient)<{
        name: string;
      }>`SELECT name FROM bots`;
      expect(rows.map((row) => row.name)).toEqual(["atlas"]);
    }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("opens a store the last version wrote, and keeps what was in it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped({ prefix: "bot-store-" });
      const config = yield* Layer.build(ServerConfig.ServerConfig.layerTest(process.cwd(), base));
      const { stateDir } = Context.get(config, ServerConfig.ServerConfig);
      const open = <A, E>(use: (store: BotStore.BotStore["Service"]) => Effect.Effect<A, E>) =>
        Effect.scoped(
          BotStore.BotStore.pipe(
            Effect.flatMap(use),
            Effect.provide(BotStore.layer.pipe(Layer.provide(Layer.succeedContext(config)))),
          ),
        );
      yield* open((store) =>
        Effect.gen(function* () {
          yield* store.ensureBot({ name: atlas, purpose: "Ship it", charter: "c" });
          yield* store.saveItem(atlas, { title: "Launch", waitingOnPerson: true });
        }),
      );
      // As version 9 left it: items already say what waits, and no bot has a look yet.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const raw = yield* Layer.build(
            NodeSqliteClient.layer({ filename: path.join(stateDir, "bots.sqlite") }),
          );
          const sql = Context.get(raw, SqlClient.SqlClient);
          yield* sql.unsafe("DROP TABLE bot_looks");
          yield* sql.unsafe("PRAGMA user_version = 9");
        }),
      );
      const reopened = yield* open((store) =>
        Effect.gen(function* () {
          yield* store.setLook(atlas, { icon: "rocket", color: "teal", avatarAttachmentId: null });
          return {
            items: yield* store.listItems(atlas),
            look: (yield* store.looks).get(atlas),
          };
        }),
      );
      expect(reopened.items).toMatchObject([{ title: "Launch", waitingOnPerson: true }]);
      expect(reopened.look).toEqual({ icon: "rocket", color: "teal", avatarAttachmentId: null });
    }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
  );

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

      // Waiting on the person holds through a change that does not mention it.
      yield* store.saveItem(atlas, { id: second.id, waitingOnPerson: true });
      expect((yield* store.saveItem(atlas, { id: second.id, nextStep: "x" })).waitingOnPerson).toBe(
        true,
      );
      expect(
        (yield* store.saveItem(atlas, { id: second.id, waitingOnPerson: false })).waitingOnPerson,
      ).toBe(false);

      yield* store.saveItem(atlas, { id: first.id, state: "done", nextStep: "none" });
      expect((yield* store.listItems(atlas)).map((item) => item.title)).toEqual(["Release"]);
      expect(yield* store.listItems(atlas, { includeClosed: true })).toHaveLength(2);

      const episode = {
        ...thread,
        bot: atlas,
        fromThreadId: null,
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
