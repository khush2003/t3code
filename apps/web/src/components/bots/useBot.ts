import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { BotThread, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";

import { useRightPanelStore } from "~/rightPanelStore";
import { botsEnvironment } from "~/state/bots";
import { useEnvironmentQuery } from "~/state/query";
import { buildThreadRouteParams } from "~/threadRoutes";

import { botMainThreadId } from "./botView";

/** A bot's whole board, done work too. Every screen of the bot reads this one query. */
export function useBotBoard(environmentId: EnvironmentId, threadId: ThreadId) {
  return useEnvironmentQuery(
    botsEnvironment.board({
      environmentId,
      input: { threadId: botMainThreadId(threadId), includeClosed: true },
    }),
  );
}

/** The bot a conversation belongs to, with its threads. */
export function useBotSummary(environmentId: EnvironmentId, threadId: ThreadId) {
  const main = botMainThreadId(threadId);
  const { data } = useEnvironmentQuery(botsEnvironment.list({ environmentId, input: {} }));
  return data?.bots.find((bot) => bot.threadId === main) ?? null;
}

/** A bot's threads that have a message in them; one opened and left empty is not a thread yet. */
export const startedBotThreads = (threads: ReadonlyArray<BotThread>) =>
  threads
    .filter((thread) => thread.replies > 0)
    .toSorted((a, b) => (b.lastReplyAt ?? "").localeCompare(a.lastReplyAt ?? ""));

/** Opens a thread beside the bot's main chat, where it is replied to. */
export function useOpenBotThread() {
  const navigate = useNavigate();
  const route = useParams({ strict: false });
  return (environmentId: EnvironmentId, threadId: ThreadId) => {
    const main = scopeThreadRef(environmentId, botMainThreadId(threadId));
    useRightPanelStore.getState().openSideChat(main, threadId);
    if (route.threadId === main.threadId && route.environmentId === environmentId) return;
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(main) });
  };
}
