import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AnimaName, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { describeAnimaError } from "../../state/anima";
import { useQuietThreadShell } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

/**
 * The anima a thread runs with and how to change it. A draft keeps the choice locally so the first
 * message creates the thread with it; a server thread writes it through thread metadata. The first
 * wake locks the choice for good.
 */
export function useThreadAnimaChoice({
  environmentId,
  threadId,
  draftId,
  isServerThread,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftId: DraftId | undefined;
  readonly isServerThread: boolean;
}) {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const shell = useQuietThreadShell(isServerThread ? threadRef : null);
  const draftAnima = useComposerDraftStore((store) =>
    draftId ? (store.getDraftSession(draftId)?.animaName ?? null) : null,
  );
  const setDraftThreadAnima = useComposerDraftStore((store) => store.setDraftThreadAnima);
  const updateMetadata = useAtomCommand(threadEnvironment.updateMetadata, { reportFailure: false });

  const current = isServerThread ? (shell?.animaName ?? null) : draftAnima;
  const locked = isServerThread && current !== null && shell?.animaWokenAt != null;

  const change = async (next: AnimaName | null) => {
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

  return { current, locked, change };
}
