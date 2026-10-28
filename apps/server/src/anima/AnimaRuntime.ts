import type { AnimaPolicyFire, AnimaThreadRuntimeStatus, ThreadId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as AnimaFiles from "./AnimaFiles.ts";
import * as AnimaPolicyMatch from "./AnimaPolicyMatch.ts";

const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const MAX_FIRES_KEPT = 50;
const ERROR_SNIPPET_MAX = 200;

export interface AnimaRuntimeAttachInput {
  readonly threadId: ThreadId;
  readonly name: string;
  readonly cwd: string | null;
  /** True when this turn delivers a fresh wake; resets the counters and the breath baseline. */
  readonly woke: boolean;
}

export interface AnimaToolObservation {
  readonly threadId: ThreadId;
  /** Dedupes repeated updates of one tool call. */
  readonly itemId: string;
  readonly phase: "started" | "succeeded" | "failed";
  readonly call: AnimaPolicyMatch.AnimaToolCall;
  readonly error?: string | undefined;
}

export interface AnimaRuntimeNotices {
  /** A fenced `<anima-runtime>` block, or "" when nothing is pending. */
  readonly text: string;
  /** Marks the notices in `text` delivered, once the turn carrying them was accepted. */
  readonly ack: Effect.Effect<void>;
}

export class AnimaRuntime extends Context.Service<
  AnimaRuntime,
  {
    /** Null when the thread has no anima, or has not started a turn since the server started. */
    readonly threadStatus: (threadId: ThreadId) => Effect.Effect<AnimaThreadRuntimeStatus | null>;
    readonly attach: (input: AnimaRuntimeAttachInput) => Effect.Effect<void>;
    readonly observe: (observation: AnimaToolObservation) => Effect.Effect<void>;
    /** Context for a provider's pre-tool hook; "" when nothing applies. */
    readonly preTool: (input: {
      readonly threadId: ThreadId;
      readonly call: AnimaPolicyMatch.AnimaToolCall;
    }) => Effect.Effect<string>;
    readonly notices: (threadId: ThreadId) => Effect.Effect<AnimaRuntimeNotices>;
    /** The thread settled, archived or was deleted: nag if unbreathed work happened, then clock out. */
    readonly release: (input: {
      readonly threadId: ThreadId;
      readonly forget: boolean;
    }) => Effect.Effect<void>;
  }
>()("t3/anima/AnimaRuntime") {}

interface ThreadState {
  readonly name: string;
  cwd: string | null;
  readonly breathsAtWake: number | null;
  toolEvents: number;
  streak: { readonly tool: string; failures: number; lastError: string } | null;
  loopQueued: boolean;
  pendingLoop: string | null;
  readonly fired: Set<string>;
  fires: Array<AnimaPolicyFire>;
  pendingRules: Array<string>;
  breathNudged: boolean;
  nagged: boolean;
  /** A provider pre-tool hook delivers rules live, so committed events stop matching them. */
  hookActive: boolean;
  released: boolean;
  readonly started: Set<string>;
  readonly finished: Set<string>;
}

interface CachedFile<A> {
  readonly stamp: string;
  readonly value: A;
}

/** The CLI's `localTs`: local wall-clock minutes without an offset. */
export function localStamp(ms: number): string {
  // @effect-diagnostics-next-line globalDate:off
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const encodeFireLine = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ h: Schema.String, ts: Schema.String })),
);
const encodeInboxLine = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.String,
      ts: Schema.String,
      from: Schema.String,
      to: Schema.String,
      type: Schema.String,
      body: Schema.String,
    }),
  ),
);

const isoOf = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

export function breathDue(input: {
  readonly toolEvents: number;
  readonly breathsAtWake: number | null;
  readonly breathCount: number;
}): boolean {
  return (
    input.breathsAtWake !== null &&
    input.toolEvents >= AnimaPolicyMatch.BREATH_NAG_MIN_EVENTS &&
    input.breathCount <= input.breathsAtWake
  );
}

function loopWarning(tool: string, failures: number, lastError: string): string {
  return [
    `LOOP BREAKER: your last ${failures} ${tool} calls in this thread all failed.`,
    `Do not retry the same call. Re-read the error (${lastError || "see the previous result"}), run a different diagnostic,`,
    "change approach entirely, or tell the user what is blocking you. Repeating the call is the one forbidden option.",
  ].join("\n");
}

function rulesBlock(name: string, rules: ReadonlyArray<string>, heading: string): string {
  return [
    `--- Anima Policy (${name}) ${heading} ---`,
    ...rules,
    "Apply them or state in one sentence why they don't apply here.",
  ].join("\n");
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const root = path.join(home, ".claude", "anima");

  const threads = new Map<ThreadId, ThreadState>();
  const policyCache = new Map<
    string,
    CachedFile<ReadonlyArray<AnimaPolicyMatch.AnimaPolicyRuleMatcher>>
  >();
  const breathCache = new Map<string, CachedFile<number>>();
  const lastHeartbeat = new Map<string, number>();

  const fileOf = (name: string, file: string) => path.join(root, name, file);

  // Untraced: stats on every observed tool call, which would flood traces.
  const readCached = Effect.fnUntraced(
    function* <A>(
      cache: Map<string, CachedFile<A>>,
      name: string,
      file: string,
      parse: (content: string) => A,
      _fallback: A,
    ) {
      const target = fileOf(name, file);
      const info = yield* fs.stat(target);
      const mtimeMs = Option.match(info.mtime, { onNone: () => 0, onSome: (d) => d.getTime() });
      const stamp = `${mtimeMs}:${info.size}`;
      const cached = cache.get(name);
      if (cached !== undefined && cached.stamp === stamp) return cached.value;
      const value = parse(yield* fs.readFileString(target));
      cache.set(name, { stamp, value });
      return value;
    },
    (effect, _cache, _name, _file, _parse, fallback) =>
      effect.pipe(Effect.orElseSucceed(() => fallback)),
  );

  const policyRules = (name: string) =>
    readCached(policyCache, name, "policy.md", AnimaPolicyMatch.parsePolicyRules, []);
  const breathCount = (name: string) =>
    readCached(
      breathCache,
      name,
      "agent.anima",
      (content) => AnimaFiles.parseAgentFile(content).breaths,
      0,
    );

  const appendLine = (name: string, file: string, line: string) =>
    fs.writeFileString(fileOf(name, file), `${line}\n`, { flag: "a" }).pipe(Effect.ignore);

  // Same rewrite as the CLI's session.ts heartbeat; a missing file clocks in with the thread cwd.
  const heartbeat = Effect.fnUntraced(function* (state: ThreadState, force = false) {
    const now = yield* Clock.currentTimeMillis;
    const last = lastHeartbeat.get(state.name);
    if (!force && last !== undefined && now - last < HEARTBEAT_INTERVAL_MS) return;
    lastHeartbeat.set(state.name, now);
    const target = fileOf(state.name, "session");
    const stamp = localStamp(now);
    const current = yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => ""));
    const [clockedIn = "", , ...rest] = current.trim().split("|");
    const cwd = rest.join("|");
    const next =
      clockedIn !== ""
        ? `${clockedIn}|${stamp}${cwd === "" ? "" : `|${cwd}`}\n`
        : state.cwd === null
          ? null
          : `${stamp}|${stamp}|${state.cwd}\n`;
    if (next !== null) yield* fs.writeFileString(target, next).pipe(Effect.ignore);
  });

  const fireRules = Effect.fnUntraced(function* (
    state: ThreadState,
    call: AnimaPolicyMatch.AnimaToolCall,
  ) {
    const rules = yield* policyRules(state.name);
    if (rules.length === 0) return [];
    const matched = AnimaPolicyMatch.selectRules(rules, call, state.fired);
    if (matched.length === 0) return [];
    const now = yield* Clock.currentTimeMillis;
    const trigger = AnimaPolicyMatch.describeToolCall(call);
    for (const rule of matched) state.fired.add(rule.hash);
    state.fires = [
      ...matched.map((rule) => ({ rule: rule.text, trigger, ts: isoOf(now) })).toReversed(),
      ...state.fires,
    ].slice(0, MAX_FIRES_KEPT);
    yield* Effect.forEach(
      matched,
      (rule) =>
        appendLine(
          state.name,
          "policy-fires.jsonl",
          encodeFireLine({ h: rule.hash, ts: localStamp(now) }),
        ),
      { discard: true },
    );
    return matched.map((rule) => AnimaPolicyMatch.clipRuleText(rule.text));
  });

  const freshState = (name: string, cwd: string | null, breathsAtWake: number): ThreadState => ({
    name,
    cwd,
    breathsAtWake,
    toolEvents: 0,
    streak: null,
    loopQueued: false,
    pendingLoop: null,
    fired: new Set(),
    fires: [],
    pendingRules: [],
    breathNudged: false,
    nagged: false,
    hookActive: false,
    released: false,
    started: new Set(),
    finished: new Set(),
  });

  const attach: AnimaRuntime["Service"]["attach"] = Effect.fn("AnimaRuntime.attach")(
    function* (input) {
      const existing = threads.get(input.threadId);
      if (!input.woke && existing !== undefined && existing.name === input.name) {
        existing.released = false;
        if (input.cwd !== null) existing.cwd = input.cwd;
        yield* heartbeat(existing);
        return;
      }
      // A thread first seen after a server restart has no wake mark; its baseline is now.
      const state = freshState(input.name, input.cwd, yield* breathCount(input.name));
      threads.set(input.threadId, state);
      if (!input.woke) yield* heartbeat(state);
    },
  );

  // Runs for every tool update of every thread; most return at the map lookup.
  const observe: AnimaRuntime["Service"]["observe"] = Effect.fnUntraced(function* (observation) {
    const state = threads.get(observation.threadId);
    if (state === undefined || state.released) return;
    if (!state.started.has(observation.itemId)) {
      state.started.add(observation.itemId);
      if (!state.hookActive)
        state.pendingRules.push(...(yield* fireRules(state, observation.call)));
    }
    if (observation.phase !== "started" && !state.finished.has(observation.itemId)) {
      state.finished.add(observation.itemId);
      state.toolEvents += 1;
      const tool = observation.call.toolName;
      if (observation.phase === "succeeded") {
        state.streak = null;
        state.loopQueued = false;
        state.pendingLoop = null;
      } else {
        const lastError = (observation.error ?? "").trim().slice(-ERROR_SNIPPET_MAX);
        state.streak =
          state.streak?.tool === tool
            ? {
                tool,
                failures: state.streak.failures + 1,
                lastError: lastError || state.streak.lastError,
              }
            : { tool, failures: 1, lastError };
        if (state.streak.failures >= AnimaPolicyMatch.LOOP_THRESHOLD && !state.loopQueued) {
          state.loopQueued = true;
          state.pendingLoop = loopWarning(tool, state.streak.failures, state.streak.lastError);
        }
      }
    }
    yield* heartbeat(state);
  });

  const preTool: AnimaRuntime["Service"]["preTool"] = Effect.fn("AnimaRuntime.preTool")(
    function* (input) {
      const state = threads.get(input.threadId);
      if (state === undefined || state.released) return "";
      state.hookActive = true;
      const parts: Array<string> = [];
      const streak = state.streak;
      if (
        streak !== null &&
        streak.tool === input.call.toolName &&
        streak.failures >= AnimaPolicyMatch.LOOP_THRESHOLD
      ) {
        parts.push(loopWarning(streak.tool, streak.failures, streak.lastError));
        state.loopQueued = true;
        state.pendingLoop = null;
      }
      const rules = yield* fireRules(state, input.call);
      if (rules.length > 0)
        parts.push(rulesBlock(state.name, rules, "rules YOU wrote that match this action"));
      return parts.join("\n\n");
    },
    Effect.catchCause(() => Effect.succeed("")),
  );

  const status = (threadId: ThreadId, state: ThreadState) =>
    breathCount(state.name).pipe(
      Effect.map((count): AnimaThreadRuntimeStatus => {
        const beat = lastHeartbeat.get(state.name);
        return {
          threadId,
          name: state.name,
          toolEvents: state.toolEvents,
          breathsAtWake: state.breathsAtWake,
          breathCount: count,
          breathDue: breathDue({ ...state, breathCount: count }),
          loop:
            state.streak !== null && state.streak.failures >= AnimaPolicyMatch.LOOP_THRESHOLD
              ? { tool: state.streak.tool, failures: state.streak.failures }
              : null,
          fires: state.fires,
          lastHeartbeatAt: beat === undefined ? null : isoOf(beat),
        };
      }),
    );

  const threadStatus: AnimaRuntime["Service"]["threadStatus"] = Effect.fn(
    "AnimaRuntime.threadStatus",
  )(function* (threadId) {
    const state = threads.get(threadId);
    return state === undefined ? null : yield* status(threadId, state);
  });

  const notices: AnimaRuntime["Service"]["notices"] = Effect.fn("AnimaRuntime.notices")(
    function* (threadId) {
      const state = threads.get(threadId);
      if (state === undefined) return { text: "", ack: Effect.void };
      const rules = [...state.pendingRules];
      const loop = state.pendingLoop;
      const nudge =
        !state.breathNudged && breathDue({ ...state, breathCount: yield* breathCount(state.name) });
      const parts = [
        ...(rules.length === 0
          ? []
          : [rulesBlock(state.name, rules, "rules YOU wrote that matched your recent tool calls")]),
        ...(loop === null ? [] : [loop]),
        ...(nudge
          ? [
              `Breath due: ${state.toolEvents} tool calls since your wake and no breath recorded, so this work is invisible to your next self. When this chapter of work ends, breathe it with real decisions, friction and aim. Do not breathe for a trivial turn.`,
            ]
          : []),
      ];
      if (parts.length === 0) return { text: "", ack: Effect.void };
      return {
        text: [`<anima-runtime name="${state.name}">`, ...parts, "</anima-runtime>"].join("\n"),
        ack: Effect.sync(() => {
          state.pendingRules.splice(0, rules.length);
          if (state.pendingLoop === loop) state.pendingLoop = null;
          if (nudge) state.breathNudged = true;
        }),
      };
    },
  );

  const release: AnimaRuntime["Service"]["release"] = Effect.fn("AnimaRuntime.release")(
    function* (input) {
      const state = threads.get(input.threadId);
      if (state === undefined) return;
      if (input.forget) threads.delete(input.threadId);
      if (state.released) return;
      state.released = true;
      const now = yield* Clock.currentTimeMillis;
      if (!state.nagged && breathDue({ ...state, breathCount: yield* breathCount(state.name) })) {
        state.nagged = true;
        yield* appendLine(
          state.name,
          "inbox",
          encodeInboxLine({
            id: `m_${now}`,
            ts: localStamp(now),
            from: "anima-runtime",
            to: state.name,
            type: "directive",
            body: `T3 Code thread ${input.threadId} ended with ${state.toolEvents} tool events and NO BREATH, so that work is invisible to your next self. First action this wake: reconstruct what happened (git log/diff, or read that thread with t3_thread_read) and breathe it with real decisions/friction/aim. Then delete this directive.`,
          }),
        );
      }
      const stillLive = [...threads.values()].some(
        (other) => other !== state && other.name === state.name && !other.released,
      );
      if (stillLive || state.cwd === null) return;
      // Clock out like the CLI, but only a session this thread's wake or heartbeat owns.
      const target = fileOf(state.name, "session");
      const session = AnimaFiles.parseSession(
        yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => "")),
        now,
      );
      if (session?.cwd === state.cwd) {
        yield* fs.remove(target).pipe(Effect.ignore);
        lastHeartbeat.delete(state.name);
      }
    },
  );

  return AnimaRuntime.of({ threadStatus, attach, observe, preTool, notices, release });
});

/**
 * One instance per server: orchestration feeds it and the WebSocket layer reads it. Provide this
 * exact reference everywhere so layer memoization shares the in-memory state.
 */
export const layer = Layer.effect(AnimaRuntime, make);
