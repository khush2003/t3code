import type { OrchestrationV2DomainEvent, OrchestrationV2TurnItem } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";

import * as AnimaRuntime from "../anima/AnimaRuntime.ts";
import type { AnimaToolCall } from "../anima/AnimaPolicyMatch.ts";
import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";

/** Claude Code tool names, so loops and rules line up with the Claude pre-tool hook. */
function toolCallOf(item: OrchestrationV2TurnItem): AnimaToolCall | null {
  switch (item.type) {
    case "command_execution":
      return {
        toolName: "Bash",
        toolInput: {
          command: item.input,
          ...(item.title === null ? {} : { description: item.title }),
        },
      };
    case "file_change":
      return {
        toolName: "Edit",
        toolInput: {
          file_path: item.fileName,
          ...(item.oldStr === undefined ? {} : { old_string: item.oldStr }),
          ...(item.newStr === undefined ? {} : { new_string: item.newStr }),
        },
      };
    case "file_search":
      return {
        toolName: "Grep",
        toolInput: item.pattern === undefined ? {} : { pattern: item.pattern },
      };
    case "web_search":
      return { toolName: "WebSearch", toolInput: { pattern: (item.patterns ?? []).join(" ") } };
    case "dynamic_tool":
      return {
        toolName: item.toolName ?? "tool",
        toolInput:
          Predicate.isObject(item.input) && !Array.isArray(item.input)
            ? (item.input as Readonly<Record<string, unknown>>)
            : {},
      };
    default:
      return null;
  }
}

function failed(item: OrchestrationV2TurnItem): boolean {
  if (item.status === "failed") return true;
  return (
    item.type === "command_execution" &&
    item.status === "completed" &&
    (item.outputIndicatesFailure === true || (item.exitCode !== undefined && item.exitCode !== 0))
  );
}

/** Maps a committed tool update to what the anima runtime observes; null for anything else. */
export function animaToolObservation(
  event: OrchestrationV2DomainEvent,
): AnimaRuntime.AnimaToolObservation | null {
  if (event.type !== "turn-item.updated") return null;
  const item = event.payload;
  const call = toolCallOf(item);
  // Cancelled calls never ran to an outcome, so they neither count nor break a failure streak.
  if (call === null || item.status === "cancelled" || item.status === "interrupted") return null;
  const phase = failed(item) ? "failed" : item.status === "completed" ? "succeeded" : "started";
  const error =
    phase !== "failed"
      ? undefined
      : item.type === "command_execution"
        ? item.output
        : item.type === "dynamic_tool"
          ? typeof item.output === "string"
            ? item.output
            : undefined
          : undefined;
  return { threadId: item.threadId, itemId: item.id, phase, call, error };
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const runtime = yield* AnimaRuntime.AnimaRuntime;
    // Runs for every domain event; anything that is not a tool update or thread end returns at once.
    const handle = (event: OrchestrationV2DomainEvent): Effect.Effect<void> => {
      switch (event.type) {
        case "thread.settled":
        case "thread.archived":
          return runtime.release({ threadId: event.threadId, forget: false });
        case "thread.deleted":
          return runtime.release({ threadId: event.threadId, forget: true });
        default: {
          const observation = animaToolObservation(event);
          return observation === null ? Effect.void : runtime.observe(observation);
        }
      }
    };
    yield* forkParked(
      Stream.runForEach(engine.streamDomainEvents, (event) =>
        handle(event).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("anima runtime failed to observe an event", {
              threadId: event.threadId,
              cause,
            }),
          ),
        ),
      ).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("anima runtime event stream failed", { cause }),
        ),
      ),
    );
  }),
);
