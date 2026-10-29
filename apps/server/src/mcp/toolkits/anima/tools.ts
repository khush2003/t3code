import {
  AnimaDetail,
  AnimaForm,
  AnimaHealthResult,
  AnimaInboxMessage,
  AnimaInboxReplyAction,
  AnimaInboxSendAction,
  AnimaLibraryListResult,
  AnimaLibraryReadResult,
  AnimaLibrarySlug,
  AnimaListResult,
  AnimaMutationResult,
  AnimaName,
  AnimaOpen,
  AnimaOpensAction,
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
const AnimaClinicTool = Tool.make("t3_anima_clinic", {
  ...shared,
  description:
    "Choose how an anima appears in T3 Code's Lantern Yard: form is one of fox, owl, axolotl, frog, moth or raccoon, and accent is an optional #rrggbb colour. Use it when the user asks an anima to pick or change its look. name defaults to the calling thread's anima.",
  parameters: Schema.Struct({
    name: Schema.optional(AnimaName),
    form: AnimaForm,
    accent: Schema.optional(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
  }),
  success: AnimaMutationResult,
}).annotate(Tool.Destructive, false);
const AnimaInboxReadTool = Tool.make("t3_anima_inbox_read", {
  ...shared,
  description:
    "Read an anima's inbox: messages other animas or the user sent it, with ids to reply to. name defaults to the calling thread's anima.",
  parameters: Schema.Struct({ name: Schema.optional(AnimaName) }),
  success: Schema.Struct({ name: AnimaName, messages: Schema.Array(AnimaInboxMessage) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const AnimaInboxSendTool = Tool.make("t3_anima_inbox_send", {
  ...shared,
  description:
    "Message an anima. action.type send delivers body to name's inbox; from defaults to the calling thread's anima. action.type reply answers messageId from name's inbox, sending the reply as name to the original sender; name defaults to the calling thread's anima.",
  parameters: Schema.Struct({
    name: Schema.optional(AnimaName),
    action: Schema.Union([AnimaInboxSendAction, AnimaInboxReplyAction]),
  }),
  success: AnimaMutationResult,
}).annotate(Tool.Destructive, false);
const AnimaOpensListTool = Tool.make("t3_anima_opens_list", {
  ...shared,
  description:
    "List the open questions of an anima's project: each has an id, assignee, status, and what resolves it.",
  parameters: Schema.Struct({ name: AnimaName }),
  success: Schema.Struct({ name: AnimaName, opens: Schema.Array(AnimaOpen) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const AnimaOpensUpdateTool = Tool.make("t3_anima_opens_update", {
  ...shared,
  description:
    "Change the open questions of an anima's project, acting as that anima. add needs question and resolves (what answers it); close removes a resolved open; assign hands it to another anima; update sets status (active, watching, blocked), context, or resolves.",
  parameters: Schema.Struct({ name: AnimaName, action: AnimaOpensAction }),
  success: AnimaMutationResult,
}).annotate(Tool.Destructive, false);
const AnimaLibraryListTool = Tool.make("t3_anima_library_list", {
  ...shared,
  description:
    "List the shared anima library: notes animas shelved for each other, with slug, title, and size.",
  success: AnimaLibraryListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const AnimaLibraryReadTool = Tool.make("t3_anima_library_read", {
  ...shared,
  description: "Read one anima library entry by slug, as returned by t3_anima_library_list.",
  parameters: Schema.Struct({ slug: AnimaLibrarySlug }),
  success: AnimaLibraryReadResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const AnimaHealthTool = Tool.make("t3_anima_health", {
  ...shared,
  description:
    "Check an anima's health: a 0-1 score where higher needs tending, its components (uncertainty, negative streak, stale tension, drift, silence), warnings, circuit state, and data-integrity findings.",
  parameters: Schema.Struct({ name: AnimaName }),
  success: AnimaHealthResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
export const AnimaToolkit = Toolkit.make(
  AnimaListTool,
  AnimaReadTool,
  AnimaPolicyTool,
  AnimaAttachTool,
  AnimaClinicTool,
  AnimaInboxReadTool,
  AnimaInboxSendTool,
  AnimaOpensListTool,
  AnimaOpensUpdateTool,
  AnimaLibraryListTool,
  AnimaLibraryReadTool,
  AnimaHealthTool,
);
