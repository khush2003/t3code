import { describe, expect, it } from "vite-plus/test";
import type { AnimaName, AnimaThreadRuntimeStatus, ThreadId } from "@t3tools/contracts";

import { ANIMA_LIVE_WINDOW_MS, animaThreadSignal, breathsSinceWake } from "./threadAnima.logic";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");

const status = (overrides: Partial<AnimaThreadRuntimeStatus> = {}): AnimaThreadRuntimeStatus => ({
  threadId: "thread-1" as ThreadId,
  name: "ember" as AnimaName,
  toolEvents: 3,
  breathsAtWake: 10,
  breathCount: 12,
  breathDue: false,
  loop: null,
  fires: [],
  lastHeartbeatAt: null,
  ...overrides,
});

describe("animaThreadSignal", () => {
  it("ranks a loop over a due breath, and a due breath over liveness", () => {
    const beat = new Date(NOW - 1_000).toISOString();
    expect(
      animaThreadSignal(
        status({ loop: { tool: "Bash", failures: 3 }, breathDue: true, lastHeartbeatAt: beat }),
        NOW,
      ),
    ).toBe("loop");
    expect(animaThreadSignal(status({ breathDue: true, lastHeartbeatAt: beat }), NOW)).toBe(
      "breath-due",
    );
    expect(animaThreadSignal(status({ lastHeartbeatAt: beat }), NOW)).toBe("live");
  });

  it("is idle without status, without a heartbeat, or once the heartbeat goes stale", () => {
    expect(animaThreadSignal(null, NOW)).toBe("idle");
    expect(animaThreadSignal(status(), NOW)).toBe("idle");
    expect(animaThreadSignal(status({ lastHeartbeatAt: "not a date" }), NOW)).toBe("idle");
    const edge = new Date(NOW - ANIMA_LIVE_WINDOW_MS).toISOString();
    expect(animaThreadSignal(status({ lastHeartbeatAt: edge }), NOW)).toBe("live");
    const stale = new Date(NOW - ANIMA_LIVE_WINDOW_MS - 1).toISOString();
    expect(animaThreadSignal(status({ lastHeartbeatAt: stale }), NOW)).toBe("idle");
  });
});

describe("breathsSinceWake", () => {
  it("counts breaths after the wake, never below zero, and is null before the wake", () => {
    expect(breathsSinceWake(status())).toBe(2);
    expect(breathsSinceWake(status({ breathsAtWake: 14 }))).toBe(0);
    expect(breathsSinceWake(status({ breathsAtWake: null }))).toBeNull();
  });
});
