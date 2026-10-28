import { RegistryContext } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AnimaName, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import { useContext, useSyncExternalStore } from "react";
import type { AtomRegistry } from "effect/reactivity";

import { animaEnvironment, describeAnimaError } from "../../state/anima";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  ANIMA_BREATH_POLL_INTERVAL_MS,
  animaBreathOutcomeToast,
  animaBreathStartedToast,
  evaluateAnimaBreath,
  type AnimaBreathWatch,
} from "./useAnimaBreathe.logic";

// Watches live outside React so a breath still reports after the menu that asked for it unmounts.
const pendingKeys = new Set<string>();
const listeners = new Set<() => void>();

const watchKey = (environmentId: EnvironmentId, threadId: ThreadId) =>
  `${environmentId}:${threadId}`;

function setPending(key: string, pending: boolean) {
  if (pending ? pendingKeys.has(key) : !pendingKeys.has(key)) return;
  if (pending) pendingKeys.add(key);
  else pendingKeys.delete(key);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function readBreathCount(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  name: AnimaName,
): number | null {
  const listAtom = animaEnvironment.list({ environmentId, input: {} });
  registry.refresh(listAtom);
  const list = Option.getOrNull(AsyncResult.value(registry.get(listAtom)));
  return list?.animas.find((anima) => anima.name === name)?.breathCount ?? null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function watchBreath(
  registry: AtomRegistry.AtomRegistry,
  environmentId: EnvironmentId,
  watch: AnimaBreathWatch,
) {
  // Keeps the list query alive between polls.
  const unmount = registry.mount(animaEnvironment.list({ environmentId, input: {} }));
  for (;;) {
    await sleep(ANIMA_BREATH_POLL_INTERVAL_MS);
    const evaluation = evaluateAnimaBreath(
      watch,
      readBreathCount(registry, environmentId, watch.name),
      Date.now(),
    );
    if (evaluation.status === "done") {
      unmount();
      toastManager.add(stackedThreadToast(animaBreathOutcomeToast(watch.name, evaluation.outcome)));
      return;
    }
  }
}

/**
 * Requests a breath in a thread and follows it: a "Breathing…" toast, then the summary is polled
 * until the anima's breath count grows, then a result toast. Settings and the thread menu share it.
 */
export function useAnimaBreathe(environmentId: EnvironmentId, threadId: ThreadId | null) {
  const registry = useContext(RegistryContext);
  const canBreathe = useAtomValue(animaEnvironment.breathe.permissionAtom(environmentId));
  const key = threadId === null ? null : watchKey(environmentId, threadId);
  const isPending = useSyncExternalStore(
    subscribe,
    () => key !== null && pendingKeys.has(key),
    () => false,
  );

  const breathe = async () => {
    if (threadId === null || key === null || pendingKeys.has(key)) return;
    setPending(key, true);
    const result = await runAtomCommand(
      registry,
      animaEnvironment.breathe,
      { environmentId, input: { threadId } },
      { reportFailure: false },
    );
    if (result._tag !== "Success") {
      setPending(key, false);
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not request a breath",
            description: describeAnimaError(squashAtomCommandFailure(result)),
          }),
        );
      }
      return;
    }
    const { name, breathCountBefore, queued } = result.value;
    toastManager.add(stackedThreadToast({ type: "info", title: animaBreathStartedToast(queued) }));
    await watchBreath(registry, environmentId, {
      name,
      breathCountBefore,
      queued,
      startedAt: Date.now(),
    });
    setPending(key, false);
  };

  return { breathe, isPending, canBreathe };
}
