import { BotError, BotRejectedError, type ThreadId } from "@t3tools/contracts";
import { hostPreviewMimeTypeFromExtension } from "@t3tools/shared/filePreview";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import {
  attachmentFileExtension,
  createAttachmentId,
  parseAttachmentFileExtension,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as DiskGuard from "../diskGuard.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as BotStore from "./BotStore.ts";

/** Every copy kept for every bot; past it the oldest copies go and their records stay. */
const FILE_BUDGET_BYTES = 10 * 1024 ** 3;
/** Documents a task is likely to hand over, which the media types do not cover. */
const TEXT_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
};
/** A larger file stays where it is and the bot keeps where that was. */
const FILE_COPY_BYTES = 200 * 1024 ** 2;

/**
 * What a bot's tasks hand it to show: documents, screenshots, recordings, preview links. Nothing
 * is gathered on its own, so the budget goes to what someone meant to keep.
 */
export class BotFiles extends Context.Service<
  BotFiles,
  {
    /** From a task's thread to the bot that started it. Exactly one of `path` and `url`. */
    readonly give: (input: {
      readonly taskThreadId: ThreadId;
      readonly title: string;
      readonly path?: string | undefined;
      readonly url?: string | undefined;
    }) => Effect.Effect<
      { readonly file: BotStore.BotFile; readonly kept: boolean },
      BotRejectedError | BotError
    >;
  }
>()("t3/bots/BotFiles") {}

const make = Effect.gen(function* () {
  const store = yield* BotStore.BotStore;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const config = yield* ServerConfig.ServerConfig;
  const diskGuard = yield* DiskGuard.DiskGuard;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hereId = yield* ServerEnvironment.ServerEnvironment.pipe(
    Effect.flatMap((environment) => environment.getEnvironmentId),
  );
  const failed = (operation: string) => (cause: unknown) => new BotError({ operation, cause });
  const reject = (reason: string) => new BotRejectedError({ reason });

  const evict = Effect.fn("BotFiles.evict")(function* () {
    let over = (yield* store.storedFileBytes) - FILE_BUDGET_BYTES;
    while (over > 0) {
      const oldest = yield* store.oldestStoredFiles(20);
      if (oldest.length === 0) return;
      for (const file of oldest) {
        if (over <= 0) return;
        const kept =
          file.attachmentId === null
            ? null
            : resolveAttachmentPathById({
                attachmentsDir: config.attachmentsDir,
                attachmentId: file.attachmentId,
              });
        if (kept !== null) yield* fs.remove(kept, { force: true }).pipe(Effect.ignore);
        yield* store.markFileEvicted(file.id);
        over -= file.bytes;
      }
    }
  });

  const give: BotFiles["Service"]["give"] = Effect.fn("BotFiles.give")(function* (input) {
    const task = yield* projections
      .getThread(input.taskThreadId)
      .pipe(Effect.mapError(failed("read the task's thread")));
    const bot =
      task.delegatedFrom?.environmentId === hereId
        ? yield* store.botForThread(task.delegatedFrom.threadId)
        : null;
    if (bot === null || bot.threadId === null)
      return yield* reject(
        "No bot on this machine started this thread, so there is no one to hand a file to. Say where the file is in your reply instead.",
      );
    const thread = { environmentId: hereId, threadId: input.taskThreadId };
    const record = {
      ...thread,
      bot: bot.name,
      itemId: yield* store.itemForThread(thread),
      title: input.title.trim(),
    };
    if ((input.path === undefined) === (input.url === undefined))
      return yield* reject("Pass path for a file, or url for a link, not both.");
    if (input.url !== undefined) {
      if (!URL.canParse(input.url)) return yield* reject(`${input.url} is not a URL.`);
      const file = yield* store.addFile({
        ...record,
        name: null,
        mimeType: null,
        bytes: 0,
        attachmentId: null,
        url: input.url,
        sourcePath: null,
      });
      return { file, kept: false };
    }
    const project = yield* projects.getById(task.projectId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );
    const source = path.resolve(task.worktreePath ?? project?.workspaceRoot ?? "/", input.path!);
    const info = yield* fs.stat(source).pipe(Effect.orElseSucceed(() => null));
    if (info === null || info.type !== "File")
      return yield* reject(`${source} is not a file. Pass the path of a file that exists.`);
    const bytes = Number(info.size);
    const name = path.basename(source);
    const described = {
      ...record,
      name,
      mimeType:
        hostPreviewMimeTypeFromExtension(path.extname(name)) ??
        TEXT_TYPES[path.extname(name).toLowerCase()] ??
        "application/octet-stream",
      bytes,
      url: null,
      sourcePath: source,
    };
    const attachmentId =
      bytes > FILE_COPY_BYTES || bytes > FILE_BUDGET_BYTES
        ? null
        : createAttachmentId(bot.threadId, attachmentFileExtension(name));
    const extension = attachmentId === null ? null : parseAttachmentFileExtension(attachmentId);
    const target =
      attachmentId === null || extension === null
        ? null
        : resolveAttachmentRelativePath({
            attachmentsDir: config.attachmentsDir,
            relativePath: `${attachmentId}.${extension}`,
          });
    // No room, or no place for it: the record still says where the file is.
    const copied =
      target === null
        ? false
        : yield* diskGuard.ensureRoomForWorktree.pipe(
            Effect.andThen(fs.makeDirectory(config.attachmentsDir, { recursive: true })),
            Effect.andThen(fs.copyFile(source, target)),
            Effect.as(true),
            Effect.catch((cause) =>
              Effect.logWarning("a bot's file was not copied", { source, cause }).pipe(
                Effect.as(false),
              ),
            ),
          );
    const file = yield* store.addFile({ ...described, attachmentId: copied ? attachmentId : null });
    if (copied) yield* evict();
    return { file, kept: copied };
  });

  return BotFiles.of({ give });
});

export const layer = Layer.effect(BotFiles, make);
