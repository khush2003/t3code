import { describe, expect, it } from "vite-plus/test";
import type { AnimaName } from "@t3tools/contracts";

import {
  ANIMA_BREATH_TIMEOUT_MS,
  animaBreathOutcomeToast,
  animaBreathStartedToast,
  evaluateAnimaBreath,
  type AnimaBreathWatch,
} from "./useAnimaBreathe.logic";

const name = "ember" as AnimaName;
const watch: AnimaBreathWatch = { name, breathCountBefore: 4, queued: false, startedAt: 1_000 };

describe("evaluateAnimaBreath", () => {
  it("stays pending until the count exceeds the starting count", () => {
    expect(evaluateAnimaBreath(watch, 4, 2_000)).toEqual({ status: "pending" });
    expect(evaluateAnimaBreath(watch, null, 2_000)).toEqual({ status: "pending" });
  });

  it("reports the recorded breath once the count grows", () => {
    expect(evaluateAnimaBreath(watch, 5, 2_000)).toEqual({
      status: "done",
      outcome: { kind: "recorded", breathCount: 5 },
    });
  });

  it("times out after the window", () => {
    expect(evaluateAnimaBreath(watch, 4, 1_000 + ANIMA_BREATH_TIMEOUT_MS - 1).status).toBe(
      "pending",
    );
    expect(evaluateAnimaBreath(watch, 4, 1_000 + ANIMA_BREATH_TIMEOUT_MS)).toEqual({
      status: "done",
      outcome: { kind: "timeout" },
    });
  });

  it("prefers a recorded breath over the timeout", () => {
    expect(evaluateAnimaBreath(watch, 6, 1_000 + ANIMA_BREATH_TIMEOUT_MS).status).toBe("done");
    expect(evaluateAnimaBreath(watch, 6, 1_000 + ANIMA_BREATH_TIMEOUT_MS)).toMatchObject({
      outcome: { kind: "recorded" },
    });
  });
});

describe("toast copy", () => {
  it("words the start by queue state", () => {
    expect(animaBreathStartedToast(false)).toBe("Breathing…");
    expect(animaBreathStartedToast(true)).toBe("Queued. Breathes when this turn finishes");
  });

  it("words the outcome", () => {
    expect(animaBreathOutcomeToast(name, { kind: "recorded", breathCount: 7 })).toEqual({
      type: "success",
      title: "Breath 7 recorded for ember",
    });
    expect(animaBreathOutcomeToast(name, { kind: "timeout" }).type).toBe("warning");
  });
});
