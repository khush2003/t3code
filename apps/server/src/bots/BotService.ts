import {
  type BotBoard,
  type BotBoardInput,
  type BotCharterSetInput,
  BotError,
  type BotMemory,
  type BotMemoryInput,
  type BotNoteRetireInput,
  type BotListResult,
  type BotName,
  BotRejectedError,
  type BotStartInput,
  type BotStartResult,
  type BotWorkItemId,
  CommandId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
    readonly list: Effect.Effect<BotListResult, BotError>;
    readonly board: (input: BotBoardInput) => Effect.Effect<BotBoard, BotRejectedError | BotError>;
    /** What a bot keeps, for the person it works for to read and correct. */
    readonly memory: (
      input: BotMemoryInput,
    ) => Effect.Effect<BotMemory, BotRejectedError | BotError>;
    readonly retireNote: (
      input: BotNoteRetireInput,
    ) => Effect.Effect<void, BotRejectedError | BotError>;
    readonly setCharter: (
      input: BotCharterSetInput,
    ) => Effect.Effect<void, BotRejectedError | BotError>;
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

  const start: BotService["Service"]["start"] = Effect.fn("BotService.start")(function* (input) {
    const failed = (cause: unknown) => new BotError({ operation: "start", cause });
    const purpose = input.purpose?.trim() || DEFAULT_BOT_PURPOSE;
    const bot = yield* store.ensureBot({
      name: input.name,
      purpose,
      charter: initialCharter(purpose),
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

  const list: BotService["Service"]["list"] = boards.summaries.pipe(
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

  const setCharter: BotService["Service"]["setCharter"] = Effect.fn("BotService.setCharter")(
    function* (input) {
      const bot = yield* requireBot(input.threadId);
      yield* store.setCharter(bot.name, input.charter.trim());
    },
    Effect.provideService(BotStore.BotStore, store),
  );

  return BotService.of({ start, list, board, memory, retireNote, setCharter });
});

export const layer = Layer.effect(BotService, make);
