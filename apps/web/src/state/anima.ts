import type { AtomRegistry } from "effect/reactivity";
import { createAnimaEnvironmentAtoms } from "@t3tools/client-runtime/state/anima";
import type { AnimaSyncPorts } from "@t3tools/client-runtime/anima-sync";
import {
  type AtomCommand,
  type AtomCommandResult,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AnimaSummary, EnvironmentId } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

export const animaEnvironment = createAnimaEnvironmentAtoms(connectionAtomRuntime);

const NO_ANIMAS: ReadonlyArray<AnimaSummary> = Object.freeze([]);

/** Summaries only; an environment without anima support simply reports an error and no animas. */
export function useAnimaList(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : animaEnvironment.list({ environmentId, input: {} }),
  );
  return {
    ...query,
    animas: query.data?.animas ?? NO_ANIMAS,
    cliAvailable: query.data?.cliAvailable ?? true,
    rootPath: query.data?.rootPath ?? null,
  };
}

export function describeAnimaError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "The anima request failed.";
}

async function unwrap<A, E>(result: AtomCommandResult<A, E>): Promise<A> {
  if (result._tag === "Success") return result.value;
  throw squashAtomCommandFailure(result);
}

/** Addresses two environments at once for sync; failures reject so the flow can stop at the first one. */
export function createAnimaSyncPorts(registry: AtomRegistry.AtomRegistry): AnimaSyncPorts {
  const run = <W, A, E>(command: AtomCommand<W, A, E>, input: W) =>
    runAtomCommand(registry, command, input, { reportFailure: false }).then(unwrap);
  return {
    exportBundle: (environmentId, name) =>
      run(animaEnvironment.exportBundle, { environmentId, input: { name } }),
    compare: (environmentId, bundle) =>
      run(animaEnvironment.compare, { environmentId, input: { bundle } }),
    importBundle: (environmentId, input) =>
      run(animaEnvironment.importBundle, { environmentId, input }),
    mergeStart: (environmentId, input) =>
      run(animaEnvironment.mergeStart, { environmentId, input }),
  };
}
