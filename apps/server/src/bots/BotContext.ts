import type { BotBoardItem, BotBoardThread, BotSummary } from "@t3tools/contracts";

import type { BotRecord } from "./BotStore.ts";

const ITEMS_SHOWN = 30;
const THREADS_PER_ITEM = 8;
const RESULT_CHARS = 300;
const STALE_AFTER_MS = 2 * 60_000;

const RULES = [
  "You are a bot: a long-lived agent the user talks to about work across all their projects. You keep this one conversation and hand the work to threads.",
  "- You have no shell and no file tools, on purpose. Never try to do the work yourself; every piece of work becomes a task.",
  "- Your board is the truth about the work, and it is sent with every turn. Each piece of work is a work item; its threads' status is read from the threads themselves. Trust the board over your memory of this conversation.",
  "- Start a task with delegate_task, target.projectId and workItemId; t3_project_list lists projects. Without workItemId the task gets a new item named after it. Say what done looks like in the task, since it starts with none of this conversation. Use isolation:'worktree' for anything that changes code.",
  "- Omit target.model and the task uses that project's default model, which is usually what you want.",
  "- Tasks run on their own and each one wakes you when it ends, so end your turn right after starting them. Never wait or poll.",
  "- Keep each item's next step current with t3_bot_item_save, and mark it done or dropped when the user agrees it is. A thread finishing does not finish its item.",
  "- When the user states something that should hold from now on (how they like work done, a priority, a standing decision), add it to your charter with t3_bot_charter_set.",
  "- Keep the user's attention: reply briefly, say what you started or what came back with its thread link, and ask only for a decision you cannot make.",
  "- To follow up on a task, t3_thread_send to its thread. To look closer, t3_thread_read. To stop one, task_cancel.",
  "- A status with an old as-of time comes from a machine that is not reachable now; say so instead of guessing.",
].join("\n");

const describeThread = (thread: BotBoardThread, now: string) => {
  const stale =
    Date.parse(thread.asOf) < Date.parse(now) - STALE_AFTER_MS
      ? `, as of ${thread.asOf.slice(0, 16)}`
      : "";
  const result =
    thread.result === null || thread.status === "working"
      ? ""
      : `\n    result: ${thread.result.slice(0, RESULT_CHARS).replaceAll("\n", " ")}`;
  return `  - ${thread.title} (${thread.status}, ${thread.where}${stale}) threadId=${thread.threadId} environmentId=${thread.environmentId}${result}`;
};

const describeItem = (item: BotBoardItem, now: string) =>
  [
    `- ${item.title} [${item.id}]${item.nextStep === "" ? "" : ` next: ${item.nextStep}`}`,
    ...(item.detail === "" ? [] : [`  ${item.detail.replaceAll("\n", " ")}`]),
    ...item.threads.slice(-THREADS_PER_ITEM).map((thread) => describeThread(thread, now)),
  ].join("\n");

/**
 * Sent with every bot turn. Compaction or a new session loses nothing that matters: the charter,
 * the board and the other bots all come from durable state, so the session is disposable.
 */
export function renderBotContext(input: {
  readonly bot: BotRecord | null;
  readonly others: ReadonlyArray<BotSummary>;
  readonly items: ReadonlyArray<BotBoardItem>;
  readonly unfiled: ReadonlyArray<BotBoardThread>;
  readonly now: string;
}): string {
  const shown = input.items.slice(0, ITEMS_SHOWN);
  return [
    "<bot-rules>",
    RULES,
    "</bot-rules>",
    ...(input.bot === null
      ? []
      : [`<charter bot="${input.bot.name}">`, input.bot.charter, "</charter>"]),
    "<other-bots>",
    input.others.length === 0
      ? "None."
      : input.others
          .map((other) => `- ${other.name}: ${other.purpose} (${other.openItems} open items)`)
          .join("\n"),
    "</other-bots>",
    `<board now="${input.now.slice(0, 16)}">`,
    shown.length === 0
      ? "No open work items."
      : shown.map((item) => describeItem(item, input.now)).join("\n"),
    ...(input.items.length > shown.length
      ? [`(${input.items.length - shown.length} older open items; t3_bot_board lists them.)`]
      : []),
    ...(input.unfiled.length === 0
      ? []
      : ["Not on any item:", ...input.unfiled.map((thread) => describeThread(thread, input.now))]),
    "</board>",
  ].join("\n");
}
