import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { deriveBoard } from "../../../bots/BotBoard.ts";
import * as BotBoards from "../../../bots/BotBoards.ts";
import { requireBot } from "../../../bots/BotService.ts";
import * as BotStore from "../../../bots/BotStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { unavailable } from "../../threadAccess.ts";
import { BotToolkit } from "./tools.ts";

const isMcpFailure = Schema.is(OrchestratorMcpFailure);

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
  return { bot, hereId: scope.environmentId };
});

export const layer = McpToolAccess.toLayer(BotToolkit, {
  t3_bot_board: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot } = yield* callerBot;
      const boards = yield* BotBoards.BotBoards;
      const sources = yield* boards.sources(bot.name, { includeClosed: input.includeClosed });
      return { items: deriveBoard(sources) };
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
  t3_bot_charter_set: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { bot } = yield* callerBot;
      const store = yield* BotStore.BotStore;
      yield* store.setCharter(bot.name, input.charter.trim());
      return { saved: true };
    }).pipe(Effect.mapError(failure)),
  ),
});
