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
const BOT_BOARD_ALL_REFRESH_MS = 60_000;

export function createBotEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const scheduler = createAtomCommandScheduler();
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:list",
      tag: WS_METHODS.botsList,
      // Reply counts and last-reply times move while a thread is open beside the chat.
      staleTimeMs: BOT_BOARD_REFRESH_MS,
      refreshIntervalMs: BOT_BOARD_REFRESH_MS,
      idleTtlMs: 60_000,
    }),
    board: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:board",
      tag: WS_METHODS.botsBoard,
      staleTimeMs: BOT_BOARD_REFRESH_MS,
      refreshIntervalMs: BOT_BOARD_REFRESH_MS,
      idleTtlMs: 30_000,
    }),
    /** With finished work too. That only grows, so it is read less often than the open board. */
    boardAll: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:board-all",
      tag: WS_METHODS.botsBoard,
      staleTimeMs: BOT_BOARD_ALL_REFRESH_MS,
      refreshIntervalMs: BOT_BOARD_ALL_REFRESH_MS,
      idleTtlMs: 30_000,
    }),
    memory: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:bots:memory",
      tag: WS_METHODS.botsMemory,
      staleTimeMs: 30_000,
      idleTtlMs: 30_000,
    }),
    retireNote: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:note-retire",
      tag: WS_METHODS.botsNoteRetire,
      scheduler,
      concurrency: {
        mode: "serial" as const,
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
    setCharter: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:charter-set",
      tag: WS_METHODS.botsCharterSet,
      scheduler,
      concurrency: {
        mode: "serial" as const,
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
    setLook: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:look-set",
      tag: WS_METHODS.botsLookSet,
      scheduler,
      concurrency: {
        mode: "serial" as const,
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
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
    startThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:bots:thread-start",
      tag: WS_METHODS.botsThreadStart,
      scheduler,
      concurrency: {
        mode: "serial" as const,
        key: ({ environmentId }: { environmentId: string }) => environmentId,
      },
    }),
  };
}
