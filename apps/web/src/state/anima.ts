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

const UNKNOWN_REQUEST = /Unknown request tag: \S+/;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "";
}

/** An older T3 server rejects requests it does not know as a defect carrying this text. */
export function isUnsupportedAnimaRequest(error: unknown): boolean {
  return UNKNOWN_REQUEST.test(errorText(error));
}

export function describeAnimaError(error: unknown): string {
  if (isUnsupportedAnimaRequest(error)) {
    return "That environment runs an older T3 server without this anima feature. Update T3 there and try again.";
  }
  const text = errorText(error).trim();
  return text !== "" ? text : "The anima request failed.";
}

async function unwrap<A, E>(result: AtomCommandResult<A, E>): Promise<A> {
  if (result._tag === "Success") return result.value;
  throw squashAtomCommandFailure(result);
}

/** Addresses two environments at once for sync; failures reject so the flow can stop at the first one. */
export function createAnimaSyncPorts(
  registry: AtomRegistry.AtomRegistry,
  labelOf: (environmentId: EnvironmentId) => string = (environmentId) => environmentId,
): AnimaSyncPorts {
  const run = <W extends { readonly environmentId: EnvironmentId }, A, E>(
    command: AtomCommand<W, A, E>,
    input: W,
  ) =>
    runAtomCommand(registry, command, input, { reportFailure: false })
      .then(unwrap)
      .catch((error: unknown) => {
        if (!isUnsupportedAnimaRequest(error)) throw error;
        throw new Error(
          `${labelOf(input.environmentId)} runs an older T3 server without anima sync. Update T3 there and try again.`,
        );
      });
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
