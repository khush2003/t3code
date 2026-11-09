import {
  BotBoardItem,
  BotCharter,
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
import * as BotStore from "../../../bots/BotStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    BotStore.BotStore,
    BotBoards.BotBoards,
    ThreadManagementService.ThreadManagementService,
    ProjectService.ProjectService,
  ],
};

const BotBoardTool = Tool.make("t3_bot_board", {
  ...shared,
  description:
    "Your work items with their threads' live status. Your turn context already has the open ones; use this for done and dropped items.",
  parameters: Schema.Struct({ includeClosed: Schema.optional(Schema.Boolean) }),
  success: Schema.Struct({ items: Schema.Array(BotBoardItem) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.onlyForBots);

const BotItemSaveTool = Tool.make("t3_bot_item_save", {
  ...shared,
  description:
    "Create a work item (omit id) or change one: title, detail, the next step, or state done/dropped. threads files existing threads under it, moving them from any other item.",
  parameters: Schema.Struct({
    id: Schema.optional(BotWorkItemId),
    title: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
    detail: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
    nextStep: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
    state: Schema.optional(BotWorkItemState),
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

export const BotToolkit = Toolkit.make(BotBoardTool, BotItemSaveTool, BotCharterSetTool);
