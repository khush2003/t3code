import { useAtomValue } from "@effect/atom-react";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import {
  WS_METHODS,
  type AnimaName,
  type AnimaSummary,
  type AnimaThreadRuntimeStatus,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../../connection/runtime";
import { animaEnvironment } from "../../state/anima";
import { useEnvironmentQuerySelector } from "../../state/query";
import { animaThreadSignal, type AnimaThreadSignal } from "./threadAnima.logic";

// The header, picker and sidebar read the roster without polling; colour and role only move per breath.
const animaRosterSnapshot = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:anima:roster-snapshot",
  tag: WS_METHODS.animaList,
  staleTimeMs: 5 * 60_000,
  idleTtlMs: 10 * 60_000,
});

const NO_ANIMAS: ReadonlyArray<AnimaSummary> = Object.freeze([]);
const NO_SUMMARY_ATOM = Atom.make<AnimaSummary | null>(null).pipe(
  Atom.withLabel("anima-presence:none"),
);

const rosterAtom = Atom.family((environmentId: EnvironmentId) => {
  const snapshot = animaRosterSnapshot({ environmentId, input: {} });
  return Atom.make(
    (get) => Option.getOrNull(AsyncResult.value(get(snapshot)))?.animas ?? NO_ANIMAS,
  ).pipe(Atom.withLabel(`anima-presence:roster:${environmentId}`));
});

const summaryAtom = Atom.family((key: string) => {
  const [environmentId, name] = key.split("\n") as [EnvironmentId, AnimaName];
  const roster = rosterAtom(environmentId);
  return Atom.make((get) => get(roster).find((anima) => anima.name === name) ?? null).pipe(
    Atom.withLabel(`anima-presence:summary:${key}`),
  );
});

export function useAnimaRoster(environmentId: EnvironmentId): ReadonlyArray<AnimaSummary> {
  return useAtomValue(rosterAtom(environmentId));
}

export function useAnimaSummary(
  environmentId: EnvironmentId,
  name: AnimaName | null,
): AnimaSummary | null {
  return useAtomValue(name === null ? NO_SUMMARY_ATOM : summaryAtom(`${environmentId}\n${name}`));
}

const selectSignal = (
  result: AsyncResult.AsyncResult<AnimaThreadRuntimeStatus | null, unknown>,
): AnimaThreadSignal => animaThreadSignal(Option.getOrNull(AsyncResult.value(result)), Date.now());

/** Subscribes to the thread's runtime status, which refreshes every few seconds while read. */
export function useAnimaThreadSignal(
  environmentId: EnvironmentId,
  threadId: ThreadId | null,
): AnimaThreadSignal {
  return useEnvironmentQuerySelector(
    threadId === null
      ? null
      : animaEnvironment.threadStatus({ environmentId, input: { threadId } }),
    selectSignal,
  );
}
