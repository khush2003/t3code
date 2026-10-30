import { useAtomValue } from "@effect/atom-react";
import { createAnimaEnvironmentAtoms } from "@t3tools/client-runtime/state/anima";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  AnimaName,
  AnimaSearchHit,
  AnimaSummary,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { scopedThreadKey } from "../lib/scopedEntities";
import {
  advanceAnimaBreath,
  ANIMA_BREATH_POLL_INTERVAL_MS,
  type AnimaBreathStatus,
  isUnsupportedAnimaRequest,
} from "./anima-presentation";
import { appAtomRegistry } from "./atom-registry";
import { useEnvironmentQuery } from "./query";

export const animaEnvironment = createAnimaEnvironmentAtoms(connectionAtomRuntime);

const NO_ANIMAS: ReadonlyArray<AnimaSummary> = Object.freeze([]);

/** An environment without anima support reports an error and no animas. */
export function useAnimaList(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : animaEnvironment.list({ environmentId, input: {} }),
  );
  return { ...query, animas: query.data?.animas ?? NO_ANIMAS };
}

const NO_SEARCH_HITS: ReadonlyArray<AnimaSearchHit> = Object.freeze([]);

/** An empty query reads nothing; callers debounce and enforce a minimum length. */
export function useAnimaSearch(environmentId: EnvironmentId, query: string) {
  const trimmed = query.trim();
  const search = useEnvironmentQuery(
    trimmed === "" ? null : animaEnvironment.search({ environmentId, input: { query: trimmed } }),
  );
  return { ...search, results: search.data?.results ?? NO_SEARCH_HITS };
}

export function describeAnimaError(error: unknown): string {
  if (isUnsupportedAnimaRequest(error)) {
    return "That environment runs an older T3 server without this anima feature. Update T3 there and try again.";
  }
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "The anima request failed.";
}

// Breaths are followed outside React so one still reports after the sheet that asked for it closes.
const breathStatusesAtom = Atom.make<Readonly<Record<string, AnimaBreathStatus>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:anima:breath-statuses"),
);

const breathStatusAtom = Atom.family((threadKey: string) =>
  Atom.make((get) => get(breathStatusesAtom)[threadKey] ?? null).pipe(
    Atom.withLabel("mobile:anima:breath-status"),
  ),
);

function setBreathStatus(threadKey: string, status: AnimaBreathStatus) {
  appAtomRegistry.set(breathStatusesAtom, {
    ...appAtomRegistry.get(breathStatusesAtom),
    [threadKey]: status,
  });
}

export function useAnimaBreathStatus(environmentId: EnvironmentId, threadId: ThreadId) {
  return useAtomValue(breathStatusAtom(scopedThreadKey(environmentId, threadId)));
}

export function isAnimaBreathInFlight(status: AnimaBreathStatus | null) {
  return status?.kind === "requesting" || status?.kind === "breathing";
}

function readBreathCount(environmentId: EnvironmentId, name: AnimaName): number | null {
  const listAtom = animaEnvironment.list({ environmentId, input: {} });
  appAtomRegistry.refresh(listAtom);
  const list = Option.getOrNull(AsyncResult.value(appAtomRegistry.get(listAtom)));
  return list?.animas.find((anima) => anima.name === name)?.breathCount ?? null;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Requests a breath, then re-reads the roster until the anima's breath count grows or the watch times out. */
export async function breatheAnima(environmentId: EnvironmentId, threadId: ThreadId) {
  const threadKey = scopedThreadKey(environmentId, threadId);
  if (isAnimaBreathInFlight(appAtomRegistry.get(breathStatusAtom(threadKey)))) return;
  setBreathStatus(threadKey, { kind: "requesting" });
  const result = await runAtomCommand(
    appAtomRegistry,
    animaEnvironment.breathe,
    { environmentId, input: { threadId } },
    { reportFailure: false },
  );
  if (result._tag !== "Success") {
    setBreathStatus(threadKey, {
      kind: "failed",
      message: isAtomCommandInterrupted(result)
        ? "The breath request was cancelled."
        : describeAnimaError(squashAtomCommandFailure(result)),
    });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    return;
  }
  const { name, breathCountBefore, queued } = result.value;
  let status: AnimaBreathStatus = {
    kind: "breathing",
    queued,
    breathCountBefore,
    startedAt: Date.now(),
  };
  setBreathStatus(threadKey, status);
  const unmount = appAtomRegistry.mount(animaEnvironment.list({ environmentId, input: {} }));
  while (status.kind === "breathing") {
    await sleep(ANIMA_BREATH_POLL_INTERVAL_MS);
    status = advanceAnimaBreath(status, readBreathCount(environmentId, name), Date.now());
  }
  unmount();
  setBreathStatus(threadKey, status);
  void Haptics.notificationAsync(
    status.kind === "recorded"
      ? Haptics.NotificationFeedbackType.Success
      : Haptics.NotificationFeedbackType.Warning,
  );
}
