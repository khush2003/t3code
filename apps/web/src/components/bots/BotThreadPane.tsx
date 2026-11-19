import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthOrchestrationOperateScope,
  type ScopedThreadRef,
  type ThreadId,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { EllipsisIcon, XIcon } from "lucide-react";
import { useEffect } from "react";

import { ComposerHandleContext } from "~/composerHandleContext";
import { useThreadActions } from "~/hooks/useThreadActions";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { hostRightPanel } from "~/rightPanelStore";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironmentScope } from "~/state/session";
import { useEnvironmentShellHasSnapshot } from "~/state/shell";
import { buildThreadRouteParams } from "~/threadRoutes";

import { BackgroundThreadContext } from "../chat/backgroundThread";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { useBotSummary, useRefreshBots } from "./useBot";

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
  const gt = useGT();
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
  const actions = useThreadActions();
  const navigate = useNavigate();
  const refreshBots = useRefreshBots(parentRef.environmentId);
  const canOperate = useEnvironmentScope(parentRef.environmentId, AuthOrchestrationOperateScope);
  const openPage = () =>
    navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
  // Settled or deleted, the thread leaves the bot's threads, so its tab goes with it.
  const putAway = async (act: (ref: ScopedThreadRef) => Promise<{ readonly _tag: string }>) => {
    const result = await act(threadRef);
    if (result._tag !== "Success") return;
    refreshBots();
    props.onClose();
  };
  const settled = shell?.settledOverride === "settled";
  const replies = thread?.replies ?? 0;

  return (
    // The main chat ignores keys and focus that start in here, as it does for a side chat.
    <div data-side-chat-pane data-bot-thread-pane className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 pr-1.5 pl-4">
        <span className="text-sm font-medium text-foreground">
          <T>Thread</T>
        </span>
        <span className="min-w-0 flex-1 truncate ps-1.5 text-xs text-muted-foreground">
          {bot?.name}
        </span>
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost" size="icon-xs" aria-label={gt("Thread actions")} />}
            disabled={shell === null}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={() => void openPage()}>
              <T>Open as a page</T>
            </MenuItem>
            {settled ? (
              <MenuItem
                disabled={!canOperate}
                onClick={() => void actions.unsettleThread(threadRef).then(refreshBots)}
              >
                <T>Bring thread back</T>
              </MenuItem>
            ) : (
              <MenuItem disabled={!canOperate} onClick={() => void putAway(actions.settleThread)}>
                <T>Settle thread</T>
              </MenuItem>
            )}
            <MenuItem
              disabled={!canOperate}
              onClick={() => void putAway(actions.confirmAndDeleteThread)}
            >
              <T>Delete thread</T>
            </MenuItem>
          </MenuPopup>
        </Menu>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={gt("Close thread")}
          onClick={props.onClose}
        >
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
              {gt(
                "{count, plural, =0 {No replies yet} one {{count} reply} other {{count} replies}}",
                { count: replies },
              )}
            </span>
            <span aria-hidden className="h-px flex-1 bg-border/70" />
          </p>
        </div>
      )}
      {shell === null ? (
        snapshotLoaded ? (
          <p className="p-4 text-xs text-muted-foreground">
            <T>This thread was deleted.</T>
          </p>
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
