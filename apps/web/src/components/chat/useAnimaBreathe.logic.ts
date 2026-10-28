import type { AnimaName } from "@t3tools/contracts";

/** How often the anima summary is re-read while a breath is outstanding. */
export const ANIMA_BREATH_POLL_INTERVAL_MS = 4_000;
/** A breath that has not landed after this long is reported as missing. */
export const ANIMA_BREATH_TIMEOUT_MS = 180_000;

export interface AnimaBreathWatch {
  readonly name: AnimaName;
  readonly breathCountBefore: number;
  /** The thread was mid-turn, so the breath waits behind the current work. */
  readonly queued: boolean;
  readonly startedAt: number;
}

export type AnimaBreathOutcome =
  | { readonly kind: "recorded"; readonly breathCount: number }
  | { readonly kind: "timeout" };

export type AnimaBreathEvaluation =
  | { readonly status: "pending" }
  | { readonly status: "done"; readonly outcome: AnimaBreathOutcome };

/**
 * Decides whether an outstanding breath has landed. `breathCount` is the latest count read from the
 * anima summary, or null when it could not be read yet.
 */
export function evaluateAnimaBreath(
  watch: AnimaBreathWatch,
  breathCount: number | null,
  now: number,
): AnimaBreathEvaluation {
  if (breathCount !== null && breathCount > watch.breathCountBefore) {
    return { status: "done", outcome: { kind: "recorded", breathCount } };
  }
  if (now - watch.startedAt >= ANIMA_BREATH_TIMEOUT_MS) {
    return { status: "done", outcome: { kind: "timeout" } };
  }
  return { status: "pending" };
}

export function animaBreathStartedToast(queued: boolean): string {
  return queued ? "Queued. Breathes when this turn finishes" : "Breathing…";
}

export function animaBreathOutcomeToast(
  name: AnimaName,
  outcome: AnimaBreathOutcome,
): { readonly type: "success" | "warning"; readonly title: string } {
  return outcome.kind === "recorded"
    ? { type: "success", title: `Breath ${outcome.breathCount} recorded for ${name}` }
    : { type: "warning", title: "No breath was recorded yet; check the thread" };
}
