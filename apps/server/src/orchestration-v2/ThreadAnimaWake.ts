import type { ThreadId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as AnimaService from "../anima/AnimaService.ts";

export type ThreadAnimaWakeOutcome =
  | { readonly status: "woke"; readonly context: string; readonly detail: string }
  | { readonly status: "failed" };

export interface ThreadAnimaWakeInput {
  readonly threadId: ThreadId;
  readonly name: string;
  readonly cwd: string;
}

const MAX_VOICE_CHARS = 8000;
/** Matches hook.ts VOICE_REINJECT_MS: how often a long session needs the persona restated. */
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;

function voiceBlock(name: string, voice: string, payload: string): string[] {
  const text = voice.trim().slice(0, MAX_VOICE_CHARS).trim();
  if (text === "" || payload.includes(text.slice(0, 200))) return [];
  return [
    `The block below is the conversation style of "${name}". It outranks the default assistant tone about HOW you communicate (register, directness, structure), but never overrides coding, tool, or safety instructions.`,
    `<anima-voice name="${name}">`,
    text,
    "</anima-voice>",
  ];
}

/**
 * Wraps the persisted identity payload so any provider can tell it apart from the user's message.
 * The payload is data, so the fence is the only structure this adds.
 */
const RECALL_NOTE =
  "T3 Code runs `anima recall` on each of the user's messages for you and includes any match as an <anima-recall> block; do not run recall yourself, and when no block appears, nothing applied.";

/** Fences recall output so it reads as retrieved precedent, not as the user's words. */
function renderAnimaRecall(name: string, recalled: string): string {
  return recalled === ""
    ? ""
    : [`<anima-recall name="${name}">`, recalled, "</anima-recall>"].join("\n");
}

export function renderAnimaWakeContext(name: string, payload: string, voice = ""): string {
  return [
    `T3 Code has already woken the anima "${name}" for this thread. The block below is the output of \`read --wake --agent ${name}\`, and its inbox was consumed. Adopt it as your identity, but do not run the wake step again (no \`read --wake\`, no wake via the anima skill), do not recite it, and treat the user's message as the task even when it is only a greeting. Breathing is user-triggered from the UI or happens at a real chapter boundary: never breathe on your own after trivial turns, and when you are explicitly asked to breathe, follow the instructions in that request. ${RECALL_NOTE}`,
    ...voiceBlock(name, voice, payload),
    `<anima-wake name="${name}">`,
    payload.trim(),
    "</anima-wake>",
  ].join("\n");
}

function describeAnimaWake(payload: string): string {
  const lines = payload.split("\n").length;
  return `${lines} lines of identity context`;
}

/**
 * The launch card runs the wake during workspace preparation and the turn start consumes it. The
 * result lives in memory only: the wake is cheap to recompute, so a server restart between the two
 * just falls back to `take` computing it again, and nothing about it needs to be durable.
 */
export class ThreadAnimaWake extends Context.Service<
  ThreadAnimaWake,
  {
    readonly prepare: (input: ThreadAnimaWakeInput) => Effect.Effect<ThreadAnimaWakeOutcome>;
    readonly take: (input: ThreadAnimaWakeInput) => Effect.Effect<ThreadAnimaWakeOutcome>;
    /**
     * A compact identity refresh for a later turn, or "" when one was injected in the last 15
     * minutes. Never wakes, clocks in or consumes the inbox, and never fails.
     */
    readonly refresh: (
      input: Pick<ThreadAnimaWakeInput, "threadId" | "name"> & {
        /** Host the brief is formatted for; defaults to claude. */
        readonly target?: AnimaService.AnimaBriefTarget | undefined;
      },
    ) => Effect.Effect<string>;
    /** `anima recall` for this turn's message, fenced; "" when nothing applies. Never fails. */
    readonly recall: (input: {
      readonly name: string;
      readonly message: string;
    }) => Effect.Effect<string>;
  }
>()("t3/orchestration-v2/ThreadAnimaWake") {}

const make = Effect.gen(function* () {
  const anima = yield* AnimaService.AnimaService;
  const injectedAt = yield* Ref.make<ReadonlyMap<ThreadId, number>>(new Map());
  const markInjected = (threadId: ThreadId) =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        Ref.update(injectedAt, (current) => new Map(current).set(threadId, now)),
      ),
    );
  const prepared = yield* Ref.make<
    ReadonlyMap<ThreadId, ThreadAnimaWakeOutcome & { name: string }>
  >(new Map());

  // A failed wake never fails the turn: the agent simply starts without the identity.
  const compute = (input: ThreadAnimaWakeInput): Effect.Effect<ThreadAnimaWakeOutcome> =>
    anima.wake({ name: input.name, cwd: input.cwd }).pipe(
      // The wake just regenerated the output style, so read the voice after it.
      Effect.flatMap((payload) =>
        anima.voice(input.name).pipe(
          Effect.map((voice): ThreadAnimaWakeOutcome => ({
            status: "woke",
            context: renderAnimaWakeContext(input.name, payload, voice),
            detail: describeAnimaWake(payload),
          })),
        ),
      ),
      Effect.tap(() => markInjected(input.threadId)),
      Effect.catch((error) =>
        Effect.logWarning("Anima wake failed; continuing without it", {
          threadId: input.threadId,
          animaName: input.name,
          error: error._tag,
        }).pipe(Effect.as<ThreadAnimaWakeOutcome>({ status: "failed" })),
      ),
    );

  const prepare: ThreadAnimaWake["Service"]["prepare"] = (input) =>
    compute(input).pipe(
      Effect.tap((outcome) =>
        Ref.update(prepared, (current) =>
          new Map(current).set(input.threadId, { ...outcome, name: input.name }),
        ),
      ),
    );

  const take: ThreadAnimaWake["Service"]["take"] = (input) =>
    Ref.modify(prepared, (current) => {
      const entry = current.get(input.threadId);
      if (entry === undefined) return [undefined, current] as const;
      const next = new Map(current);
      next.delete(input.threadId);
      return [entry, next] as const;
    }).pipe(
      Effect.flatMap((entry) => {
        if (entry === undefined || entry.name !== input.name) return compute(input);
        const { name: _name, ...outcome } = entry;
        return Effect.succeed(outcome as ThreadAnimaWakeOutcome);
      }),
    );

  const refresh: ThreadAnimaWake["Service"]["refresh"] = Effect.fn("ThreadAnimaWake.refresh")(
    function* (input) {
      const now = yield* Clock.currentTimeMillis;
      const last = (yield* Ref.get(injectedAt)).get(input.threadId);
      if (last !== undefined && now - last < REFRESH_INTERVAL_MS) return "";
      const brief = yield* anima.identityBrief({
        name: input.name,
        target: input.target ?? "claude",
      });
      if (brief === "") return "";
      yield* markInjected(input.threadId);
      return `${brief}\n(This is a periodic refresh of your identity, not a new task. ${RECALL_NOTE})`;
    },
    Effect.catchCause(() => Effect.succeed("")),
  );

  const recall: ThreadAnimaWake["Service"]["recall"] = (input) =>
    anima.recall(input).pipe(Effect.map((recalled) => renderAnimaRecall(input.name, recalled)));

  return ThreadAnimaWake.of({ prepare, take, refresh, recall });
});

export const layer = Layer.effect(ThreadAnimaWake, make);
