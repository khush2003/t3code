import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as BotBoards from "./BotBoards.ts";
import * as BotService from "./BotService.ts";
import * as BotStore from "./BotStore.ts";

const claude = {
  driver: "claudeAgent",
  instanceId: "claude",
  enabled: true,
  status: "ready",
  models: [{ slug: "claude-opus-5-5" }, { slug: "claude-sonnet-5-5", isDefault: true }],
};
const shellOf = (fields: Record<string, unknown>) => ({
  deletedAt: null,
  archivedAt: null,
  ...fields,
});

describe("BotService.start", () => {
  const store = BotStore.layerMemory.pipe(
    Layer.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer)),
  );
  const start = <A = { readonly threadId: string; readonly created: boolean }, E = never>(
    options: {
      readonly shells?: Readonly<Record<string, Record<string, unknown>>>;
      readonly providers?: ReadonlyArray<unknown>;
      readonly messages?: ReadonlyArray<{ readonly id: string; readonly text: string }>;
      readonly launched: Array<Record<string, unknown>>;
      readonly dispatched: Array<Record<string, unknown>>;
    },
    after?: (
      service: BotService.BotService["Service"],
      store: BotStore.BotStore["Service"],
    ) => Effect.Effect<A, E>,
  ) =>
    Effect.gen(function* () {
      const service = yield* BotService.BotService;
      const started = yield* service.start({
        name: BotName.make("atlas"),
        purpose: "Ship the app",
      });
      return after === undefined ? (started as A) : yield* after(service, yield* BotStore.BotStore);
    }).pipe(
      Effect.provide(
        BotService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              // Every stored conversation counts as live here.
              Layer.effect(
                BotBoards.BotBoards,
                Effect.map(
                  BotStore.BotStore,
                  (stored) =>
                    ({
                      conversations: stored.conversations,
                      summaries: Effect.succeed([]),
                    }) as never,
                ),
              ).pipe(Layer.provide(store)),
              Layer.mock(ThreadManagementService.ThreadManagementService)({
                getThreadShell: (threadId: string) =>
                  Effect.succeed((options.shells?.[threadId] ?? null) as never),
                getThreadRecords: (_threadId, _fields, filter) =>
                  Effect.succeed({
                    messages: (options.messages ?? []).filter((message) =>
                      filter?.messageIds?.includes(message.id as never),
                    ),
                  } as never),
                dispatch: (command) => {
                  options.dispatched.push(command);
                  return Effect.succeed({} as never);
                },
              }),
              NodeCrypto.layer,
              Layer.mock(ThreadLaunchService.ThreadLaunchService)({
                launch: (input) => {
                  options.launched.push({ ...input });
                  return Effect.succeed({} as never);
                },
              }),
              Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                ensureScratchProject: Effect.succeed({ projectId: ProjectId.make("scratch") }),
              } as never),
              Layer.mock(ProjectService.ProjectService)({ getById: () => Effect.succeedNone }),
              Layer.mock(ProviderRegistry.ProviderRegistry)({
                getProviders: Effect.succeed((options.providers ?? [claude]) as never),
              }),
              ServerSettings.layerTest(),
            ),
          ),
          Layer.provideMerge(store),
        ),
      ),
    );

  it.effect("starts one Claude thread in Scratch with a charter, and reopens it afterwards", () =>
    Effect.gen(function* () {
      const launched: Array<Record<string, unknown>> = [];
      const dispatched: Array<Record<string, unknown>> = [];
      expect(yield* start({ launched, dispatched })).toEqual({
        threadId: "bot:atlas",
        created: true,
      });
      expect(launched[0]).toMatchObject({
        threadId: "bot:atlas",
        projectId: "scratch",
        bot: true,
        modelSelection: { instanceId: "claude", model: "claude-sonnet-5-5" },
      });
      expect(launched[0]).not.toHaveProperty("animaName");

      const again = yield* start({ launched, dispatched, shells: { "bot:atlas": shellOf({}) } });
      expect(again).toEqual({ threadId: "bot:atlas", created: false });
      expect(launched).toHaveLength(1);
      expect(dispatched).toHaveLength(0);
    }),
  );

  it.effect("opens a thread from a message of the main chat, on the bot's current model", () =>
    Effect.gen(function* () {
      const launched: Array<Record<string, unknown>> = [];
      const opus = { instanceId: "claude", model: "claude-opus-5-5" };
      const options = {
        launched,
        dispatched: [],
        // The bot exists already, and its person moved it to another model since.
        shells: { "bot:atlas": shellOf({ projectId: "scratch", modelSelection: opus }) },
        messages: [{ id: "m1", text: "where are we on powerups?\nteam needs the plan today" }],
      };
      const main = ThreadId.make("bot:atlas");
      const opened = yield* start(options, (service, store) =>
        Effect.gen(function* () {
          const { threadId } = yield* service.startThread({
            threadId: main,
            anchorMessageId: "m1",
          });
          // Replying to the same message again opens the thread it already has.
          expect(yield* service.startThread({ threadId: main, anchorMessageId: "m1" })).toEqual({
            threadId,
          });
          return {
            threadId,
            bot: (yield* store.botForThread(threadId))?.name,
            conversation: yield* store.conversation(threadId),
          };
        }),
      );
      expect(opened.threadId).toMatch(/^bot:atlas:t:/);
      expect(opened.bot).toBe("atlas");
      expect(opened.conversation).toMatchObject({
        title: "where are we on powerups?",
        anchor: { messageId: "m1", text: "where are we on powerups?\nteam needs the plan today" },
      });
      expect(launched).toEqual([
        expect.objectContaining({
          threadId: opened.threadId,
          title: "where are we on powerups?",
          bot: true,
          modelSelection: opus,
        }),
      ]);

      const missing = yield* start(options, (service) =>
        service.startThread({ threadId: main, anchorMessageId: "nope" }).pipe(Effect.flip),
      );
      expect(missing._tag).toBe("BotRejectedError");
      expect(launched).toHaveLength(1);
    }),
  );

  it.effect("restores an archived bot and starts past a deleted one", () =>
    Effect.gen(function* () {
      const launched: Array<Record<string, unknown>> = [];
      const dispatched: Array<Record<string, unknown>> = [];
      yield* start({
        launched,
        dispatched,
        shells: { "bot:atlas": shellOf({ archivedAt: "2026-11-01T00:00:00.000Z" }) },
      });
      expect(dispatched[0]).toMatchObject({ type: "thread.unarchive", threadId: "bot:atlas" });
      expect(launched).toHaveLength(0);

      const next = yield* start({
        launched,
        dispatched,
        shells: { "bot:atlas": shellOf({ deletedAt: "2026-11-01T00:00:00.000Z" }) },
      });
      expect(next).toEqual({ threadId: "bot:atlas:2", created: true });
    }),
  );

  it.effect("refuses when Claude is not set up", () =>
    Effect.gen(function* () {
      const error = yield* start({
        launched: [],
        dispatched: [],
        providers: [{ ...claude, driver: "codex" }],
      }).pipe(Effect.flip);
      expect(error).toMatchObject({ _tag: "BotRejectedError" });
    }),
  );
});
