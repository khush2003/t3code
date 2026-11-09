import {
  type BotBoard,
  type BotBoardInput,
  BotError,
  type BotListResult,
  type BotName,
  BotRejectedError,
  type BotStartInput,
  type BotStartResult,
  type BotWorkItemId,
  CommandId,
  type EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
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
import { deriveBoard } from "./BotBoard.ts";
import * as BotBoards from "./BotBoards.ts";
import * as BotStore from "./BotStore.ts";

const DEFAULT_BOT_PURPOSE = "Help with work across my projects.";

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

/** Before a bot starts a task: the item it names must be one of its own. */
export const assertWorkItem = Effect.fn("BotService.assertWorkItem")(function* (
  bot: BotName,
  workItemId: BotWorkItemId | undefined,
) {
  if (workItemId === undefined) return;
  const store = yield* BotStore.BotStore;
  const item = yield* store.getItem(workItemId);
  if (item === null || item.bot !== bot)
    return yield* new BotRejectedError({
      reason: `Work item ${workItemId} is not on your board. Pass one listed there, or omit workItemId to start a new item.`,
    });
});

/** Every task a bot starts sits on a work item, so none of it drops out of sight. */
export const fileTask = Effect.fn("BotService.fileTask")(function* (input: {
  readonly bot: BotName;
  readonly workItemId: BotWorkItemId | undefined;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly where: string;
}) {
  const store = yield* BotStore.BotStore;
  const itemId = input.workItemId ?? (yield* store.saveItem(input.bot, { title: input.title })).id;
  yield* store.linkThread(itemId, input);
  return itemId;
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
    const bot = yield* store.getBot(input.name);
    if (bot === null) return yield* new BotRejectedError({ reason: `No bot named ${input.name}.` });
    const sources = yield* boards.sources(input.name, { includeClosed: input.includeClosed });
    return { name: bot.name, purpose: bot.purpose, items: deriveBoard(sources) };
  });

  return BotService.of({ start, list, board });
});

export const layer = Layer.effect(BotService, make);
