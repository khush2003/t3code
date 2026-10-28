import type { AnimaThreadRuntimeStatus, ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class AnimaRuntime extends Context.Service<
  AnimaRuntime,
  {
    /** Null when the thread has no anima. */
    readonly threadStatus: (threadId: ThreadId) => Effect.Effect<AnimaThreadRuntimeStatus | null>;
  }
>()("t3/anima/AnimaRuntime") {}

export const layer = Layer.succeed(
  AnimaRuntime,
  AnimaRuntime.of({ threadStatus: () => Effect.succeed(null) }),
);
