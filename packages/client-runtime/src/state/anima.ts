import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/** Live dots go stale after the server's heartbeat window, so list data is refreshed on this cadence while read. */
const ANIMA_LIVE_REFRESH_MS = 15_000;

export function createAnimaEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Mutations shell out to the anima CLI on one directory tree; keep them ordered per environment.
  const scheduler = createAtomCommandScheduler();
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { environmentId: string }) => environmentId,
  };
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:anima:list",
      tag: WS_METHODS.animaList,
      staleTimeMs: ANIMA_LIVE_REFRESH_MS,
      refreshIntervalMs: ANIMA_LIVE_REFRESH_MS,
      idleTtlMs: 60_000,
    }),
    detail: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:anima:detail",
      tag: WS_METHODS.animaGet,
      staleTimeMs: ANIMA_LIVE_REFRESH_MS,
      refreshIntervalMs: ANIMA_LIVE_REFRESH_MS,
      idleTtlMs: 60_000,
    }),
    mergeStatus: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:anima:merge-status",
      tag: WS_METHODS.animaMergeStatus,
      staleTimeMs: 0,
      refreshIntervalMs: 3_000,
      idleTtlMs: 60_000,
      isFinal: (status) => status.state !== "running",
    }),
    wakePreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:anima:wake-preview",
      tag: WS_METHODS.animaWakePreview,
      staleTimeMs: 30_000,
      idleTtlMs: 30_000,
    }),
    create: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:create",
      tag: WS_METHODS.animaCreate,
      scheduler,
      concurrency,
    }),
    attach: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:attach",
      tag: WS_METHODS.animaAttach,
      scheduler,
      concurrency,
    }),
    setEnabled: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:set-enabled",
      tag: WS_METHODS.animaSetEnabled,
      scheduler,
      concurrency,
    }),
    policy: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:policy",
      tag: WS_METHODS.animaPolicy,
      scheduler,
      concurrency,
    }),
    breathe: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:breathe",
      tag: WS_METHODS.animaBreathe,
    }),
    // Export and compare move whole bundles, so they run as one-shot commands rather than cached queries.
    exportBundle: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:export",
      tag: WS_METHODS.animaExport,
    }),
    compare: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:compare",
      tag: WS_METHODS.animaCompare,
    }),
    importBundle: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:import",
      tag: WS_METHODS.animaImport,
      scheduler,
      concurrency,
    }),
    mergeStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:merge-start",
      tag: WS_METHODS.animaMergeStart,
    }),
    mergeApply: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:anima:merge-apply",
      tag: WS_METHODS.animaMergeApply,
      scheduler,
      concurrency,
    }),
  };
}
