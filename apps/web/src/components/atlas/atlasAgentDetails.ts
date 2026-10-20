import { Atom } from "effect/reactivity";

import { environmentThreadDetails } from "../../state/threads";
import { createAtlasAgentDetailsAtom } from "./atlasControlState";

export const atlasAgentDetailsAtom = createAtlasAgentDetailsAtom(environmentThreadDetails);

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
