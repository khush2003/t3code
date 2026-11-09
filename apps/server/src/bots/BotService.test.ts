import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, ProjectId } from "@t3tools/contracts";
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
  const start = (options: {
    readonly shells?: Readonly<Record<string, Record<string, unknown>>>;
    readonly providers?: ReadonlyArray<unknown>;
    readonly launched: Array<Record<string, unknown>>;
    readonly dispatched: Array<Record<string, unknown>>;
  }) =>
    Effect.gen(function* () {
      const service = yield* BotService.BotService;
      return yield* service.start({ name: BotName.make("atlas"), purpose: "Ship the app" });
    }).pipe(
      Effect.provide(
        BotService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(BotBoards.BotBoards)({}),
              Layer.mock(ThreadManagementService.ThreadManagementService)({
                getThreadShell: (threadId: string) =>
                  Effect.succeed((options.shells?.[threadId] ?? null) as never),
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
