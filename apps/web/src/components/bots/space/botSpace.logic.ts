import { liveThoughtLine } from "@t3tools/client-runtime/work-log/presentation";
import {
  EnvironmentId,
  ThreadId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import { resolveT3McpToolId } from "@t3tools/shared/t3McpToolPresentation";

const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const SENTENCE_END = /[.!?…]["')\]]*\s+/g;

function sayable(markdown: string) {
  return (
    markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // An address is for the eye: a thread link or a URL said aloud is noise.
      .replace(/<[a-z][a-z0-9+.-]*:\/\/[^>\s]*>|\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
      // A name like node_modules is said, and read, as its words.
      .replace(/(?<=\w)_+(?=\w)/g, " ")
      .replace(/[*_~#`]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const LONG_UNIT = 80;
const CLAUSE_END = /[,;:]\s+/g;

/** A long sentence in clauses, so the voice starts on its first part while the rest is made. */
function clauses(sentence: string): ReadonlyArray<string> {
  if (sentence.length <= LONG_UNIT) return [sentence];
  const parts: string[] = [];
  let from = 0;
  for (const match of sentence.matchAll(CLAUSE_END)) {
    const end = match.index + match[0].length;
    // A clause too short to be worth its own breath stays with what follows.
    if (end - from < 30 || sentence.length - end < 20) continue;
    parts.push(sentence.slice(from, end).trim());
    from = end;
  }
  parts.push(sentence.slice(from).trim());
  return parts;
}

/**
 * What of a reply is said aloud, cut into the pieces a voice says one at a time. Code and tables
 * are for the eye and are left out. A piece is given only once it is whole, so the pieces of a
 * reply still arriving never change: say `units.slice(said)` each time more text comes.
 */
export function spokenUnits(markdown: string, done: boolean): ReadonlyArray<string> {
  const units: string[] = [];
  const lines = markdown.split("\n");
  // Without its newline the last line may still grow; a fence could be half of its marker.
  const open = done ? null : lines.pop()!;
  let fenced = false;
  const take = (line: string, whole: boolean) => {
    if (FENCE.test(line)) {
      if (whole) fenced = !fenced;
      return;
    }
    if (fenced || TABLE_ROW.test(line) || RULE.test(line)) return;
    let from = 0;
    for (const match of line.matchAll(SENTENCE_END)) {
      const end = match.index + match[0].length;
      const unit = sayable(line.slice(from, end));
      if (unit !== "") units.push(...clauses(unit));
      from = end;
    }
    if (!whole) return;
    const rest = sayable(line.slice(from));
    if (rest !== "") units.push(...clauses(rest));
  };
  for (const line of lines) take(line, true);
  if (open !== null) take(open, false);
  return units;
}

/** `x` and `y` are parts of the view's half width and half height; `z` is depth behind the centre. */
export interface BotStarPlace {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

const ARC = (50 * Math.PI) / 180;

/**
 * Where each bot hangs. The one that oversees the others is at the centre; the rest sit to its
 * left and right, the side taken from their name, so the middle column stays clear for the
 * centre's label and what is being said. A crowded side staggers into two rings.
 */
export function placeBotStars(
  bots: ReadonlyArray<{ readonly name: string; readonly oversees: boolean }>,
): ReadonlyMap<string, BotStarPlace> {
  const places = new Map<string, BotStarPlace>();
  const centre = bots.find((bot) => bot.oversees) ?? bots[0];
  if (centre === undefined) return places;
  places.set(centre.name, { x: 0, y: 0, z: 0 });
  const around = bots
    .filter((bot) => bot !== centre)
    .map((bot) => ({ name: bot.name, seed: hash(bot.name) }))
    .toSorted((a, b) => a.seed - b.seed || a.name.localeCompare(b.name));
  const right = around.filter((bot) => bot.seed % 2 === 0);
  const left = around.filter((bot) => bot.seed % 2 === 1);
  // One lopsided side reads as a mistake; the fuller side lends its last bot to the other.
  while (Math.abs(right.length - left.length) > 1)
    (right.length > left.length ? left : right).push(
      (right.length > left.length ? right : left).pop()!,
    );
  for (const [side, direction] of [
    [right, 1],
    [left, -1],
  ] as const)
    side.forEach((bot, index) => {
      const angle = ARC * (((index + 0.5) / side.length) * 2 - 1);
      const reach = side.length > 3 && index % 2 === 1 ? 0.62 : 0.86;
      places.set(bot.name, {
        x: direction * Math.cos(angle) * reach,
        y: Math.sin(angle) * 0.8,
        z: -(((bot.seed >>> 20) % 100) / 100) * 2,
      });
    });
  return places;
}

/** One thing held up beside a bot for the person to look at. */
export type SpaceScreen =
  | { readonly kind: "board"; readonly bot: string }
  | {
      readonly kind: "task";
      /** Whose task it is, when that is known. */
      readonly bot: string | null;
      /** Null for the machine the bots live on. */
      readonly environmentId: EnvironmentId | null;
      readonly threadId: ThreadId;
    }
  /** `file` is an id, or the words a bot named the file by. */
  | { readonly kind: "file"; readonly bot: string; readonly file: string };

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value : null);

/**
 * What the bot in the middle is looking at or has just started, as the screen that shows it:
 * the board it reads, the task it starts or reads, the bot it asks, the thing it chose to show.
 * Null for everything else it does.
 */
function ledScreen(item: OrchestrationV2TurnItem, lead: string): SpaceScreen | null {
  if (item.type === "subagent") {
    const threadId = item.remoteChild?.threadId ?? item.childThreadId;
    return threadId == null
      ? null
      : {
          kind: "task",
          bot: lead,
          environmentId: item.remoteChild?.environmentId ?? null,
          threadId,
        };
  }
  if (item.type !== "dynamic_tool") return null;
  const input =
    typeof item.input === "object" && item.input !== null
      ? (item.input as Readonly<Record<string, unknown>>)
      : {};
  const task = (threadId: string | null, bot: string | null): SpaceScreen | null =>
    threadId === null
      ? null
      : {
          kind: "task",
          bot,
          environmentId:
            text(input.environmentId) === null
              ? null
              : EnvironmentId.make(input.environmentId as string),
          threadId: ThreadId.make(threadId),
        };
  switch (resolveT3McpToolId(item.toolName)) {
    case "t3_bot_board":
      return { kind: "board", bot: text(input.bot) ?? lead };
    case "t3_bot_tell":
      return text(input.bot) === null ? null : { kind: "board", bot: input.bot as string };
    case "t3_thread_read":
    case "t3_thread_send":
      return task(text(input.threadId), null);
    case "t3_bot_show": {
      const bot = text(input.bot) ?? lead;
      const file = text(input.file);
      return file !== null
        ? { kind: "file", bot, file }
        : (task(text(input.thread), text(input.bot)) ?? { kind: "board", bot });
    }
    default:
      return null;
  }
}

/**
 * The newest thing the bot in the middle looked at since `from`, with the item that says so.
 * `shown` is true when the bot chose to show it, which outranks a screen the person opened;
 * what it merely looked at on the way does not.
 */
export function lastLedScreen(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  from: number,
  lead: string,
): { readonly id: string; readonly screen: SpaceScreen; readonly shown: boolean } | null {
  for (const { position, item } of items.toReversed()) {
    if (position <= from) return null;
    const screen = item.status === "failed" ? null : ledScreen(item, lead);
    if (screen !== null)
      return {
        id: item.id,
        screen,
        shown: item.type === "dynamic_tool" && resolveT3McpToolId(item.toolName) === "t3_bot_show",
      };
  }
  return null;
}

const HEADLINE_UNITS = 3;
const ENDS_SENTENCE = /[.!?…]["')\]]*$/;

/**
 * What of a reply is said aloud. One the person asked for is said whole. One that came by itself
 * is said as far as its first sentence, its headline; the rest is on the page to read.
 */
export function unitsToSay(units: ReadonlyArray<string>, asked: boolean): ReadonlyArray<string> {
  if (asked) return units;
  const end = units.slice(0, HEADLINE_UNITS).findIndex((unit) => ENDS_SENTENCE.test(unit));
  return units.slice(0, end === -1 ? HEADLINE_UNITS : end + 1);
}

/**
 * The lead's replies since `from`, each with whether the person asked for it here. One that
 * came by itself, when a task ended or another bot answered, was not asked for.
 */
export function repliesToSay(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  from: number,
  spokenPrefix: string,
) {
  // A turn that starts by itself has no message of the person's, so replies go by their turn.
  const asked = new Set<string | null>();
  const replies: Array<{
    readonly messageId: string;
    readonly text: string;
    readonly streaming: boolean;
    readonly asked: boolean;
  }> = [];
  for (const { position, item } of items) {
    if (item.type === "user_message") {
      if (item.text.startsWith(spokenPrefix)) asked.add(item.runId);
    } else if (position > from && item.type === "assistant_message" && item.text.trim() !== "")
      replies.push({
        messageId: item.messageId,
        text: item.text,
        streaming: item.streaming,
        asked: asked.has(item.runId),
      });
  }
  return replies;
}

export interface TaskFeedLine {
  readonly id: string;
  /** What the agent wrote, or one thing it did. */
  readonly kind: "says" | "does";
  readonly text: string;
}

const FEED_CHARS = 260;
const short = (value: string) =>
  value.length <= FEED_CHARS ? value : `${value.slice(0, FEED_CHARS).trimEnd()}…`;

/** The last things a task wrote and did, oldest first, as lines short enough to watch go by. */
export function taskFeed(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  limit: number,
): ReadonlyArray<TaskFeedLine> {
  const lines: TaskFeedLine[] = [];
  for (const { item } of items.toReversed()) {
    if (lines.length === limit) break;
    const line = ((): string | null => {
      switch (item.type) {
        case "assistant_message":
          return spokenUnits(item.text, !item.streaming).join(" ") || null;
        case "reasoning":
          return liveThoughtLine(item.text) || null;
        case "command_execution":
          return `$ ${item.input.split("\n")[0]!.trim()}`;
        case "file_change":
          return item.fileName;
        case "file_search":
          return item.pattern ?? null;
        case "web_search":
          return item.patterns?.[0] ?? null;
        default:
          return null;
      }
    })();
    if (line !== null)
      lines.push({
        id: item.id,
        kind: item.type === "assistant_message" ? "says" : "does",
        text: short(line),
      });
  }
  return lines.toReversed();
}
