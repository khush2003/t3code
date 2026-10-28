import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AnimaName, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { LockIcon, ScanEyeIcon, SettingsIcon, SparklesIcon, WindIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { animaEnvironment, describeAnimaError, useAnimaList } from "../../state/anima";
import { useQuietThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { AnimaAccentDot, AnimaLiveDot } from "../settings/anima/AnimaBits";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
} from "./threadDetailsPanelStyles";
import { useAnimaBreathe } from "./useAnimaBreathe";

const NONE = "";

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
  disabled = false,
  disabledReason,
  onClick,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string | null;
  readonly onClick: () => void;
}) {
  const row = (
    <ThreadDetailsControl
      part="row"
      size="sm"
      variant="ghost"
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className={THREAD_DETAILS_PANEL_LABEL_CLASS}>{label}</span>
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

/**
 * The thread details rows for the anima a thread runs with: a picker row plus, once one is set,
 * its actions. A draft stores the choice locally so the first message creates the thread with it;
 * a server thread writes it through thread metadata. The first wake locks the choice for good, so
 * a woken thread shows the anima read-only.
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
  const threadRef = scopeThreadRef(environmentId, threadId);
  const shell = useQuietThreadShell(isServerThread ? threadRef : null);
  const draftAnima = useComposerDraftStore((store) =>
    draftId ? (store.getDraftSession(draftId)?.animaName ?? null) : null,
  );
  const setDraftThreadAnima = useComposerDraftStore((store) => store.setDraftThreadAnima);
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });
  const { animas } = useAnimaList(environmentId);
  const { breathe, isPending, canBreathe } = useAnimaBreathe(
    environmentId,
    isServerThread ? threadId : null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  const current = isServerThread ? (shell?.animaName ?? null) : draftAnima;
  const locked = isServerThread && current !== null && shell?.animaWokenAt != null;
  // An environment without animas has nothing to choose, unless one is already set.
  if (animas.length === 0 && current === null) return null;
  const summary =
    current === null ? null : (animas.find((anima) => anima.name === current) ?? null);

  const changeAnima = async (next: AnimaName | null) => {
    if (!isServerThread) {
      setDraftThreadAnima(draftId ?? threadRef, next);
      return;
    }
    const result = await updateMetadata({ environmentId, input: { threadId, animaName: next } });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not change the anima",
          description: describeAnimaError(squashAtomCommandFailure(result)),
        }),
      );
    }
  };

  const breatheReason = !isServerThread
    ? "Send the first message before this anima can breathe."
    : !canBreathe
      ? "You don't have permission to request a breath."
      : isPending
        ? "A breath is already in progress."
        : null;

  const currentValue = (
    <span className="flex min-w-0 max-w-[60%] items-center gap-1.5 font-normal text-muted-foreground">
      {summary ? <AnimaAccentDot accent={summary.accent} className="size-2" /> : null}
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
            <MenuRadioGroup
              value={current ?? NONE}
              onValueChange={(next) => void changeAnima(next === NONE ? null : (next as AnimaName))}
            >
              <MenuRadioItem value={NONE} closeOnClick>
                None
              </MenuRadioItem>
              <MenuSeparator />
              {animas.map((anima) => (
                <MenuRadioItem key={anima.name} value={anima.name} closeOnClick>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <AnimaAccentDot accent={anima.accent} className="size-2" />
                    <span className="min-w-0 truncate">{anima.name}</span>
                    <span className="text-muted-foreground text-xs">{anima.role}</span>
                    <AnimaLiveDot live={anima.live} />
                    <span className="ml-auto text-muted-foreground text-xs tabular-nums">
                      {anima.breathCount}
                    </span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
            {current !== null ? (
              <p className="px-2 py-1.5 text-muted-foreground text-xs">
                Locks to this thread on your next message.
              </p>
            ) : null}
          </MenuPopup>
        </Menu>
      )}

      {current !== null ? (
        <>
          <ActionRow
            icon={<WindIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
            label={isPending ? "Breathing…" : "Breathe now"}
            disabled={breatheReason !== null}
            disabledReason={breatheReason}
            onClick={() => void breathe()}
          />
          <ActionRow
            icon={<ScanEyeIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
            label="Wake preview"
            onClick={() => setPreviewOpen(true)}
          />
          <ActionRow
            icon={<SettingsIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
            label="Open anima"
            onClick={() =>
              void navigate({ to: "/settings/anima", search: { environmentId, anima: current } })
            }
          />
          {locked ? null : (
            <ActionRow
              icon={<XIcon aria-hidden="true" className={THREAD_DETAILS_PANEL_ICON_CLASS} />}
              label="Remove anima"
              onClick={() => void changeAnima(null)}
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
