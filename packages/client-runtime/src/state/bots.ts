import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

/** Thread status on the board comes from the threads, so it is read again while shown. */
const BOT_BOARD_REFRESH_MS = 10_000;

export function createBotEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:list",
      tag: WS_METHODS.botsList,
      staleTimeMs: 30_000,
      idleTtlMs: 60_000,
    }),
    board: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:board",
      tag: WS_METHODS.botsBoard,
      staleTimeMs: BOT_BOARD_REFRESH_MS,
      refreshIntervalMs: BOT_BOARD_REFRESH_MS,
      idleTtlMs: 30_000,
    }),
    start: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:start",
      tag: WS_METHODS.botsStart,
      scheduler,
      concurrency: {
        mode: "serial" as const,
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
  };
}
