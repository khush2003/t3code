import { useNavigate } from "@tanstack/react-router";
import type {
  AnimaName,
  AnimaThreadRuntimeStatus,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import {
  ChevronRightIcon,
  InboxIcon,
  LockIcon,
  ScanEyeIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
  WindIcon,
  XIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import type { DraftId } from "../../composerDraftStore";
import { animaEnvironment, useAnimaList } from "../../state/anima";
import { useEnvironmentQuery } from "../../state/query";
import { AnimaLiveDot, RelativeTime } from "../settings/anima/AnimaBits";
import { AnimaSigil } from "../settings/anima/AnimaVisuals";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { AnimaPickerItems } from "./AnimaPickerItems";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";
import { breathsSinceWake } from "./threadAnima.logic";
import { useAnimaBreathe } from "./useAnimaBreathe";
import { useThreadAnimaChoice } from "./useThreadAnimaChoice";

function WakePreviewDialog({
  environmentId,
  name,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly name: AnimaName;
  readonly onClose: () => void;
}) {
  const query = useEnvironmentQuery(
    animaEnvironment.wakePreview({ environmentId, input: { name } }),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Wake preview</DialogTitle>
          <DialogDescription>
            What {name} receives when a thread starts with it. Read-only.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <pre className="max-h-96 overflow-auto rounded-md bg-muted/40 p-2 text-2xs whitespace-pre-wrap">
            {query.data?.payload ?? query.error ?? "Loading..."}
          </pre>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ActionRow({
  icon,
  label,
  trailing,
  tone = "default",
  disabled = false,
  disabledReason,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly trailing?: ReactNode;
  readonly tone?: "default" | "primary";
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
  readonly onClick: () => void;
}) {
  const row = (
    <ThreadDetailsControl
      part="row"
      size="sm"
      variant="ghost"
      tone={tone}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className={`min-w-0 flex-1 truncate ${THREAD_DETAILS_PANEL_LABEL_CLASS}`}>{label}</span>
      {trailing}
    </ThreadDetailsControl>
  );
  if (!disabled || !disabledReason) return row;
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="w-full" />}>{row}</TooltipTrigger>
      <TooltipPopup side="left">{disabledReason}</TooltipPopup>
    </Tooltip>
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What the server-side anima runtime has seen in this thread since the wake. */
function AnimaRuntimeSummary({ status }: { readonly status: AnimaThreadRuntimeStatus }) {
  const breaths = breathsSinceWake(status);
  return (
    <>
      <p className="px-2.5 py-1 text-muted-foreground text-xs tabular-nums">
        {plural(status.toolEvents, "tool call")}
        {breaths === null ? null : ` · ${plural(breaths, "breath")}`} since wake
      </p>
      {status.loop ? (
        <p
          role="status"
          className="flex items-start gap-2.5 px-2.5 py-1 text-warning-foreground text-xs"
        >
          <TriangleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0 text-warning" />
          <span className="min-w-0">
            Possible loop: <span className="font-mono">{status.loop.tool}</span> failed{" "}
            {plural(status.loop.failures, "time")} in a row.
          </span>
        </p>
      ) : null}
    </>
  );
}

function PolicyFires({ fires }: { readonly fires: AnimaThreadRuntimeStatus["fires"] }) {
  if (fires.length === 0) return null;
  return (
    <Collapsible render={<div className="group/policy-fires" />}>
      <CollapsibleTrigger render={<ThreadDetailsControl part="row" size="sm" variant="ghost" />}>
        <ShieldCheckIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span className={`min-w-0 flex-1 truncate ${THREAD_DETAILS_PANEL_LABEL_CLASS}`}>
          Policy fired
        </span>
        <Badge size="sm" variant="secondary">
          {fires.length}
        </Badge>
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 text-muted-foreground transition-transform group-has-[[data-panel-open]]/policy-fires:rotate-90"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto px-2.5 pt-0.5 pb-1.5">
          {fires.map((fire) => (
            <li key={`${fire.ts}:${fire.rule}`} className="min-w-0 text-xs">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="line-clamp-2 min-w-0 flex-1 break-words text-foreground/80">
                  {fire.rule}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  <RelativeTime value={fire.ts} />
                </span>
              </div>
              <div className="line-clamp-2 break-all font-mono text-2xs text-muted-foreground">
                {fire.trigger}
              </div>
            </li>
          ))}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * The thread details rows for the anima a thread runs with: a picker before the first wake, then
 * the anima read-only with what the runtime has seen since, and its actions.
 */
export function ThreadAnimaRows({
  environmentId,
  threadId,
  draftId,
  isServerThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftId?: DraftId | undefined;
  readonly isServerThread: boolean;
}) {
  const navigate = useNavigate();
  const { current, locked, change } = useThreadAnimaChoice({
    environmentId,
    threadId,
    draftId,
    isServerThread,
  });
  const { animas } = useAnimaList(environmentId);
  // Mounted only while the details card shows, so the 5s status refresh never runs unseen.
  const status = useEnvironmentQuery(
    locked ? animaEnvironment.threadStatus({ environmentId, input: { threadId } }) : null,
  ).data;
  const { breathe, isPending, canBreathe } = useAnimaBreathe(
    environmentId,
    isServerThread ? threadId : null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  // An environment without animas has nothing to choose, unless one is already set.
  if (animas.length === 0 && current === null) return null;
  const summary =
    current === null ? null : (animas.find((anima) => anima.name === current) ?? null);

  const breatheReason = !isServerThread
    ? "Send the first message before this anima can breathe."
    : !canBreathe
      ? "You don't have permission to request a breath."
      : isPending
        ? "A breath is already in progress."
        : null;
  const breathDue = status?.breathDue === true && breatheReason === null;

  const openSettings = (name: AnimaName, tab?: "inbox") =>
    void navigate({
      to: "/settings/anima",
      search: { environmentId, anima: name, ...(tab ? { tab } : {}) },
    });

  const currentValue = (
    <span className="flex min-w-0 max-w-[60%] items-center gap-1.5 font-normal text-muted-foreground">
      {summary ? <AnimaSigil anima={summary} size={14} /> : null}
      <span className="min-w-0 truncate">{current ?? "None"}</span>
      {summary ? <AnimaLiveDot live={summary.live} /> : null}
      {locked ? <LockIcon aria-hidden="true" className="size-3 shrink-0" /> : null}
    </span>
  );

  return (
    <>
      {locked ? (
        <Tooltip>
          <TooltipTrigger
            render={<ThreadDetailsControl part="select" render={<div tabIndex={0} />} />}
            aria-label={`Anima: ${current}, locked to this thread`}
          >
            <SparklesIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className={`min-w-0 flex-1 truncate ${THREAD_DETAILS_PANEL_LABEL_CLASS}`}>
              Anima
            </span>
            {currentValue}
          </TooltipTrigger>
          <TooltipPopup side="left">Locked to this thread after its first wake</TooltipPopup>
        </Tooltip>
      ) : (
        <Menu>
          <MenuTrigger render={<ThreadDetailsControl part="select" />} aria-label="Anima">
            <SparklesIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />
            <span className={`min-w-0 flex-1 truncate ${THREAD_DETAILS_PANEL_LABEL_CLASS}`}>
              Anima
            </span>
            {currentValue}
          </MenuTrigger>
          <MenuPopup align="start" side="bottom" className="w-(--anchor-width)">
            <AnimaPickerItems
              animas={animas}
              current={current}
              onChange={(next) => void change(next)}
            />
          </MenuPopup>
        </Menu>
      )}

      {current !== null ? (
        <>
          {status ? <AnimaRuntimeSummary status={status} /> : null}
          <ActionRow
            icon={
              <WindIcon
                aria-hidden="true"
                className={breathDue ? "size-4 shrink-0" : THREAD_DETAILS_PANEL_ICON_CLASS}
              />
            }
            label={
              isPending ? "Breathing…" : breathDue ? "Breath due · Breathe now" : "Breathe now"
            }
            tone={breathDue ? "primary" : "default"}
            disabled={breatheReason !== null}
            disabledReason={breatheReason}
            onClick={() => void breathe()}
          />
          {status ? <PolicyFires fires={status.fires} /> : null}
          {summary && summary.inboxCount > 0 ? (
            <ActionRow
              icon={<InboxIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
              label="Unread inbox"
              trailing={
                <Badge size="sm" variant="info">
                  {summary.inboxCount}
                </Badge>
              }
              onClick={() => openSettings(current, "inbox")}
            />
          ) : null}
          <ActionRow
            icon={<ScanEyeIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
            label="Wake preview"
            onClick={() => setPreviewOpen(true)}
          />
          <ActionRow
            icon={<SettingsIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
            label="Open anima"
            onClick={() => openSettings(current)}
          />
          {locked ? null : (
            <ActionRow
              icon={<XIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
              label="Remove anima"
              onClick={() => void change(null)}
            />
          )}
          {previewOpen ? (
            <WakePreviewDialog
              environmentId={environmentId}
              name={current}
              onClose={() => setPreviewOpen(false)}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
