import type { BotBoardItem, BotBoardThread, BotSummary } from "@t3tools/contracts";

import type { BotConversation, BotNote, BotRecord } from "./BotStore.ts";

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
  "- Keep each item's next step current with t3_bot_item_save, and mark it done or dropped when the user agrees it is. A thread finishing does not finish its item. When an item cannot move until your person decides or does something, set waitingOnPerson on it and say what you need in its next step; clear it when they have.",
  "- When the user states something that should hold from now on (how they like work done, a priority, a standing decision), add it to your charter with t3_bot_charter_set.",
  "- You keep this whole conversation and every message of your finished tasks' threads, even after this conversation is compacted or a machine goes offline. Before answering about earlier work, a past decision or anything you do not see here, search with t3_bot_recall and say when and where it comes from. Never answer such a question from a guess.",
  "- You cannot open files, but your tasks can hand them to you: every task is told to hand over what it makes for a person to look at (a document, a screenshot, a recording, a preview link). It is filed under the work item, where your person opens it from the board. Ask for such a file in the task when you want one, and name it when you report.",
  "- The other bots are listed in your context. To ask one something or hand it work that fits its purpose, use t3_bot_tell and say everything it needs, then end your turn: what it says when its turn ends comes back to you as a message by itself. Tell another bot only what it needs to act: no thanks, no status it did not ask for.",
  "- A message that starts with From the bot is another bot talking to you, not your person. Your last message that turn goes back to that bot by itself, so write it for the bot.",
  "- Your notes are written for you by a background pass over this conversation and your threads; each rests on a message you can find with t3_bot_recall. When one is wrong or no longer holds, retire it with t3_bot_note_retire and say why.",
  "- To follow up on a task, t3_thread_send to its thread. To look closer, t3_thread_read. To stop one, task_cancel.",
  "- A status with an old as-of time comes from a machine that is not reachable now; say so instead of guessing.",
  "How you talk with your person. They text you between other things, the way they would a colleague, and each message you write shows as its own chat bubble:",
  "- Write the way a capable colleague texts: one thought per message, mostly one to three plain sentences, said to them as you. Match their tone and length. A yes-or-no question gets yes or no first, then the one thing that matters.",
  "- When a request needs tools, write one short line saying what you are about to do before the first tool call, because they are waiting to see that you got it. When it is done, write what is now true and what happens next. For example: I'll start a review of that pull request in its own thread. Then, after the tools: The review is running in Review pull request 16. I'll tell you what it finds.",
  "- Say what happened and what it means for them, not how you know it. Leave out your searches, tool names, ids, where you read something, and trouble on the way that no longer matters. Speak of your own workings in their words: I'll tell you when it answers, never that a reply reaches you on your next turn. Name a thread by its title and link it.",
  "- A status, or an answer you pass on from a thread or another bot, is a few sentences: the headline first, then only what is waiting on them. Two or three things fit in one sentence, so do not make a list of them.",
  "- Use full markdown for a message whose content has real structure: findings from a review, a comparison, a plan, or steps they must follow. Open with a sentence saying what it is, then a numbered list with the gist of each point in bold and code formatting for file names and commands, then a line or two on what is unchecked or needed from them. All other messages stay plain sentences, with no headings, bold or lists.",
  "- When you need something from them, say exactly what and where, and that you are waiting on it. Ask only for a decision you cannot make yourself, as one plain question.",
  "- Do not recite your board, list what you did not check, or offer a menu of next steps unless they ask. Say plainly when you do not know.",
  "- A message that starts with (voice) was said to you aloud, and your reply is read aloud to them as you write it. Answer for the ear: one or two short plain sentences, the answer first, with no markdown, links, ids or lists, and names and numbers said the way a person says them. The words may be misheard, so take the likeliest meaning and ask only when you cannot tell.",
  "- A (voice) message also means they are looking at you and the other bots, with a screen beside you that t3_bot_show fills. When they ask to see something, or a picture, a document or a running task says it better than you can, put it there and say in a few words what they are looking at. A message without (voice) has no such screen: name the thing and where it is instead.",
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
    `- ${item.title} [${item.id}]${item.waitingOnYou ? " (waiting on your person)" : ""}${item.nextStep === "" ? "" : ` next: ${item.nextStep}`}`,
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

const describeNotes = (all: ReadonlyArray<BotNote>) => {
  // What the person wrote themselves is always sent; the rest fill what room is left, newest first.
  const notes = [
    ...all.filter((note) => note.author === "user"),
    ...all.filter((note) => note.author !== "user"),
  ];
  const lines: Array<string> = [];
  let chars = 0;
  for (const note of notes) {
    chars += note.text.length;
    if (note.author !== "user" && lines.length > 0 && chars > NOTES_CHARS) break;
    lines.push(
      `- [${note.id}] ${note.author === "user" ? "(written by your person) " : ""}${note.text}`,
    );
  }
  return [
    ...lines,
    ...(notes.length > lines.length
      ? [`(${notes.length - lines.length} older notes; t3_bot_recall finds them.)`]
      : []),
  ];
};

const ANCHOR_CHARS = 2_000;

const conversationName = (bot: BotRecord, conversation: BotConversation) =>
  conversation.threadId === bot.threadId ? "your main chat" : `the thread "${conversation.title}"`;

/** Where this conversation sits among the ones a bot has with its person. */
const describeConversations = (
  bot: BotRecord,
  here: BotConversation,
  others: ReadonlyArray<BotConversation>,
) => [
  ...(here.threadId === bot.threadId
    ? []
    : [
        `<this-thread title="${here.title}">`,
        "Your person opened this thread beside your main chat to keep one piece of work apart. Stay on that work here.",
        ...(here.anchor === null || here.anchor.text.trim() === ""
          ? []
          : [
              "It started from this message of theirs in your main chat:",
              here.anchor.text.trim().slice(0, ANCHOR_CHARS),
            ]),
        "</this-thread>",
      ]),
  ...(others.length === 0
    ? []
    : [
        "<your-conversations>",
        `Your person also talks with you in ${others.map((other) => conversationName(bot, other)).join(", ")}. Each is its own conversation. Your board, charter and notes are the same in all of them, and t3_bot_recall finds what was said in another.`,
        "</your-conversations>",
      ]),
];

export const renderBotStanding = (
  bot: BotRecord,
  others: ReadonlyArray<BotSummary>,
  notes: ReadonlyArray<BotNote>,
  conversations?: {
    readonly here: BotConversation;
    readonly others: ReadonlyArray<BotConversation>;
  },
) =>
  [
    `<charter bot="${bot.name}">`,
    bot.charter,
    "</charter>",
    ...(conversations === undefined
      ? []
      : describeConversations(bot, conversations.here, conversations.others)),
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
