import type { EnvironmentId, OrchestrationV2ProjectedTurnItem, ThreadId } from "@t3tools/contracts";
import { parseBotMessage } from "@t3tools/shared/botMessages";
import {
  resolveT3McpToolDefinition,
  resolveT3McpToolId,
} from "@t3tools/shared/t3McpToolPresentation";

import { ledScreen, type SpaceScreen } from "./botSpace.logic";

/** One line of the conversation with the bot in the middle, as the person reads it. */
export type TalkRow =
  | { readonly kind: "you"; readonly id: string; readonly text: string }
  | {
      readonly kind: "reply";
      readonly id: string;
      readonly messageId: string;
      readonly text: string;
      readonly streaming: boolean;
    }
  /** The lead told another bot something, or that bot said something back. */
  | {
      readonly kind: "told" | "heard";
      readonly id: string;
      readonly bot: string;
      readonly text: string;
    }
  | {
      readonly kind: "task";
      readonly id: string;
      readonly environmentId: EnvironmentId | null;
      readonly threadId: ThreadId;
      readonly title: string;
    }
  | { readonly kind: "shown"; readonly id: string; readonly screen: SpaceScreen };

const firstLine = (text: string) => text.trim().split("\n", 1)[0]!.trim();

/**
 * The lead's chat as a conversation: what the person said, what the bot answered, the tasks it
 * started, what it showed, and what it and the other bots told each other. Its other work
 * (reading, saving, recalling) is how it got there, and is left out.
 */
export function talkRows(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  lead: string,
  spokenPrefix: string,
): ReadonlyArray<TalkRow> {
  const rows: TalkRow[] = [];
  for (const { item } of items) {
    if (item.type === "user_message") {
      const fromBot = parseBotMessage(item.text);
      if (fromBot !== null)
        rows.push({ kind: "heard", id: item.id, bot: fromBot.bot, text: fromBot.body });
      else {
        const text = item.text.startsWith(spokenPrefix)
          ? item.text.slice(spokenPrefix.length)
          : item.text;
        if (text.trim() !== "") rows.push({ kind: "you", id: item.id, text: text.trim() });
      }
    } else if (item.type === "assistant_message") {
      if (item.text.trim() !== "")
        rows.push({
          kind: "reply",
          id: item.id,
          messageId: item.messageId,
          text: item.text,
          streaming: item.streaming,
        });
    } else if (item.type === "subagent") {
      const threadId = item.remoteChild?.threadId ?? item.childThreadId;
      if (threadId != null)
        rows.push({
          kind: "task",
          id: item.id,
          environmentId: item.remoteChild?.environmentId ?? null,
          threadId,
          title: item.title?.trim() || firstLine(item.prompt),
        });
    } else if (item.type === "dynamic_tool" && item.status !== "failed") {
      const tool = resolveT3McpToolId(item.toolName);
      const input =
        typeof item.input === "object" && item.input !== null
          ? (item.input as Readonly<Record<string, unknown>>)
          : {};
      if (tool === "t3_bot_tell" && typeof input.bot === "string")
        rows.push({
          kind: "told",
          id: item.id,
          bot: input.bot,
          text: typeof input.message === "string" ? input.message : "",
        });
      else if (tool === "t3_bot_show") {
        const screen = ledScreen(item, lead);
        if (screen !== null) rows.push({ kind: "shown", id: item.id, screen });
      }
    }
  }
  return rows;
}

/**
 * A reply in its two parts. The first paragraph is the answer, said aloud; what follows a
 * blank line is the detail, written for the eye and not read out.
 */
export function replyParts(text: string, streaming: boolean) {
  const trimmed = text.replace(/^\s+/, "");
  const gap = /\n[ \t]*\n/.exec(trimmed);
  return gap === null
    ? { headline: trimmed, headlineDone: !streaming, detail: "" }
    : {
        headline: trimmed.slice(0, gap.index),
        headlineDone: true,
        detail: trimmed.slice(gap.index + gap[0].length).trim(),
      };
}

/** What the lead is doing this instant, in a few words; null when it is doing nothing to name. */
export function leadActivity(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): string | null {
  const last = items.at(-1)?.item;
  if (last === undefined || last.type !== "dynamic_tool" || last.status !== "running") return null;
  const labels = resolveT3McpToolDefinition(last.toolName, last.input)?.labels;
  return labels === undefined ? null : `${labels[1]} ${labels[3]}`;
}
