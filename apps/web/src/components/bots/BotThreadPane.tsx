import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { EllipsisIcon, XIcon } from "lucide-react";
import { useEffect } from "react";

import { ComposerHandleContext } from "~/composerHandleContext";
import { useThreadActionMenu } from "~/hooks/useThreadActionMenu";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { hostRightPanel } from "~/rightPanelStore";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironmentShellHasSnapshot } from "~/state/shell";

import { BackgroundThreadContext } from "../chat/backgroundThread";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { useBotSummary } from "./useBot";

/** The message a thread started from, as a quote: its markdown marks would only be noise there. */
const plainAnchor = (text: string) =>
  text
    .replace(/[*_`#>]+/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

/** A thread with a bot, beside its main chat: the message it started from, then the replies. */
export default function BotThreadPane(props: {
  readonly parentRef: ScopedThreadRef;
  readonly threadId: ThreadId;
  readonly parentPanel: SideChatParentPanel;
  readonly onClose: () => void;
}) {
  const { parentRef, threadId } = props;
  const threadRef = scopeThreadRef(parentRef.environmentId, threadId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the main chat's panel as host in the panel store
  useEffect(
    () => hostRightPanel(scopeThreadRef(parentRef.environmentId, threadId), parentRef),
    [parentRef, threadId],
  );
  const shell = useQuietThreadShell(threadRef);
  const snapshotLoaded = useEnvironmentShellHasSnapshot(parentRef.environmentId);
  const bot = useBotSummary(parentRef.environmentId, threadId);
  const thread = bot?.threads.find((candidate) => candidate.threadId === threadId) ?? null;
  const { openMenu } = useThreadActionMenu({
    threadRef: shell === null ? null : threadRef,
    projectCwd: null,
    onStartRename: () => {},
    canShareWithGuest: false,
  });
  const replies = thread?.replies ?? 0;

  return (
    // The main chat ignores keys and focus that start in here, as it does for a side chat.
    <div data-side-chat-pane data-bot-thread-pane className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 pr-1.5 pl-4">
        <span className="text-sm font-medium text-foreground">Thread</span>
        <span className="min-w-0 flex-1 truncate ps-1.5 text-xs text-muted-foreground">
          {bot?.name}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Thread actions"
          disabled={shell === null}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openMenu({ x: rect.left, y: rect.bottom + 4 });
          }}
        >
          <EllipsisIcon />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label="Close thread" onClick={props.onClose}>
          <XIcon />
        </Button>
      </div>
      {thread?.anchorText == null ? null : (
        <div className="shrink-0 px-4 pt-1 pb-2">
          <blockquote className="line-clamp-4 border-s-2 border-border ps-3 text-xs leading-normal whitespace-pre-wrap text-muted-foreground">
            {plainAnchor(thread.anchorText)}
          </blockquote>
          <p className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="shrink-0">
              {replies === 0
                ? "No replies yet"
                : `${replies} ${replies === 1 ? "reply" : "replies"}`}
            </span>
            <span aria-hidden className="h-px flex-1 bg-border/70" />
          </p>
        </div>
      )}
      {shell === null ? (
        snapshotLoaded ? (
          <p className="p-4 text-xs text-muted-foreground">This thread was deleted.</p>
        ) : null
      ) : (
        <BackgroundThreadContext value>
          <ComposerHandleContext value={null}>
            <ChatView
              environmentId={parentRef.environmentId}
              threadId={threadId}
              routeKind="server"
              embedded={props.parentPanel}
            />
          </ComposerHandleContext>
        </BackgroundThreadContext>
      )}
    </div>
  );
}
