import {
  EnvironmentId,
  type BotBoard,
  type BotBoardInput,
  type BotCharterSetInput,
  BotError,
  type BotMemory,
  type BotMemoryInput,
  type BotNoteAddInput,
  type BotNoteEditInput,
  type BotNoteRestoreInput,
  type BotNoteRetireInput,
  type BotListResult,
  type BotName,
  BotRejectedError,
  type BotStartInput,
  type BotStartResult,
  type BotLookSetInput,
  type BotThreadStartInput,
  type BotThreadStartResult,
  type BotWorkItemId,
  CommandId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createAttachmentId, parseAttachmentFileExtension } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { deriveBoard, unfiledTasks } from "./BotBoard.ts";
import * as BotBoards from "./BotBoards.ts";
import * as BotStore from "./BotStore.ts";

const DEFAULT_BOT_PURPOSE = "Help with work across my projects.";
const PASSES_SHOWN = 10;
const THREAD_TITLE_CHARS = 60;

const AVATAR_EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
/** A bot's picture is shown small, so the client sends it small. */
const AVATAR_BYTES = 256 * 1024;
const ANCHOR_TEXT_CHARS = 600;

const initialCharter = (purpose: string) =>
  [`What I am for: ${purpose}`, "", "How my person wants work done: nothing recorded yet."].join(
    "\n",
  );

export class BotService extends Context.Service<
  BotService,
  {
    readonly start: (
      input: BotStartInput,
    ) => Effect.Effect<BotStartResult, BotRejectedError | BotError>;
    /** Opens a thread beside a bot's main chat, with its own session and the bot's memory. */
    readonly startThread: (
      input: BotThreadStartInput,
    ) => Effect.Effect<BotThreadStartResult, BotRejectedError | BotError>;
    readonly list: Effect.Effect<BotListResult, BotError>;
    readonly board: (input: BotBoardInput) => Effect.Effect<BotBoard, BotRejectedError | BotError>;
    /** What a bot keeps, for the person it works for to read and correct. */
    readonly memory: (
      input: BotMemoryInput,
    ) => Effect.Effect<BotMemory, BotRejectedError | BotError>;
    readonly retireNote: (
      input: BotNoteRetireInput,
    ) => Effect.Effect<void, BotRejectedError | BotError>;
    /** A note the person writes themselves. The bot is always sent these. */
    readonly addNote: (input: BotNoteAddInput) => Effect.Effect<void, BotRejectedError | BotError>;
    readonly editNote: (
      input: BotNoteEditInput,
    ) => Effect.Effect<void, BotRejectedError | BotError>;
    /** Brings back a note that was marked outdated. */
    readonly restoreNote: (
      input: BotNoteRestoreInput,
    ) => Effect.Effect<void, BotRejectedError | BotError>;
    readonly setCharter: (
      input: BotCharterSetInput,
    ) => Effect.Effect<void, BotRejectedError | BotError>;
    /** Changes a bot's icon, colour or picture. A new picture replaces the one it had. */
    readonly setLook: (input: BotLookSetInput) => Effect.Effect<void, BotRejectedError | BotError>;
  }
>()("t3/bots/BotService") {}

/** The bot a thread is, for tools only a bot may call. */
export const requireBot = (threadId: ThreadId) =>
  BotStore.BotStore.pipe(
    Effect.flatMap((store) => store.botForThread(threadId)),
    Effect.filterOrFail(
      (bot) => bot !== null,
      () => new BotRejectedError({ reason: "Only a bot's own thread can do this." }),
    ),
  );

const ITEMS_NAMED = 12;

/**
 * Before a bot starts a task: it names the item the task is for, one of its own. An item made
 * for it without being asked would sit beside the one the bot just made for the same work.
 */
export const assertWorkItem = Effect.fn("BotService.assertWorkItem")(function* (
  bot: BotName,
  workItemId: BotWorkItemId | undefined,
) {
  const store = yield* BotStore.BotStore;
  if (workItemId === undefined) {
    const open = yield* store.listItems(bot);
    return yield* new BotRejectedError({
      reason:
        open.length === 0
          ? "Every task is for a work item. Create one with t3_bot_item_save, then pass its id as workItemId."
          : `Pass workItemId: the work item this task is for. Open items: ${open
              .slice(0, ITEMS_NAMED)
              .map((item) => `${item.id} "${item.title}"`)
              .join(", ")}. For new work, create an item with t3_bot_item_save first.`,
    });
  }
  const item = yield* store.getItem(workItemId);
  if (item === null || item.bot !== bot)
    return yield* new BotRejectedError({
      reason: `Work item ${workItemId} is not on your board. Pass one listed there, or create one with t3_bot_item_save.`,
    });
});

const make = Effect.gen(function* () {
  const store = yield* BotStore.BotStore;
  const boards = yield* BotBoards.BotBoards;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;
  const config = yield* ServerConfig.ServerConfig;
  // Orchestration test harnesses run without an environment.
  const environment = yield* Effect.serviceOption(ServerEnvironment.ServerEnvironment);
  const hereId = Option.isSome(environment)
    ? yield* environment.value.getEnvironmentId
    : EnvironmentId.make("here");
  const fs = yield* FileSystem.FileSystem;

  const start: BotService["Service"]["start"] = Effect.fn("BotService.start")(function* (input) {
    const failed = (cause: unknown) => new BotError({ operation: "start", cause });
    const purpose = input.purpose?.trim() || DEFAULT_BOT_PURPOSE;
    const bot = yield* store.ensureBot({
      name: input.name,
      purpose,
      charter: initialCharter(purpose),
      oversees: input.oversees,
    });
    let threadId = bot.threadId ?? ThreadId.make(`bot:${input.name}`);
    // A deleted thread keeps its id, so a bot started after one takes the next.
    for (let generation = 2; ; generation += 1) {
      const shell = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(failed));
      if (shell === null) break;
      if (shell.deletedAt === null) {
        if (shell.archivedAt !== null)
          yield* threads
            .dispatch({
              type: "thread.unarchive",
              commandId: CommandId.make(`bot-unarchive:${yield* random.uuidV4()}`),
              threadId,
            })
            .pipe(Effect.mapError(failed));
        if (bot.threadId !== threadId) yield* store.setThread(input.name, threadId);
        return { threadId, created: false };
      }
      threadId = ThreadId.make(`bot:${input.name}:${generation}`);
    }
    const claude = (yield* providers.getProviders).find(
      (provider) =>
        provider.driver === "claudeAgent" &&
        provider.enabled &&
        provider.status !== "error" &&
        provider.status !== "disabled",
    );
    // Routing work is light; the threads it starts use each project's own model.
    const model =
      claude?.models.find((candidate) => /sonnet/i.test(candidate.slug)) ??
      claude?.models.find((candidate) => candidate.isDefault === true) ??
      claude?.models[0];
    if (claude === undefined || model === undefined)
      return yield* new BotRejectedError({
        reason: "A bot runs on Claude. Set up Claude on this environment first.",
      });
    const { projectId } = yield* folders.ensureScratchProject.pipe(
      Effect.mapError((error) => new BotRejectedError({ reason: error.message })),
    );
    const project = yield* projects.getById(projectId).pipe(Effect.mapError(failed));
    const { defaultRuntimeMode } = resolveProjectSettings(
      yield* settings.getSettings.pipe(Effect.mapError(failed)),
      projectId,
      Option.getOrUndefined(project),
    ).settings;
    yield* store.setThread(input.name, threadId);
    yield* launches
      .launch({
        commandId: CommandId.make(`bot-start:${threadId}`),
        threadId,
        projectId,
        title: input.name,
        modelSelection: { instanceId: claude.instanceId, model: model.slug },
        runtimeMode: defaultRuntimeMode,
        interactionMode: "default",
        bot: true,
        workspaceStrategy: { type: "root" },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.mapError(failed));
    return { threadId, created: true };
  });

  const startThread: BotService["Service"]["startThread"] = Effect.fn("BotService.startThread")(
    function* (input) {
      const failed = (cause: unknown) => new BotError({ operation: "start a thread", cause });
      const bot = yield* store.botForThread(input.threadId);
      const main =
        bot === null || bot.threadId === null
          ? null
          : yield* threads.getThreadShell(bot.threadId).pipe(Effect.mapError(failed));
      if (bot === null || bot.threadId === null || main === null || main.deletedAt !== null)
        return yield* new BotRejectedError({ reason: "This is not a bot with a main chat." });
      const anchorText =
        input.anchorMessageId === undefined
          ? null
          : yield* threads
              .getThreadRecords(bot.threadId, ["messages"], {
                messageIds: [MessageId.make(input.anchorMessageId)],
              })
              .pipe(
                Effect.map(({ messages }) => messages[0]?.text ?? null),
                Effect.mapError(failed),
              );
      if (input.anchorMessageId !== undefined && anchorText === null)
        return yield* new BotRejectedError({
          reason: "A thread starts from a message in the bot's main chat.",
        });
      // A message has one thread: replying to it again opens the thread it already has.
      const existing =
        input.anchorMessageId === undefined
          ? undefined
          : (yield* boards.conversations(bot.name).pipe(Effect.mapError(failed))).find(
              (conversation) => conversation.anchor?.messageId === input.anchorMessageId,
            );
      if (existing !== undefined) return { threadId: existing.threadId };
      const title =
        input.title?.trim() ||
        anchorText?.trim().split("\n")[0]?.slice(0, THREAD_TITLE_CHARS).trim() ||
        "New thread";
      const threadId = ThreadId.make(`bot:${bot.name}:t:${(yield* random.uuidV4()).slice(0, 8)}`);
      yield* store.addConversation({
        threadId,
        bot: bot.name,
        title,
        anchor:
          input.anchorMessageId === undefined || anchorText === null
            ? null
            : { messageId: input.anchorMessageId, text: anchorText },
      });
      // The model and mode its person chose for the bot, not the ones it was created with.
      yield* launches
        .launch({
          commandId: CommandId.make(`bot-thread-start:${threadId}`),
          threadId,
          projectId: main.projectId,
          title,
          modelSelection: main.modelSelection,
          runtimeMode: main.runtimeMode,
          interactionMode: "default",
          bot: true,
          workspaceStrategy: { type: "root" },
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.mapError(failed));
      return { threadId };
    },
  );

  const list: BotService["Service"]["list"] = boards.summaries.pipe(
    Effect.flatMap((bots) =>
      Effect.forEach(bots, (bot) =>
        boards.conversations(bot.name).pipe(
          Effect.flatMap((all) =>
            Effect.forEach(
              all.filter((conversation) => conversation.threadId !== bot.threadId),
              (conversation) =>
                Effect.all({
                  replies: threads.getMessageCount(conversation.threadId),
                  shell: threads.getThreadShell(conversation.threadId),
                }).pipe(
                  Effect.orElseSucceed(() => ({ replies: 0, shell: null })),
                  Effect.map(({ replies, shell }) => ({
                    threadId: conversation.threadId,
                    title: conversation.title,
                    anchorMessageId: conversation.anchor?.messageId ?? null,
                    // Shown as a few lines above the thread; the list is read every few seconds.
                    anchorText: conversation.anchor?.text.slice(0, ANCHOR_TEXT_CHARS) ?? null,
                    replies,
                    lastReplyAt:
                      replies === 0 || shell === null ? null : DateTime.formatIso(shell.updatedAt),
                  })),
                ),
            ),
          ),
          Effect.map((found) => ({ ...bot, threads: found })),
        ),
      ),
    ),
    Effect.map((bots) => ({ bots })),
  );

  const board: BotService["Service"]["board"] = Effect.fn("BotService.board")(function* (input) {
    const bot = yield* store.botForThread(input.threadId);
    if (bot === null) return yield* new BotRejectedError({ reason: "This thread is not a bot." });
    const sources = yield* boards.sources(bot.name, { includeClosed: input.includeClosed });
    return {
      name: bot.name,
      purpose: bot.purpose,
      items: deriveBoard(sources),
      unfiled: unfiledTasks(sources),
    };
  });

  const memory: BotService["Service"]["memory"] = Effect.fn("BotService.memory")(
    function* (input) {
      const bot = yield* requireBot(input.threadId);
      const since = DateTime.formatIso(
        DateTime.subtractDuration(yield* DateTime.now, Duration.days(1)),
      );
      return {
        name: bot.name,
        charter: bot.charter,
        charterHistory: yield* store.charterHistory(bot.name),
        notes: yield* store.allNotes(bot.name),
        passes: yield* store.reflectionPasses(bot.name, PASSES_SHOWN),
        unread: (yield* store.reflectionState(bot.name, since)).unread,
      };
    },
    Effect.provideService(BotStore.BotStore, store),
  );

  const retireNote: BotService["Service"]["retireNote"] = Effect.fn("BotService.retireNote")(
    function* (input) {
      const bot = yield* requireBot(input.threadId);
      if (!(yield* store.retireNote(bot.name, input.id, input.reason.trim())))
        return yield* new BotRejectedError({ reason: "That note is not a current note." });
    },
    Effect.provideService(BotStore.BotStore, store),
  );

  const addNote: BotService["Service"]["addNote"] = Effect.fn("BotService.addNote")(
    function* (input) {
      const bot = yield* requireBot(input.threadId);
      // Filed against the bot's own chat, which is where "open the conversation" then leads.
      yield* store.addUserNote(
        bot.name,
        { environmentId: hereId, threadId: bot.threadId ?? input.threadId },
        input.text.trim(),
      );
    },
    Effect.provideService(BotStore.BotStore, store),
  );

  const editNote: BotService["Service"]["editNote"] = Effect.fn("BotService.editNote")(
    function* (input) {
      const bot = yield* requireBot(input.threadId);
      if (!(yield* store.editNote(bot.name, input.id, input.text.trim())))
        return yield* new BotRejectedError({ reason: "That note is not a current note." });
    },
    Effect.provideService(BotStore.BotStore, store),
  );

  const restoreNote: BotService["Service"]["restoreNote"] = Effect.fn("BotService.restoreNote")(
    function* (input) {
      const bot = yield* requireBot(input.threadId);
      if (!(yield* store.restoreNote(bot.name, input.id)))
        return yield* new BotRejectedError({ reason: "That note was not removed." });
    },
    Effect.provideService(BotStore.BotStore, store),
  );

  const setCharter: BotService["Service"]["setCharter"] = Effect.fn("BotService.setCharter")(
    function* (input) {
      const bot = yield* requireBot(input.threadId);
      yield* store.setCharter(bot.name, input.charter.trim());
    },
    Effect.provideService(BotStore.BotStore, store),
  );

  const setLook: BotService["Service"]["setLook"] = Effect.fn("BotService.setLook")(
    function* (input) {
      const bot = yield* store.botForThread(input.threadId);
      if (bot === null || bot.threadId === null)
        return yield* new BotRejectedError({ reason: "This thread is not a bot." });
      const had = (yield* store.looks).get(bot.name) ?? {
        icon: null,
        color: null,
        avatarAttachmentId: null,
      };
      const pathOf = (attachmentId: string) => {
        const extension = parseAttachmentFileExtension(attachmentId);
        return extension === null
          ? null
          : resolveAttachmentRelativePath({
              attachmentsDir: config.attachmentsDir,
              relativePath: `${attachmentId}.${extension}`,
            });
      };
      let avatarAttachmentId = had.avatarAttachmentId;
      if (input.avatar !== undefined) {
        avatarAttachmentId =
          input.avatar === null
            ? null
            : createAttachmentId(bot.threadId, AVATAR_EXTENSIONS[input.avatar.mimeType]);
        const target = avatarAttachmentId === null ? null : pathOf(avatarAttachmentId);
        if (input.avatar !== null) {
          const bytes = Buffer.from(input.avatar.base64, "base64");
          if (target === null || bytes.length === 0 || bytes.length > AVATAR_BYTES)
            return yield* new BotRejectedError({
              reason: "That picture cannot be kept. Use a smaller PNG, JPEG or WebP.",
            });
          yield* fs.makeDirectory(config.attachmentsDir, { recursive: true }).pipe(
            Effect.andThen(fs.writeFile(target, bytes)),
            Effect.mapError((cause) => new BotError({ operation: "keep a bot's picture", cause })),
          );
        }
      }
      yield* store.setLook(bot.name, {
        icon: input.icon === undefined ? had.icon : input.icon,
        color: input.color === undefined ? had.color : input.color,
        avatarAttachmentId,
      });
      // The picture it had is no longer shown anywhere.
      const old =
        had.avatarAttachmentId !== null && had.avatarAttachmentId !== avatarAttachmentId
          ? pathOf(had.avatarAttachmentId)
          : null;
      if (old !== null) yield* fs.remove(old).pipe(Effect.ignore);
    },
  );

  return BotService.of({
    start,
    startThread,
    list,
    board,
    memory,
    retireNote,
    addNote,
    editNote,
    restoreNote,
    setCharter,
    setLook,
  });
});

export const layer = Layer.effect(BotService, make);
