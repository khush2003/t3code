import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AnimaService from "./AnimaService.ts";
import * as AnimaThreadService from "./AnimaThreadService.ts";

const run = (
  animaName: string | null | undefined,
  sent: Array<{ text: string; mode: string }>,
  options: {
    readonly archived?: boolean;
    readonly cli?: boolean;
    readonly guide?: string;
    readonly delivery?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const threads = Layer.mock(ThreadManagementService.ThreadManagementService)({
      getThreadShell: (threadId) =>
        Effect.succeed(
          threadId === "t1"
            ? ({
                projectId: ProjectId.make("p1"),
                animaName,
                archivedAt: options.archived === true ? "2026-01-01T00:00:00Z" : null,
              } as never)
            : null,
        ),
      sendToThread: (input) =>
        Effect.sync(() => {
          sent.push({ text: input.text, mode: input.mode });
          return { delivery: options.delivery ?? "started" } as never;
        }),
    });
    const animas = Layer.mock(AnimaService.AnimaService)({
      summary: () => Effect.succeed({ breathCount: 7 } as never),
      cliAvailable: Effect.succeed(options.cli !== false),
      breatheGuide: Effect.succeed(
        options.guide ?? "### Step 2: Run\nbun anima.ts breathe --agent <name>\n",
      ),
    });
    const layer = AnimaThreadService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          threads,
          animas,
          NodeCrypto.layer,
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
          Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({} as never),
          Layer.mock(ProjectService.ProjectService)({}),
          Layer.mock(ProviderRegistry.ProviderRegistry)({}),
          ServerSettings.layerTest(),
        ),
      ),
    );
    const service = yield* AnimaThreadService.AnimaThreadService.pipe(Effect.provide(layer));
    return service;
  });

describe("AnimaThreadService.breathe", () => {
  it.effect("sends the skill's breathe guide and reports the count before", () =>
    Effect.gen(function* () {
      const sent: Array<{ text: string; mode: string }> = [];
      const service = yield* run("atlas", sent);
      const result = yield* service.breathe({ threadId: ThreadId.make("t1") });
      expect(result).toEqual({
        name: "atlas",
        threadId: "t1",
        breathCountBefore: 7,
        queued: false,
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.mode).toBe("queue");
      const text = sent[0]!.text;
      expect(text).toContain("bun anima.ts breathe --agent atlas\n");
      expect(text).not.toContain("<name>");
      expect(text).toContain("Skip the bare template run");
      expect(text).toContain("fix exactly the fields it names and rerun once");
    }),
  );

  it.effect("reports a request that waits behind a running turn", () =>
    Effect.gen(function* () {
      const service = yield* run("atlas", [], { delivery: "queued" });
      const result = yield* service.breathe({ threadId: ThreadId.make("t1") });
      expect(result.queued).toBe(true);
    }),
  );

  it.effect("rejects archived threads, a missing CLI and a missing guide without sending", () =>
    Effect.gen(function* () {
      const sent: Array<{ text: string; mode: string }> = [];
      const archived = yield* run("atlas", sent, { archived: true });
      const first = yield* Effect.flip(archived.breathe({ threadId: ThreadId.make("t1") }));
      expect(first).toMatchObject({ _tag: "AnimaCommandRejectedError" });
      const noCli = yield* run("atlas", sent, { cli: false });
      const second = yield* Effect.flip(noCli.breathe({ threadId: ThreadId.make("t1") }));
      expect(second).toMatchObject({ _tag: "AnimaCommandRejectedError" });
      const noGuide = yield* run("atlas", sent, { guide: "" });
      const third = yield* Effect.flip(noGuide.breathe({ threadId: ThreadId.make("t1") }));
      expect(third).toMatchObject({ _tag: "AnimaCommandRejectedError" });
      expect(sent).toEqual([]);
    }),
  );

  it.effect("rejects unknown threads and threads without an anima", () =>
    Effect.gen(function* () {
      const sent: Array<{ text: string; mode: string }> = [];
      const plain = yield* run(null, sent);
      const noAnima = yield* Effect.flip(plain.breathe({ threadId: ThreadId.make("t1") }));
      expect(noAnima._tag).toBe("AnimaCommandRejectedError");
      const missing = yield* Effect.flip(plain.breathe({ threadId: ThreadId.make("nope") }));
      expect(missing._tag).toBe("AnimaCommandRejectedError");
      expect(sent).toEqual([]);
    }),
  );
});

describe("AnimaThreadService.startBot", () => {
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

  const start = (options: {
    readonly shells?: Readonly<Record<string, Record<string, unknown>>>;
    readonly providers?: ReadonlyArray<unknown>;
    readonly launched: Array<Record<string, unknown>>;
    readonly dispatched: Array<Record<string, unknown>>;
  }) =>
    Effect.gen(function* () {
      const service = yield* AnimaThreadService.AnimaThreadService;
      return yield* service.startBot({ name: "atlas" });
    }).pipe(
      Effect.provide(
        AnimaThreadService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ThreadManagementService.ThreadManagementService)({
                getThreadShell: (threadId: string) =>
                  Effect.succeed((options.shells?.[threadId] ?? null) as never),
                dispatch: (command) => {
                  options.dispatched.push(command);
                  return Effect.succeed({} as never);
                },
              }),
              Layer.mock(AnimaService.AnimaService)({
                summary: () => Effect.succeed({ breathCount: 1 } as never),
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
              Layer.mock(ProjectService.ProjectService)({
                getById: () => Effect.succeedNone,
              }),
              Layer.mock(ProviderRegistry.ProviderRegistry)({
                getProviders: Effect.succeed((options.providers ?? [claude]) as never),
              }),
              ServerSettings.layerTest(),
            ),
          ),
        ),
      ),
    );

  it.effect("starts one Claude thread in Scratch, and reopens it afterwards", () =>
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
        animaName: "atlas",
        modelSelection: { instanceId: "claude", model: "claude-sonnet-5-5" },
      });

      const again = yield* start({
        launched,
        dispatched,
        shells: { "bot:atlas": shellOf({}) },
      });
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
      expect(error).toMatchObject({ _tag: "AnimaCommandRejectedError" });
    }),
  );
});
