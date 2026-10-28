import {
  AnimaDetail,
  AnimaListResult,
  AnimaMutationResult,
  AnimaName,
  AnimaPolicyAction,
  NonNegativeInt,
  OrchestratorMcpFailure,
  ProjectId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as AnimaService from "../../../anima/AnimaService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    AnimaService.AnimaService,
  ],
};
const AnimaListTool = Tool.make("t3_anima_list", {
  ...shared,
  description:
    "List the persistent agent identities (animas) on this environment with their role, breath count, aim, voice, and whether they are enabled or in a live session.",
  success: AnimaListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const AnimaReadTool = Tool.make("t3_anima_read", {
  ...shared,
  description:
    "Read one anima: identity, traits, skills, policy rules, recent breaths, inbox, and open questions. Returns the last 20 breaths unless breathLimit is set (0 means all).",
  parameters: Schema.Struct({
    name: AnimaName,
    breathLimit: Schema.optional(NonNegativeInt),
  }),
  success: AnimaDetail,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const AnimaPolicyTool = Tool.make("t3_anima_policy", {
  ...shared,
  description:
    "Change an anima's policy. action.type add proposes a rule (WHEN <condition> THEN <action>, ALWAYS <action>, or NEVER <action>) as pending unless direct is true; update and remove take the 1-based operational rule index; apply promotes every pending rule. The CLI caps operational rules at 40.",
  parameters: Schema.Struct({ name: AnimaName, action: AnimaPolicyAction }),
  success: AnimaMutationResult,
}).annotate(Tool.Destructive, false);
const AnimaAttachTool = Tool.make("t3_anima_attach", {
  ...shared,
  description:
    "Attach an anima to a project so its project instructions reference the anima. projectId defaults to the calling thread's project.",
  parameters: Schema.Struct({ name: AnimaName, projectId: Schema.optional(ProjectId) }),
  success: AnimaMutationResult,
}).annotate(Tool.Destructive, false);
export const AnimaToolkit = Toolkit.make(
  AnimaListTool,
  AnimaReadTool,
  AnimaPolicyTool,
  AnimaAttachTool,
);
