import type { OrchestrationV2ThreadProjection, ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";

import { latestProviderTurnTokenUsage } from "../../lib/contextWindow";
import { environmentThreadDetails } from "../../state/threads";
import { type AtlasAgentRuntime, createAtlasAgentDetailsAtom } from "./atlasControlState";

const runtimeAtomFamily = Atom.family((key: string) => {
  const [environmentId, threadId] = key.split("\n") as [
    ScopedThreadRef["environmentId"],
    ScopedThreadRef["threadId"],
  ];
  let previous: Pick<OrchestrationV2ThreadProjection, "runs" | "providerTurns"> | null = null;
  let value: AtlasAgentRuntime | null = null;
  // Streaming rewrites the projection constantly; recompute only when runs or usage change.
  return Atom.make((get) => {
    const projection = Option.getOrNull(
      get(environmentThreadDetails.stateAtom({ environmentId, threadId })).data,
    );
    if (projection === null) {
      previous = null;
      value = null;
    } else if (
      projection.runs !== previous?.runs ||
      projection.providerTurns !== previous?.providerTurns
    ) {
      const { runs, providerTurns } = projection;
      previous = { runs, providerTurns };
      const latest = runs.reduce<(typeof runs)[number] | undefined>(
        (best, run) => (best === undefined || run.ordinal > best.ordinal ? run : best),
        undefined,
      );
      value = {
        modelSelection: latest?.modelSelection ?? null,
        tokenUsage: latestProviderTurnTokenUsage(providerTurns),
      };
    }
    return value;
  }).pipe(Atom.setIdleTTL(0), Atom.withLabel(`atlas-agent-runtime:${key}`));
});

/** The latest run's model selection and usage for one thread. */
export const atlasThreadRuntimeAtom = (ref: ScopedThreadRef) =>
  runtimeAtomFamily(`${ref.environmentId}\n${ref.threadId}`);

export const atlasAgentDetailsAtom = createAtlasAgentDetailsAtom({
  ...environmentThreadDetails,
  runtimeAtom: (ref) => runtimeAtomFamily(`${ref.environmentId}\n${ref.threadId}`),
});

/**
 * Keyed by `environmentId` then one `initiativeId\tthreadId…` line per
 * initiative, so a dashboard reads pending requests only for threads still
 * running and recomputes when that set changes.
 */
export const atlasWaitingByInitiativeAtom = Atom.family((key: string) => {
  const [environmentId, ...groups] = key.split("\n");
  return Atom.make((get) => {
    const waiting = new Map<string, number>();
    for (const group of groups) {
      const [initiativeId, ...threadIds] = group.split("\t");
      if (!initiativeId || threadIds.length === 0) continue;
      const details = get(atlasAgentDetailsAtom([environmentId, ...threadIds].join("\n")));
      const count = details.filter(
        ({ pending }) =>
          pending !== null && pending.approvals.length + pending.userInputs.length > 0,
      ).length;
      if (count > 0) waiting.set(initiativeId, count);
    }
    return waiting as ReadonlyMap<string, number>;
  }).pipe(Atom.setIdleTTL(0));
});

export function atlasWaitingKey(
  environmentId: string,
  groups: ReadonlyArray<readonly [string, ReadonlyArray<string>]>,
): string {
  return [environmentId, ...groups.map(([id, threads]) => [id, ...threads].join("\t"))].join("\n");
}
