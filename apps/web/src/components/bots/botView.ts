import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { buildThreadRouteParams } from "~/threadRoutes";

/** What a bot's page shows in place of its chat. Absent means the chat. */
export type BotView = "board" | "files" | "memory";

export interface BotSearch {
  readonly bot?: BotView;
  /** The work item open beside the board. */
  readonly item?: string;
}

export function parseBotSearch(raw: Record<string, unknown>): BotSearch {
  const bot =
    raw.bot === "board" || raw.bot === "files" || raw.bot === "memory" ? raw.bot : undefined;
  return {
    ...(bot === undefined ? {} : { bot }),
    ...(bot === "board" && typeof raw.item === "string" && raw.item !== ""
      ? { item: raw.item.slice(0, 200) }
      : {}),
  };
}

/** `bot:<name>` is a bot's main chat; `bot:<name>:t:<id>` is one of its threads. */
export const isBotThreadId = (threadId: string) => /^bot:[^:]+:t:/.test(threadId);

export function botMainThreadId(threadId: ThreadId): ThreadId {
  return threadId.replace(/^(bot:[^:]+):t:.*$/, "$1") as ThreadId;
}

export function useBotSearch(): BotSearch {
  return parseBotSearch(useSearch({ strict: false }) as Record<string, unknown>);
}

/** Moves between a bot's chat, board, files and memory; they are one page, so the address says which. */
export function useOpenBotView() {
  const navigate = useNavigate();
  return (
    bot: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId },
    search: BotSearch = {},
  ) =>
    navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(
        scopeThreadRef(bot.environmentId, botMainThreadId(bot.threadId)),
      ),
      search,
    });
}
