import * as DiskGuard from "../diskGuard.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  MessageId,
  type OrchestrationV2AppThread,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as HereTaskThreads from "./HereTaskThreads.ts";

const at = (minute: number) =>
  DateTime.makeUnsafe(`2026-11-05T10:${String(minute).padStart(2, "0")}:00.000Z`);

describe("HereTaskThreads.assertMayDelegate", () => {
  const check = (tasksSinceUser: number) => {
    const asked = MessageId.make("message:asked");
    const woke = MessageId.make("message:woke");
    const runs = [
      { ordinal: 1, userMessageId: asked, requestedAt: at(10) },
      { ordinal: 2, userMessageId: woke, requestedAt: at(20) },
    ];
    const tasks = [
      { startedAt: at(1) },
      ...Array.from({ length: tasksSinceUser }, () => ({ startedAt: at(15) })),
    ];
    return Effect.gen(function* () {
      const here = yield* HereTaskThreads.HereTaskThreads;
      return yield* here.assertMayDelegate(
        {
          thread: { id: ThreadId.make("bot:atlas") } as OrchestrationV2AppThread,
          runs: runs as never,
        },
        tasks as never,
      );
    }).pipe(
      Effect.provide(
        HereTaskThreads.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ThreadManagement.ThreadManagementService)({
                getThreadRecords: () =>
                  Effect.succeed({
                    messages: [
                      { id: asked, createdBy: "user" },
                      { id: woke, createdBy: "system" },
                    ],
                  } as never),
              }),
              Layer.mock(ThreadLaunch.ThreadLaunchService)({}),
              Layer.mock(ProjectService.ProjectService)({}),
              Layer.mock(ProviderRegistry.ProviderRegistry)({}),
              ServerSettings.layerTest(),
              DiskGuard.layerTest,
              Layer.mock(ServerEnvironment.ServerEnvironment)({
                getEnvironmentId: Effect.succeed(EnvironmentId.make("here")),
              }),
            ),
          ),
        ),
      ),
    );
  };

  it.effect("counts only tasks since the user last spoke, ignoring wakes", () =>
    Effect.gen(function* () {
      yield* check(HereTaskThreads.BOT_TASKS_PER_USER_MESSAGE - 1);
      const refused = yield* check(HereTaskThreads.BOT_TASKS_PER_USER_MESSAGE).pipe(Effect.flip);
      expect(refused.message).toContain("since the user last spoke");
    }),
  );
});
