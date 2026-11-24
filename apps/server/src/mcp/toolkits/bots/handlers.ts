import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { deriveBoard } from "../../../bots/BotBoard.ts";
import * as BotBoards from "../../../bots/BotBoards.ts";
import * as BotFiles from "../../../bots/BotFiles.ts";
import { renderBotMessage } from "@t3tools/shared/botMessages";
import { findBotFile } from "@t3tools/shared/botShow";
import { requireBot } from "../../../bots/BotService.ts";
import * as BotStore from "../../../bots/BotStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { BotToolkit } from "./tools.ts";

const isMcpFailure = Schema.is(OrchestratorMcpFailure);
const RECALL_HITS = 12;
const BOT_MESSAGES_PER_HOUR = 12;
const NOTE_HITS = 5;
const RECALL_CHARS = 4_000;
const SHOWN_FILE_TITLES = 12;

const failure = (error: { readonly _tag: string; readonly message: string }) =>
  isMcpFailure(error)
    ? error
    : error._tag === "BotRejectedError"
      ? new OrchestratorMcpFailure({ code: "invalid_request", message: error.message })
      : unavailable();

const callerBot = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (scope.thread === undefined)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "Only a bot's own thread can do this.",
    });
  const bot = yield* requireBot(scope.thread.threadId).pipe(Effect.mapError(failure));
  return { bot, hereId: scope.environmentId, threadId: scope.thread.threadId };
});

export const layer = McpToolAccess.toLayer(BotToolkit, {
  t3_bot_board: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot } = yield* callerBot;
      const boards = yield* BotBoards.BotBoards;
      if (input.bot !== undefined && input.bot !== bot.name) {
        const other = bot.oversees
          ? yield* BotStore.BotStore.pipe(Effect.flatMap((store) => store.getBot(input.bot!)))
          : null;
        if (other === null)
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: bot.oversees
              ? `No bot is named ${input.bot}.`
              : "Only a bot that oversees the others reads another bot's board. Ask that bot with t3_bot_tell.",
          });
      }
      const sources = yield* boards.sources(input.bot ?? bot.name, {
        includeClosed: input.includeClosed,
      });
      return { items: deriveBoard(sources) };
    }).pipe(Effect.mapError(failure)),
  ),
  t3_bot_show: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot, threadId } = yield* callerBot;
      const boards = yield* BotBoards.BotBoards;
      if (!(yield* boards.atScreen(threadId)))
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message:
            "Nothing was shown: your person is not at the screen of their bots, so there is nowhere to show it. Tell them what the thing is and where to find it, and do not mention the screen.",
        });
      const whose = input.bot ?? bot.name;
      if (whose !== bot.name) {
        const other = bot.oversees
          ? yield* BotStore.BotStore.pipe(Effect.flatMap((store) => store.getBot(whose)))
          : null;
        if (other === null)
          return yield* new OrchestratorMcpFailure({
            code: "invalid_request",
            message: bot.oversees
              ? `No bot is named ${whose}.`
              : "Only a bot that oversees the others shows another bot's work.",
          });
      }
      if (input.thread !== undefined && input.file !== undefined)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Show one thing at a time: a thread or a file.",
        });
      if (input.thread !== undefined) return { showing: `the task ${input.thread}` };
      if (input.file === undefined) return { showing: `${whose}'s board` };
      // With no bot named, a bot that oversees the others may mean a file of any of them.
      const owners =
        input.bot !== undefined || !bot.oversees
          ? [whose]
          : [
              bot.name,
              ...(yield* BotStore.BotStore.pipe(Effect.flatMap((store) => store.listBots)))
                .map((other) => other.name)
                .filter((name) => name !== bot.name),
            ];
      const titles: string[] = [];
      for (const owner of owners) {
        const items = deriveBoard(yield* boards.sources(owner, { includeClosed: true }));
        const files = items.flatMap((item) => item.files);
        const file = findBotFile(files, input.file);
        if (file !== null)
          return { showing: owner === bot.name ? file.title : `${file.title}, from ${owner}` };
        titles.push(...files.slice(-SHOWN_FILE_TITLES).map((candidate) => candidate.title));
      }
      return yield* new OrchestratorMcpFailure({
        code: "invalid_request",
        message:
          titles.length === 0
            ? `${owners.join(", ")} has no handed-over files.`
            : `No handed-over file matches "${input.file}". There are: ${titles
                .slice(-SHOWN_FILE_TITLES * 2)
                .join("; ")}.`,
      });
    }).pipe(Effect.mapError(failure)),
  ),
  t3_bot_tell: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot, threadId } = yield* callerBot;
      const store = yield* BotStore.BotStore;
      const other = input.bot === bot.name ? null : yield* store.getBot(input.bot);
      if (other === null || other.threadId === null)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `No other bot is named ${input.bot}. Your context lists the bots.`,
        });
      const since = DateTime.formatIso(
        DateTime.subtractDuration(yield* DateTime.now, Duration.hours(1)),
      );
      const told = yield* store.countBotMessages(bot.name, other.name, since);
      // Two bots telling each other things would never stop by themselves.
      if (told >= BOT_MESSAGES_PER_HOUR)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: `You told ${other.name} ${told} things in the last hour. Stop, and tell your person what is going on between you.`,
        });
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const service = yield* OrchestratorMcpService.OrchestratorMcpService;
      const sent = yield* service.sendToThread(scope, {
        threadId: other.threadId,
        message: renderBotMessage(bot.name, input.message),
        mode: "queue",
      });
      yield* store.addBotMessage({
        from: bot.name,
        fromThreadId: threadId,
        to: other.name,
        messageId: sent.messageId,
      });
      return { delivery: sent.delivery };
    }).pipe(Effect.mapError(failure)),
  ),
  t3_bot_item_save: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot, hereId } = yield* callerBot;
      const store = yield* BotStore.BotStore;
      const item = yield* store.saveItem(bot.name, input);
      for (const ref of input.threads ?? []) {
        const environmentId = ref.environmentId ?? hereId;
        const here =
          environmentId === hereId
            ? yield* ThreadManagementService.ThreadManagementService.pipe(
                Effect.flatMap((threads) => threads.getThreadShell(ref.threadId)),
                Effect.orElseSucceed(() => null),
              )
            : null;
        if (environmentId === hereId && here === null)
          return yield* new OrchestratorMcpFailure({
            code: "thread_not_found",
            message: `Thread ${ref.threadId} was not found here. Pass environmentId for a thread on another machine.`,
          });
        const project =
          here === null
            ? undefined
            : yield* ProjectService.ProjectService.pipe(
                Effect.flatMap((projects) => projects.getById(here.projectId)),
                Effect.map(Option.getOrUndefined),
                Effect.orElseSucceed(() => undefined),
              );
        yield* store.linkThread(item.id, {
          environmentId,
          threadId: ref.threadId,
          title: here?.title ?? ref.threadId,
          where: project?.title ?? environmentId,
        });
      }
      return { id: item.id };
    }).pipe(Effect.catchTags({ BotError: (error) => Effect.fail(failure(error)) })),
  ),
  t3_bot_recall: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot, hereId, threadId: callerThreadId } = yield* callerBot;
      const store = yield* BotStore.BotStore;
      // Its own conversations have no task title: its main chat, and threads beside it.
      const own = new Map(
        (yield* store.conversations(bot.name)).map((conversation) => [
          conversation.threadId,
          conversation.threadId === callerThreadId
            ? "this conversation"
            : conversation.threadId === bot.threadId
              ? "your main chat"
              : `your thread "${conversation.title}"`,
        ]),
      );
      if (input.threadId === undefined && (input.query ?? "").trim() === "")
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Pass query to search, or threadId to read a thread's copied messages.",
        });
      const hits =
        input.threadId === undefined
          ? yield* store.recall(bot.name, input.query ?? "", input.limit ?? RECALL_HITS)
          : yield* store.threadMessages(
              bot.name,
              { environmentId: input.environmentId ?? hereId, threadId: input.threadId },
              input.limit ?? RECALL_HITS,
            );
      const notes =
        input.threadId === undefined
          ? yield* store.searchNotes(bot.name, input.query ?? "", NOTE_HITS)
          : [];
      return {
        results: [
          ...notes.map((note) => ({
            when: note.createdAt,
            source: `${note.id}${note.outdatedAt === null ? "" : ", no longer holds"}`,
            where: null,
            role: "note",
            text:
              note.outdatedReason === null
                ? note.text
                : `${note.text} (Retired: ${note.outdatedReason})`,
            threadId: note.threadId,
            environmentId: note.environmentId,
          })),
          ...hits.map((hit) => ({
            when: hit.createdAt,
            source: own.get(hit.threadId) ?? hit.title ?? hit.threadId,
            where: hit.where,
            role: hit.role,
            text:
              hit.text.length <= RECALL_CHARS ? hit.text : `${hit.text.slice(0, RECALL_CHARS)}…`,
            threadId: hit.threadId,
            environmentId: hit.environmentId,
          })),
        ],
      };
    }).pipe(Effect.catchTags({ BotError: (error) => Effect.fail(failure(error)) })),
  ),
  t3_bot_file_give: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      if (scope.thread === undefined)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Only a thread a bot started can hand it a file.",
        });
      const files = yield* BotFiles.BotFiles;
      const { file, kept } = yield* files.give({
        taskThreadId: scope.thread.threadId,
        title: input.title,
        path: input.path,
        url: input.url,
      });
      return { id: file.id, kept };
    }).pipe(Effect.mapError(failure)),
  ),
  t3_bot_note_retire: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot } = yield* callerBot;
      const store = yield* BotStore.BotStore;
      const id = input.id.trim();
      const retired = yield* store.retireNote(bot.name, id, input.reason.trim(), "bot");
      if (!retired) {
        const theirs = (yield* store.activeNotes(bot.name)).some(
          (note) => note.id === id && note.author === "user",
        );
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: theirs
            ? `Your person wrote ${id} themselves, so it is theirs to remove. Tell them why it no longer holds.`
            : `${id} is not one of your current notes.`,
        });
      }
      return { retired };
    }).pipe(Effect.catchTags({ BotError: (error) => Effect.fail(failure(error)) })),
  ),
  t3_bot_charter_set: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot } = yield* callerBot;
      const store = yield* BotStore.BotStore;
      yield* store.setCharter(bot.name, input.charter.trim());
      return { saved: true };
    }).pipe(Effect.mapError(failure)),
  ),
});
