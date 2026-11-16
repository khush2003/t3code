import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  BotBoardItem,
  BotBoardThread,
  BotThreadStatus,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { cn } from "~/lib/utils";
import { botsEnvironment } from "../../state/bots";
import { useEnvironment } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { buildThreadRouteParams } from "../../threadRoutes";
import { RelativeTime } from "../RelativeTime";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { ThreadDetailsSection } from "./ThreadDetailsSection";

/** A status read longer ago than this came from a machine that is not reachable now. */
const STALE_AFTER_MS = 2 * 60_000;

const STATUS: Record<BotThreadStatus, { readonly label: string; readonly dot: string }> = {
  working: { label: "Working", dot: "bg-primary" },
  "needs-input": { label: "Needs you", dot: "bg-warning" },
  completed: { label: "Done", dot: "bg-muted-foreground/40" },
  failed: { label: "Failed", dot: "bg-destructive" },
  stopped: { label: "Stopped", dot: "bg-muted-foreground/40" },
  idle: { label: "Idle", dot: "bg-muted-foreground/40" },
  unknown: { label: "Unknown", dot: "bg-muted-foreground/40" },
};

function BoardThreadRow(props: { readonly thread: BotBoardThread; readonly readAt: number }) {
  const { thread } = props;
  const navigate = useNavigate();
  const environment = useEnvironment(thread.environmentId);
  const status = STATUS[thread.status];
  const stale = Date.parse(thread.asOf) < props.readAt - STALE_AFTER_MS;
  return (
    <li className="flex h-8 items-center rounded-lg">
      <Tooltip>
        <TooltipTrigger
          delay={200}
          render={
            <ThreadDetailsControl
              size="sm"
              variant="ghost"
              part="row"
              aria-disabled={environment === null || undefined}
              onClick={() => {
                if (environment === null) return;
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(
                    scopeThreadRef(thread.environmentId, thread.threadId),
                  ),
                });
              }}
            />
          }
        >
          <span aria-hidden className={cn("ms-1 size-1.5 shrink-0 rounded-full", status.dot)} />
          <span className="min-w-0 flex-1 truncate text-left text-sm font-medium leading-4 text-foreground/85">
            {thread.title}
          </span>
          <span
            className={cn(
              "shrink-0 text-2xs",
              thread.status === "failed"
                ? "text-destructive"
                : thread.status === "needs-input"
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {thread.where} · {status.label}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="left">
          <span className="block max-w-72">
            {stale ? (
              <span className="block font-medium">
                Last heard <RelativeTime timestamp={thread.asOf} />. Its machine is not reachable
                now.
              </span>
            ) : null}
            {thread.result === null ? null : (
              <span className="line-clamp-6 block whitespace-pre-wrap">{thread.result}</span>
            )}
            <span className="block text-muted-foreground">
              {environment === null
                ? "Connect to its machine to open the thread."
                : "Open the thread"}
            </span>
          </span>
        </TooltipPopup>
      </Tooltip>
    </li>
  );
}

function BoardItem(props: { readonly item: BotBoardItem; readonly readAt: number }) {
  const { item } = props;
  return (
    <li>
      <div className="px-2.5 pt-1.5 pb-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium",
              item.state === "open" ? "text-foreground/85" : "text-muted-foreground line-through",
            )}
          >
            {item.title}
          </span>
          {item.state === "open" ? null : (
            <span className="shrink-0 text-2xs text-muted-foreground">
              {item.state === "done" ? "Done" : "Dropped"}
            </span>
          )}
        </div>
        {item.nextStep === "" || item.state !== "open" ? null : (
          <p className="line-clamp-2 text-2xs text-muted-foreground">Next: {item.nextStep}</p>
        )}
      </div>
      {item.threads.length === 0 ? null : (
        <ul className="m-0 list-none p-0">
          {item.threads.map((thread) => (
            <BoardThreadRow
              key={`${thread.environmentId}:${thread.threadId}`}
              thread={thread}
              readAt={props.readAt}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A bot's work items and what each of their threads is doing, as the server reads them. */
export function ThreadBotBoardPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const query = useEnvironmentQuery(
    botsEnvironment.board({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, ...(showClosed ? { includeClosed: true } : {}) },
    }),
  );
  const board = query.data;
  const empty = board !== null && board.items.length === 0 && board.unfiled.length === 0;
  return (
    <ThreadDetailsSection
      headingId="thread-details-bot-board-heading"
      title="Board"
      data-thread-bot-board
      actions={
        <ThreadDetailsControl
          size="xs"
          variant="ghost"
          part="meta"
          tone="muted"
          aria-pressed={showClosed}
          onClick={() => setShowClosed(!showClosed)}
        >
          {showClosed ? "Hide closed" : "Show closed"}
        </ThreadDetailsControl>
      }
    >
      <div>
        {board === null ? (
          query.error === null ? null : (
            <p className="px-2.5 py-1 text-2xs text-muted-foreground">
              The board could not be read.
            </p>
          )
        ) : empty ? (
          <p className="px-2.5 py-1 text-2xs text-muted-foreground">
            {showClosed ? "No work items yet." : "No open work."}
          </p>
        ) : (
          <ul className="m-0 max-h-[min(28rem,55dvh)] list-none overflow-y-auto overscroll-contain p-0">
            {board.items.map((item) => (
              <BoardItem key={item.id} item={item} readAt={query.dataUpdatedAt} />
            ))}
            {board.unfiled.length === 0 ? null : (
              <li>
                <p className="px-2.5 pt-1.5 pb-0.5 text-2xs text-muted-foreground">
                  Not on any item
                </p>
                <ul className="m-0 list-none p-0">
                  {board.unfiled.map((thread) => (
                    <BoardThreadRow
                      key={`${thread.environmentId}:${thread.threadId}`}
                      thread={thread}
                      readAt={query.dataUpdatedAt}
                    />
                  ))}
                </ul>
              </li>
            )}
          </ul>
        )}
      </div>
    </ThreadDetailsSection>
  );
}
