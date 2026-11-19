import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, EnvironmentId, TextGenerationError, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as BotReflection from "./BotReflection.ts";
import * as BotStore from "./BotStore.ts";

const atlas = BotName.make("atlas");
const thread = { environmentId: EnvironmentId.make("here"), threadId: ThreadId.make("bot:atlas") };

describe("BotReflection", () => {
  it("spells a topic the way the bot already does, and drops one too long to be a topic", () => {
    const note = (id: string) => ({ id, text: `On 2026-11-16, ${id} was said. More.` }) as never;
    expect(
      BotReflection.checkLabels(
        {
          labels: [
            { note: "n1", title: "A", topic: "starblast ui" },
            { note: "[N2]", title: "B", topic: "new thing" },
            { note: "n3", title: "C", topic: "New Thing" },
            { note: "n4", title: "D", topic: "a topic that goes on for far too many words" },
          ],
        },
        { notes: ["a", "b", "c", "d"].map(note), topics: ["Starblast UI"] },
      ).map((label) => label.topic),
    ).toEqual(["Starblast UI", "new thing", "new thing", null]);
  });

  it("runs when there is enough new to read, and no more than a pass is worth", () => {
    const now = DateTime.makeUnsafe("2026-11-16T12:00:00.000Z");
    const state = { unread: 3, lastAt: "2026-11-16T09:00:00.000Z", passesSince: 1 };
    const due = (change: object) =>
      BotReflection.reflectionDue({ ...state, itemClosed: false, ...change }, now);
    expect(due({})).toBe(false);
    expect(due({ itemClosed: true })).toBe(true);
    expect(due({ unread: 40 })).toBe(true);
    expect(due({ lastAt: null })).toBe(true);
    expect(due({ lastAt: "2026-11-15T15:00:00.000Z" })).toBe(true);
    expect(due({ itemClosed: true, unread: 0 })).toBe(false);
    expect(due({ itemClosed: true, passesSince: 8 })).toBe(false);
  });

  it.effect("keeps only notes whose quote is in the message they name", () =>
    Effect.gen(function* () {
      const replies = yield* Ref.make<ReadonlyArray<unknown>>([]);
      yield* Effect.gen(function* () {
        const store = yield* BotStore.BotStore;
        const reflection = yield* BotReflection.BotReflection;
        yield* store.ensureBot({ name: atlas, purpose: "p", charter: "c" });
        const say = (id: string, text: string) =>
          store.saveMessages(atlas, thread, [
            { id, role: "user", createdAt: "2026-11-16T10:00:00.000Z", text },
          ]);
        yield* say("u1", "From now on, ship posters as PDF only,\nnever PNG.");
        yield* say("u2", "Thanks, looks good.");

        // The provider fails: nothing is read, so the same messages wait for the next pass.
        expect(yield* reflection.reflect(atlas)).toMatchObject({
          added: 0,
          error: expect.stringContaining("down"),
        });
        expect(yield* store.unreadMessages(atlas, 1_000)).toHaveLength(2);

        yield* Ref.set(replies, [
          {
            add: [
              {
                text: "On 2026-11-16 the person asked for posters as PDF only.",
                message: "m1",
                quote: "ship posters as  PDF only, never PNG",
              },
              { text: "Invented.", message: "m1", quote: "ship videos as MP4 only" },
              { text: "No such message.", message: "m9", quote: "Thanks, looks good." },
            ],
            retire: [{ note: "note:missing", reason: "gone", replacedBy: null }],
          },
          {
            add: [
              {
                text: "On 2026-11-17 the person switched posters to PNG.",
                message: "m3",
                quote: "posters are PNG again",
              },
            ],
            retire: [{ note: "FIRST", reason: "Reversed on 2026-11-17.", replacedBy: 0 }],
          },
        ]);
        expect(yield* reflection.reflect(atlas)).toMatchObject({
          messages: 2,
          added: 1,
          retired: 0,
          rejected: 3,
        });
        const [first] = yield* store.activeNotes(atlas);
        expect(first).toMatchObject({ messageId: "u1", threadId: thread.threadId });
        expect(yield* reflection.reflect(atlas)).toBeNull();

        // A reversal retires the old note and keeps it, pointing at what replaced it.
        yield* say("u3", "Change of plan: posters are PNG again.");
        yield* Ref.update(replies, ([next]) => [
          JSON.parse(JSON.stringify(next).replace("FIRST", first!.id)),
        ]);
        expect(yield* reflection.reflect(atlas)).toMatchObject({ added: 1, retired: 1 });
        const [current] = yield* store.activeNotes(atlas);
        expect(yield* store.activeNotes(atlas)).toHaveLength(1);
        expect(yield* store.searchNotes(atlas, "PDF only", 5)).toMatchObject([
          { id: first!.id, outdatedReason: "Reversed on 2026-11-17.", replacedBy: current!.id },
        ]);

        // What the person wrote themselves is not a pass's to retire.
        yield* store.addUserNote(atlas, thread, "Posters are always A3.", null);
        const mine = (yield* store.activeNotes(atlas)).find((note) => note.author === "user")!;
        yield* say("u4", "Posters are A2 from now on.");
        yield* Ref.set(replies, [
          { add: [], retire: [{ note: mine.id, reason: "Now A2.", replacedBy: null }] },
        ]);
        expect(yield* reflection.reflect(atlas)).toMatchObject({ retired: 0 });
        expect(yield* store.activeNotes(atlas)).toHaveLength(2);

        // An answer that labels nothing is a failure, and leaves the notes to be asked about again.
        yield* Ref.set(replies, [{ labels: [] }]);
        expect(yield* reflection.label(atlas)).toBe(-1);

        // Labelling titles every note it asked about, the skipped one from its own words.
        const order = (yield* store.allNotes(atlas)).map((note) => note.id);
        yield* Ref.set(replies, [
          {
            labels: [
              {
                note: `[n${order.indexOf(mine.id) + 1}]`,
                title: "Posters are always A3.",
                topic: "posters",
              },
              { note: "n9", title: "Not asked about", topic: "Else" },
            ],
          },
        ]);
        // The outdated note is labelled too: it is still listed, under what was forgotten.
        expect(yield* reflection.label(atlas)).toBe(3);
        const labelled = new Map((yield* store.activeNotes(atlas)).map((note) => [note.id, note]));
        expect(labelled.get(mine.id)).toMatchObject({
          title: "Posters are always A3",
          topic: "posters",
        });
        expect(labelled.get(current!.id)).toMatchObject({
          title: "The person switched posters to PNG",
          topic: null,
        });
        expect(yield* reflection.label(atlas)).toBe(0);
      }).pipe(
        Effect.provide(
          BotReflection.layer.pipe(
            Layer.provideMerge(BotStore.layerMemory),
            Layer.provide(
              Layer.mergeAll(
                NodeServices.layer,
                NodeCrypto.layer,
                ServerSettings.layerTest(),
                Layer.succeed(ServerConfig.ServerConfig, { stateDir: "/state" } as never),
                Layer.mock(TextGeneration.TextGeneration)({
                  generateStructured: () =>
                    Ref.modify(replies, ([reply, ...rest]) => [reply, rest]).pipe(
                      Effect.flatMap((reply) =>
                        reply === undefined
                          ? Effect.fail(
                              new TextGenerationError({
                                operation: "generateStructured",
                                detail: "down",
                              }),
                            )
                          : Effect.succeed(reply as never),
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
