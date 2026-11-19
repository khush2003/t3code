import {
  BotBoardItem,
  BotCharter,
  BotName,
  BotWorkItemId,
  BotWorkItemState,
  EnvironmentId,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as McpSchema from "effect/ai/McpSchema";

import * as BotBoards from "../../../bots/BotBoards.ts";
import * as BotFiles from "../../../bots/BotFiles.ts";
import * as BotStore from "../../../bots/BotStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as OrchestratorMcpService from "../../OrchestratorMcpService.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    BotStore.BotStore,
    BotBoards.BotBoards,
    BotFiles.BotFiles,
    OrchestratorMcpService.OrchestratorMcpService,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
  ],
};

const BotBoardTool = Tool.make("t3_bot_board", {
  ...shared,
  description:
    "Your work items with their threads' live status. Your turn context already has the open ones; use this for done and dropped items.",
  parameters: Schema.Struct({
    includeClosed: Schema.optional(Schema.Boolean),
    /** Another bot's board, for a bot that oversees the others. */
    bot: Schema.optional(BotName),
  }),
  success: Schema.Struct({ items: Schema.Array(BotBoardItem) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForBots);

const BotItemSaveTool = Tool.make("t3_bot_item_save", {
  ...shared,
  description:
    "Create a work item (omit id) or change one: title, detail, the next step, or state done/dropped. Set waitingOnPerson true when you cannot take the next step until your person decides or does something, and say what in nextStep; set it false once they have. threads files existing threads under it, moving them from any other item.",
  parameters: Schema.Struct({
    id: Schema.optional(BotWorkItemId),
    title: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
    detail: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
    nextStep: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
    state: Schema.optional(BotWorkItemState),
    waitingOnPerson: Schema.optional(Schema.Boolean),
    threads: Schema.optional(
      Schema.Array(
        Schema.Struct({ threadId: ThreadId, environmentId: Schema.optional(EnvironmentId) }),
      ),
    ),
  }),
  success: Schema.Struct({ id: BotWorkItemId }),
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForBots);

const BotCharterSetTool = Tool.make("t3_bot_charter_set", {
  ...shared,
  description:
    "Replace your charter: what you are for and what your person wants to hold from now on. Send the whole text; keep it short.",
  parameters: Schema.Struct({ charter: BotCharter }),
  success: Schema.Struct({ saved: Schema.Boolean }),
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForBots);

const BotRecallTool = Tool.make("t3_bot_recall", {
  ...shared,
  description:
    "Search what you keep: this whole conversation and every message of your finished tasks' threads, readable while their machine is offline. query finds passages; threadId returns that thread's copied messages instead. Cite what you find by its date and thread.",
  parameters: Schema.Struct({
    query: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
    threadId: Schema.optional(ThreadId),
    environmentId: Schema.optional(EnvironmentId),
    limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 40 }))),
  }),
  success: Schema.Struct({
    results: Schema.Array(
      Schema.Struct({
        when: Schema.String,
        /** The thread's title, or "this conversation". */
        source: Schema.String,
        where: Schema.NullOr(Schema.String),
        role: Schema.String,
        text: Schema.String,
        threadId: ThreadId,
        environmentId: EnvironmentId,
      }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForBots);

const BotNoteRetireTool = Tool.make("t3_bot_note_retire", {
  ...shared,
  description:
    "Mark one of your notes wrong or no longer true, with the reason. It is kept as history and leaves your context.",
  parameters: Schema.Struct({
    id: Schema.String.check(Schema.isMaxLength(40)),
    reason: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(500)),
  }),
  success: Schema.Struct({ retired: Schema.Boolean }),
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForBots);

const BotTellTool = Tool.make("t3_bot_tell", {
  ...shared,
  description:
    "Tell another bot something, ask it a question, or hand it work that fits its purpose. Say everything it needs: it does not see your conversation. It gets a turn with your message, and what it says at the end of that turn comes back to you as a message by itself, so end your turn after telling it.",
  parameters: Schema.Struct({
    bot: BotName,
    message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
  }),
  success: Schema.Struct({ delivery: Schema.String }),
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForBots);

const BotFileGiveTool = Tool.make("t3_bot_file_give", {
  ...shared,
  description:
    "Hand the bot that started this thread something to show its person: a document, screenshot, recording or other file by path, or a preview link by url. It is filed with your task. Give only finished things worth keeping, then name them in your reply.",
  parameters: Schema.Struct({
    title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    path: Schema.optional(Schema.String.check(Schema.isMaxLength(4_096))),
    url: Schema.optional(Schema.String.check(Schema.isMaxLength(2_048))),
  }),
  success: Schema.Struct({
    id: Schema.String,
    /** False when the file was too large to copy, so only where it is was recorded. */
    kept: Schema.Boolean,
  }),
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForDelegatedTasks);

export const BotToolkit = Toolkit.make(
  BotBoardTool,
  BotItemSaveTool,
  BotCharterSetTool,
  BotRecallTool,
  BotNoteRetireTool,
  BotTellTool,
  BotFileGiveTool,
);
