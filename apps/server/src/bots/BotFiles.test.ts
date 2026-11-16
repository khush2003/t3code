import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { BotName, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as DiskGuard from "../diskGuard.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as BotFiles from "./BotFiles.ts";
import * as BotStore from "./BotStore.ts";

const here = EnvironmentId.make("here");
const atlas = BotName.make("atlas");
const botThread = ThreadId.make("bot:atlas");
const taskThread = ThreadId.make("task");

describe("BotFiles.give", () => {
  it.effect("keeps a copy of a task's file, a link as a link, and refuses a stranger", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const base = yield* fs.makeTempDirectoryScoped({ prefix: "bot-files-" });
      const workspace = path.join(base, "repo");
      yield* fs.makeDirectory(workspace, { recursive: true });
      yield* fs.writeFileString(path.join(workspace, "report.md"), "# Findings\n");
      const config = yield* Layer.build(ServerConfig.ServerConfig.layerTest(process.cwd(), base));
      const { attachmentsDir } = Context.get(config, ServerConfig.ServerConfig);

      yield* Effect.gen(function* () {
        const store = yield* BotStore.BotStore;
        const files = yield* BotFiles.BotFiles;
        yield* store.ensureBot({ name: atlas, purpose: "p", charter: "c" });
        yield* store.setThread(atlas, botThread);
        const item = yield* store.saveItem(atlas, { title: "Audit" });
        yield* store.linkThread(item.id, {
          environmentId: here,
          threadId: taskThread,
          title: "Run the audit",
          where: "repo",
        });

        const given = yield* files.give({
          taskThreadId: taskThread,
          title: "Audit report",
          path: "report.md",
        });
        expect(given).toMatchObject({
          kept: true,
          file: { itemId: item.id, name: "report.md", mimeType: "text/markdown", bytes: 11 },
        });
        const copy = resolveAttachmentPathById({
          attachmentsDir,
          attachmentId: given.file.attachmentId!,
        });
        expect(yield* fs.readFileString(copy!)).toBe("# Findings\n");

        const link = yield* files.give({
          taskThreadId: taskThread,
          title: "Preview",
          url: "https://preview.example/pr-12",
        });
        expect(link).toMatchObject({ kept: false, file: { url: "https://preview.example/pr-12" } });
        expect((yield* store.itemFiles([item.id])).map((file) => file.title)).toEqual([
          "Audit report",
          "Preview",
        ]);

        const missing = yield* Effect.flip(
          files.give({ taskThreadId: taskThread, title: "Nope", path: "absent.md" }),
        );
        expect(missing.message).toContain("is not a file");
        const stranger = yield* Effect.flip(
          files.give({ taskThreadId: ThreadId.make("solo"), title: "x", path: "report.md" }),
        );
        expect(stranger.message).toContain("No bot on this machine started this thread");
      }).pipe(
        Effect.provide(
          BotFiles.layer.pipe(
            Layer.provideMerge(BotStore.layerMemory),
            Layer.provide(
              Layer.mergeAll(
                Layer.succeedContext(config),
                DiskGuard.layerTest,
                Layer.mock(ServerEnvironment.ServerEnvironment)({
                  getEnvironmentId: Effect.succeed(here),
                }),
                Layer.mock(ProjectService.ProjectService)({
                  getById: () => Effect.succeedSome({ workspaceRoot: workspace } as never),
                }),
                Layer.mock(ProjectionStore.ProjectionStoreV2)({
                  getThread: (threadId) =>
                    Effect.succeed({
                      id: threadId,
                      projectId: ProjectId.make("project"),
                      worktreePath: null,
                      ...(threadId === taskThread
                        ? {
                            delegatedFrom: {
                              environmentId: here,
                              threadId: botThread,
                              title: "atlas",
                            },
                          }
                        : {}),
                    } as never),
                }),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.provide(Layer.merge(NodeServices.layer, NodeCrypto.layer))),
  );
});
