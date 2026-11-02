import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { animaOnboardingComposerText } from "@t3tools/client-runtime/state/anima";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AnimaName, EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { animaEnvironment, describeAnimaError } from "../../state/anima";
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
  const onboardingPrompt = useAtomCommand(animaEnvironment.onboardingPrompt, {
    reportFailure: false,
  });

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

  /**
   * Puts the server's setup prompt in the composer for the user to read and send. The thread runs
   * without an anima, since the one it sets up does not exist yet; any draft text stays as notes.
   */
  const startOnboarding = async () => {
    const result = await onboardingPrompt({ environmentId, input: {} });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start a new anima",
            description: describeAnimaError(squashAtomCommandFailure(result)),
          }),
        );
      }
      return;
    }
    if (current !== null) await change(null);
    const target = draftId ?? threadRef;
    const store = useComposerDraftStore.getState();
    store.setPrompt(
      target,
      animaOnboardingComposerText(
        result.value.prompt,
        store.getComposerDraft(target)?.prompt ?? "",
      ),
    );
  };

  return { current, locked, change, startOnboarding };
}
