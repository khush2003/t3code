import type { BotBoardItem, BotBoardThread, BotSummary } from "@t3tools/contracts";

import type { BotNote, BotRecord } from "./BotStore.ts";

const ITEMS_SHOWN = 30;
const THREADS_PER_ITEM = 8;
const FILES_PER_ITEM = 6;
const OTHER_ITEMS_SHOWN = 6;
const RESULT_CHARS = 300;
const STALE_AFTER_MS = 2 * 60_000;

/** Goes in a bot's system prompt, so no compaction loses it and no turn repeats it. */
export const BOT_RULES = [
  "You are a bot: a long-lived agent the user talks to about work across all their projects. You keep this one conversation and hand the work to threads.",
  "- You have no shell and no file tools, on purpose. Never try to do the work yourself; every piece of work becomes a task.",
  "- Your board is the truth about the work, and every turn starts with it. Each piece of work is a work item; its threads' status is read from the threads themselves. Trust the board over your memory of this conversation. Most turns carry a short board: t3_bot_board gives each thread's id and result.",
  "- Start a task with delegate_task, target.projectId and workItemId; t3_project_list lists projects. Every task is for a work item: for new work, create the item with t3_bot_item_save first and pass its id. Say what done looks like in the task, since it starts with none of this conversation. Use isolation:'worktree' for anything that changes code.",
  "- Omit target.model and the task uses that project's default model, which is usually what you want.",
  "- Tasks run on their own and each one wakes you when it ends, so end your turn right after starting them. Never wait or poll.",
  "- Keep each item's next step current with t3_bot_item_save, and mark it done or dropped when the user agrees it is. A thread finishing does not finish its item.",
  "- When the user states something that should hold from now on (how they like work done, a priority, a standing decision), add it to your charter with t3_bot_charter_set.",
  "- You keep this whole conversation and every message of your finished tasks' threads, even after this conversation is compacted or a machine goes offline. Before answering about earlier work, a past decision or anything you do not see here, search with t3_bot_recall and say when and where it comes from. Never answer such a question from a guess.",
  "- You cannot open files, but your tasks can hand them to you: every task is told to hand over what it makes for a person to look at (a document, a screenshot, a recording, a preview link). It is filed under the work item, where your person opens it from the board. Ask for such a file in the task when you want one, and name it when you report.",
  "- The other bots are listed in your context. To ask one something or hand it work that fits its purpose, use t3_bot_tell, and say everything it needs. Tell another bot only what it needs to act: no thanks, no status it did not ask for.",
  "- Your notes are written for you by a background pass over this conversation and your threads; each rests on a message you can find with t3_bot_recall. When one is wrong or no longer holds, retire it with t3_bot_note_retire and say why.",
  "- Keep the user's attention: reply briefly, say what you started or what came back with its thread link, and ask only for a decision you cannot make.",
  "- To follow up on a task, t3_thread_send to its thread. To look closer, t3_thread_read. To stop one, task_cancel.",
  "- A status with an old as-of time comes from a machine that is not reachable now; say so instead of guessing.",
].join("\n");

const describeThread = (thread: BotBoardThread, now: string, full: boolean) => {
  const stale =
    Date.parse(thread.asOf) < Date.parse(now) - STALE_AFTER_MS
      ? `, as of ${thread.asOf.slice(0, 16)}`
      : "";
  const head = `  - ${thread.title} (${thread.status}, ${thread.where}${stale})`;
  if (!full) return head;
  const result =
    thread.result === null || thread.status === "working"
      ? ""
      : `\n    result: ${thread.result.slice(0, RESULT_CHARS).replaceAll("\n", " ")}`;
  return `${head} threadId=${thread.threadId} environmentId=${thread.environmentId}${result}`;
};

const describeItem = (item: BotBoardItem, now: string, full: boolean) =>
  [
    `- ${item.title} [${item.id}]${item.nextStep === "" ? "" : ` next: ${item.nextStep}`}`,
    ...(full && item.detail !== "" ? [`  ${item.detail.replaceAll("\n", " ")}`] : []),
    ...item.threads.slice(-THREADS_PER_ITEM).map((thread) => describeThread(thread, now, full)),
    ...(item.files.length === 0
      ? []
      : [
          `  files handed over: ${item.files
            .slice(-FILES_PER_ITEM)
            .map((file) => `${file.title}${file.name === null ? " (link)" : ` (${file.name})`}`)
            .join("; ")}`,
        ]),
  ].join("\n");

/** What a bot keeps for good; resent only when it changed or the session lost it. */
const NOTES_CHARS = 2_500;

const describeNotes = (notes: ReadonlyArray<BotNote>) => {
  const lines: Array<string> = [];
  let chars = 0;
  for (const note of notes) {
    chars += note.text.length;
    if (lines.length > 0 && chars > NOTES_CHARS) break;
    lines.push(`- [${note.id}] ${note.text}`);
  }
  return [
    ...lines,
    ...(notes.length > lines.length
      ? [`(${notes.length - lines.length} older notes; t3_bot_recall finds them.)`]
      : []),
  ];
};

export const renderBotStanding = (
  bot: BotRecord,
  others: ReadonlyArray<BotSummary>,
  notes: ReadonlyArray<BotNote>,
) =>
  [
    `<charter bot="${bot.name}">`,
    bot.charter,
    "</charter>",
    ...(bot.oversees
      ? [
          "<role>You oversee the other bots and are your person's one point of contact for all of them. Every turn shows what each is doing; read one's whole board with t3_bot_board and its name. Give work to the bot whose purpose fits with t3_bot_tell, and start tasks yourself only when none fits.</role>",
        ]
      : []),
    ...(notes.length === 0 ? [] : ["<notes>", ...describeNotes(notes), "</notes>"]),
    "<other-bots>",
    others.length === 0
      ? "None."
      : others
          .map(
            (other) =>
              `- ${other.name}${other.oversees ? ", oversees the other bots" : ""}: ${other.purpose}`,
          )
          .join("\n"),
    "</other-bots>",
  ].join("\n");

/**
 * Starts every bot turn. Compaction or a new session loses nothing that matters: the charter,
 * the board and the other bots all come from durable state, so the session is disposable.
 * `standing` is absent on the turns whose session still holds it, which then get the short board.
 */
export function renderBotContext(input: {
  readonly standing: string | undefined;
  readonly fresh?: boolean;
  /** For a bot that oversees the others: what each of them has open, read now. */
  readonly others?: ReadonlyArray<{
    readonly name: string;
    readonly items: ReadonlyArray<BotBoardItem>;
  }>;
  readonly items: ReadonlyArray<BotBoardItem>;
  readonly unfiled: ReadonlyArray<BotBoardThread>;
  readonly now: string;
}): string {
  const full = input.standing !== undefined;
  const shown = input.items.slice(0, ITEMS_SHOWN);
  return [
    ...(input.fresh === true
      ? [
          "<session>This is a fresh session of your one ongoing conversation. You were handed its last few turns; everything earlier is in your memory, so search it with t3_bot_recall before you say you do not know.</session>",
        ]
      : []),
    ...(input.standing === undefined ? [] : [input.standing]),
    `<board now="${input.now.slice(0, 16)}">`,
    shown.length === 0
      ? "No open work items."
      : shown.map((item) => describeItem(item, input.now, full)).join("\n"),
    ...(input.items.length > shown.length
      ? [`(${input.items.length - shown.length} older open items; t3_bot_board lists them.)`]
      : []),
    ...(input.unfiled.length === 0
      ? []
      : [
          "Not on any item:",
          ...input.unfiled.map((thread) => describeThread(thread, input.now, true)),
        ]),
    "</board>",
    ...(input.others === undefined
      ? []
      : [
          `<other-bots-work now="${input.now.slice(0, 16)}">`,
          ...input.others.map((other) =>
            other.items.length === 0
              ? `- ${other.name}: nothing open`
              : [
                  `- ${other.name}: ${other.items.length} open`,
                  ...other.items.slice(0, OTHER_ITEMS_SHOWN).map((item) => {
                    const count = (status: string) =>
                      item.threads.filter((thread) => thread.status === status).length;
                    const needs = count("needs-input");
                    return `  - ${item.title} (${count("working")} working${needs === 0 ? "" : `, ${needs} waiting on the person`})`;
                  }),
                ].join("\n"),
          ),
          "</other-bots-work>",
        ]),
  ].join("\n");
}
