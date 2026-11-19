import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type BotThread,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { MessagesSquareIcon } from "lucide-react";
import { createContext, type ReactNode, use, useRef } from "react";

import { cn } from "~/lib/utils";
import { botsEnvironment } from "~/state/bots";
import { readThreadShell, waitForThreadShell } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isBotThreadId } from "./botView";
import { useBotSummary, useOpenBotThread, useRefreshBots } from "./useBot";

interface BotChatThreads {
  /** The thread each message of the main chat has, by message id. */
  readonly byAnchor: ReadonlyMap<string, BotThread>;
  /** Whether this connection may start a thread; one that exists opens either way. */
  readonly canStart: boolean;
  /** Opens a message's thread, starting it when it has none. */
  readonly reply: (messageId: string) => void;
}

const BotChatThreadsContext = createContext<BotChatThreads | null>(null);

/**
 * Gives the messages of a bot's main chat their threads. Absent everywhere else, a bot's own
 * threads included: a thread has no threads of its own.
 */
export function BotChatThreadsProvider(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly enabled: boolean;
  readonly children: ReactNode;
}) {
  return props.enabled && !isBotThreadId(props.threadId) ? (
    <Provider environmentId={props.environmentId} threadId={props.threadId}>
      {props.children}
    </Provider>
  ) : (
    props.children
  );
}

function Provider(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly children: ReactNode;
}) {
  const gt = useGT();
  const { environmentId, threadId } = props;
  const bot = useBotSummary(environmentId, threadId);
  const startThread = useAtomCommand(botsEnvironment.startThread, { reportFailure: false });
  const openThread = useOpenBotThread();
  const refreshBots = useRefreshBots(environmentId);
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const startingRef = useRef(false);
  const byAnchor = new Map(
    (bot?.threads ?? []).flatMap((thread) =>
      thread.anchorMessageId === null ? [] : [[thread.anchorMessageId, thread] as const],
    ),
  );
  const reply = async (messageId: string) => {
    const existing = byAnchor.get(messageId);
    // The list trails by a few seconds, so a thread closed while empty may still be on it.
    if (
      existing !== undefined &&
      readThreadShell(scopeThreadRef(environmentId, existing.threadId)) !== null
    )
      return openThread(environmentId, existing.threadId);
    if (startingRef.current) return;
    startingRef.current = true;
    const result = await startThread({
      environmentId,
      input: { threadId, anchorMessageId: messageId },
    });
    startingRef.current = false;
    if (result._tag === "Success") {
      // The pane reads the thread from the shell, which trails the command by a moment.
      await waitForThreadShell(scopeThreadRef(environmentId, result.value.threadId));
      refreshBots();
      openThread(environmentId, result.value.threadId);
    } else if (!isAtomCommandInterrupted(result)) {
      toastManager.add({ type: "error", title: gt("Could not start the thread") });
    }
  };
  return (
    <BotChatThreadsContext
      value={{ byAnchor, canStart: canOperate, reply: (messageId) => void reply(messageId) }}
    >
      {props.children}
    </BotChatThreadsContext>
  );
}

/** "Reply in thread" among a message's actions. Renders nothing outside a bot's main chat. */
export function BotReplyInThreadButton(props: { readonly messageId: string }) {
  const gt = useGT();
  const threads = use(BotChatThreadsContext);
  if (threads === null || (!threads.canStart && !threads.byAnchor.has(props.messageId)))
    return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={gt("Reply in thread")}
            onClick={() => threads.reply(props.messageId)}
          />
        }
      >
        <MessagesSquareIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup side="top">
        <T>Reply in thread</T>
      </TooltipPopup>
    </Tooltip>
  );
}

/** "4 replies, last reply 2m ago" under a message that has a thread. */
export function BotThreadMarker(props: {
  readonly messageId: string;
  readonly align: "start" | "end";
}) {
  const gt = useGT();
  const threads = use(BotChatThreadsContext);
  const thread = threads?.byAnchor.get(props.messageId);
  if (threads === null || thread === undefined || thread.replies === 0) return null;
  return (
    <div className={cn("mt-1 flex", props.align === "end" ? "justify-end" : "justify-start")}>
      <button
        type="button"
        data-bot-thread-marker
        className="group/marker flex h-7 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => threads.reply(props.messageId)}
      >
        <MessagesSquareIcon aria-hidden className="size-3.5 text-primary" />
        <span className="font-medium text-primary">
          {gt("{count, plural, one {{count} reply} other {{count} replies}}", {
            count: thread.replies,
          })}
        </span>
        {thread.lastReplyAt === null ? null : (
          <span className="text-muted-foreground group-hover/marker:hidden">
            <T>
              Last reply <RelativeTime timestamp={thread.lastReplyAt} />
            </T>
          </span>
        )}
        <span className="hidden text-muted-foreground group-hover/marker:inline">
          <T>View thread</T>
        </span>
      </button>
    </div>
  );
}
