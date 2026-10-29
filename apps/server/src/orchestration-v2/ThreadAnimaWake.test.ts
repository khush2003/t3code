import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

import { AnimaError } from "@t3tools/contracts";
import * as AnimaService from "../anima/AnimaService.ts";
import * as ThreadAnimaWake from "./ThreadAnimaWake.ts";
import { ThreadId } from "@t3tools/contracts";

const threadId = ThreadId.make("thread:anima-wake");

const makeLayer = (
  wake: AnimaService.AnimaService["Service"]["wake"],
  extra: { readonly voice?: string; readonly capsule?: string } = {},
) =>
  ThreadAnimaWake.layer.pipe(
    Layer.provide(
      Layer.mock(AnimaService.AnimaService)({
        wake,
        voice: () => Effect.succeed(extra.voice ?? ""),
        identityBrief: (input) => Effect.succeed(`${extra.capsule ?? "capsule"}:${input.target}`),
      }),
    ),
  );

it.effect("fences the payload so any provider can tell it from the user message", () =>
  Effect.sync(() => {
    const context = ThreadAnimaWake.renderAnimaWakeContext("iris", "  identity\n  ");
    assert.match(context, /never breathe on your own after trivial turns/);
    assert.notMatch(context, /anima-voice/);
    assert.match(context, /<anima-wake name="iris">\nidentity\n<\/anima-wake>$/);
  }),
);

it.effect("reuses the wake computed during launch preparation exactly once", () => {
  const wake = vi.fn(() => Effect.succeed("payload"));
  return Effect.gen(function* () {
    const service = yield* ThreadAnimaWake.ThreadAnimaWake;
    const input = { threadId, name: "iris", cwd: "/repo" };
    yield* service.prepare(input);
    const first = yield* service.take(input);
    const second = yield* service.take(input);
    assert.equal(first.status, "woke");
    assert.equal(second.status, "woke");
    // The inbox is consumed by a real wake, so take must not run it again after prepare.
    assert.equal(wake.mock.calls.length, 2);
  }).pipe(Effect.provide(makeLayer(wake)));
});

it.effect("turns a failed wake into an outcome instead of failing the turn", () =>
  Effect.gen(function* () {
    const service = yield* ThreadAnimaWake.ThreadAnimaWake;
    const outcome = yield* service.take({ threadId, name: "iris", cwd: "/repo" });
    assert.deepEqual(outcome, { status: "failed" });
  }).pipe(
    Effect.provide(
      makeLayer(() => Effect.fail(new AnimaError({ operation: "wake", cause: "boom" }))),
    ),
  ),
);

it.effect("puts the voice fence ahead of the wake payload and bounds it", () =>
  Effect.sync(() => {
    const context = ThreadAnimaWake.renderAnimaWakeContext("iris", "identity", "Be blunt.");
    assert.match(context, /<anima-voice name="iris">\nBe blunt\.\n<\/anima-voice>/);
    assert.isBelow(context.indexOf("<anima-voice"), context.indexOf("<anima-wake"));
    assert.match(context, /never overrides coding, tool, or safety instructions/);
    const huge = ThreadAnimaWake.renderAnimaWakeContext("iris", "identity", "x".repeat(50_000));
    assert.isBelow(huge.length, 10_000);
  }),
);

it.effect("skips the voice when the wake payload already carries it", () =>
  Effect.sync(() => {
    const context = ThreadAnimaWake.renderAnimaWakeContext(
      "iris",
      "# iris\nBe blunt and short.",
      "# iris\nBe blunt and short.",
    );
    assert.notMatch(context, /anima-voice/);
  }),
);

it.effect("includes the generated voice after a wake", () =>
  Effect.gen(function* () {
    const service = yield* ThreadAnimaWake.ThreadAnimaWake;
    const outcome = yield* service.take({ threadId, name: "iris", cwd: "/repo" });
    assert.equal(outcome.status, "woke");
    if (outcome.status === "woke")
      assert.match(outcome.context, /<anima-voice name="iris">\nSpeak plainly\./);
  }).pipe(Effect.provide(makeLayer(() => Effect.succeed("payload"), { voice: "Speak plainly." }))),
);

it.effect("refreshes the identity at most once every 15 minutes per thread", () =>
  Effect.gen(function* () {
    const service = yield* ThreadAnimaWake.ThreadAnimaWake;
    const input = { threadId, name: "iris" };
    yield* service.take({ ...input, cwd: "/repo" });
    assert.equal(yield* service.refresh(input), "");
    yield* TestClock.adjust("14 minutes");
    assert.equal(yield* service.refresh(input), "");
    yield* TestClock.adjust("2 minutes");
    assert.match(yield* service.refresh(input), /^capsule/);
    assert.equal(yield* service.refresh(input), "");
    const other = yield* service.refresh({ threadId: ThreadId.make("thread:other"), name: "iris" });
    assert.match(other, /^capsule:claude/);
    const codex = yield* service.refresh({
      threadId: ThreadId.make("thread:codex"),
      name: "iris",
      target: "codex",
    });
    assert.match(codex, /^capsule:codex/);
    yield* TestClock.adjust("15 minutes");
    assert.match(yield* service.refresh(input), /^capsule/);
  }).pipe(Effect.provide(makeLayer(() => Effect.succeed("payload")))),
);

it.effect("never fails the turn when the capsule cannot be built", () =>
  Effect.gen(function* () {
    const service = yield* ThreadAnimaWake.ThreadAnimaWake;
    assert.equal(yield* service.refresh({ threadId, name: "iris" }), "");
  }).pipe(
    Effect.provide(
      ThreadAnimaWake.layer.pipe(
        Layer.provide(
          Layer.mock(AnimaService.AnimaService)({ identityBrief: () => Effect.die("boom") }),
        ),
      ),
    ),
  ),
);
