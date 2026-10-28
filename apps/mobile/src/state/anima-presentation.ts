import type { AnimaSummary } from "@t3tools/contracts";

/** Accents come from files on the server's disk, so only colour syntaxes React Native parses reach a style. */
const SAFE_ACCENT = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([0-9.,%\s]+\))$/i;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The latest breath's `H,S,L` is the anima's current colour; the identity accent is the fallback. */
export function animaColor(anima: Pick<AnimaSummary, "hsl" | "accent">): string | null {
  const parts = anima.hsl?.split(",").map((part) => Number.parseFloat(part)) ?? [];
  const [hue, saturation, lightness] = parts;
  if (
    hue !== undefined &&
    saturation !== undefined &&
    lightness !== undefined &&
    Number.isFinite(hue) &&
    Number.isFinite(saturation) &&
    Number.isFinite(lightness)
  ) {
    // Lightness is clamped like web so near-black and near-white breaths stay visible on both themes.
    return `hsl(${Math.round(((hue % 360) + 360) % 360)}, ${clamp(saturation, 0, 100)}%, ${clamp(lightness, 18, 92)}%)`;
  }
  const accent = anima.accent?.trim() ?? "";
  return SAFE_ACCENT.test(accent) ? accent : null;
}

/** The CLI's score rises with need, so it is inverted to read as health. */
export function animaHealthLabel(health: number | null): string | null {
  return health === null || !Number.isFinite(health)
    ? null
    : `${Math.round((1 - clamp(health, 0, 1)) * 100)}% healthy`;
}

export const ANIMA_BREATH_POLL_INTERVAL_MS = 4_000;
const ANIMA_BREATH_TIMEOUT_MS = 180_000;

export type AnimaBreathStatus =
  | { readonly kind: "requesting" }
  | {
      readonly kind: "breathing";
      readonly queued: boolean;
      readonly breathCountBefore: number;
      readonly startedAt: number;
    }
  | { readonly kind: "recorded"; readonly breathCount: number }
  | { readonly kind: "timeout" }
  | { readonly kind: "failed"; readonly message: string };

/** A breath has landed once the summary's count passes the count read when it was requested. */
export function advanceAnimaBreath(
  status: Extract<AnimaBreathStatus, { kind: "breathing" }>,
  breathCount: number | null,
  now: number,
): AnimaBreathStatus {
  if (breathCount !== null && breathCount > status.breathCountBefore) {
    return { kind: "recorded", breathCount };
  }
  return now - status.startedAt >= ANIMA_BREATH_TIMEOUT_MS ? { kind: "timeout" } : status;
}

export function animaBreathStatusLabel(status: AnimaBreathStatus | null): string | null {
  switch (status?.kind) {
    case undefined:
      return null;
    case "requesting":
      return "Requesting a breath…";
    case "breathing":
      return status.queued ? "Queued. Breathes when this turn finishes" : "Breathing…";
    case "recorded":
      return `Breath ${status.breathCount} recorded`;
    case "timeout":
      return "No breath was recorded yet; check the thread";
    case "failed":
      return status.message;
  }
}
