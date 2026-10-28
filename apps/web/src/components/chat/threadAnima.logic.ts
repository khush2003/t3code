import type { AnimaThreadRuntimeStatus } from "@t3tools/contracts";

/** Matches the server's session staleness window for an anima's `live` flag. */
export const ANIMA_LIVE_WINDOW_MS = 90 * 60 * 1000;

export type AnimaThreadSignal = "loop" | "breath-due" | "live" | "idle";

/** The single most urgent thing to show for a thread's anima; a loop outranks a due breath. */
export function animaThreadSignal(
  status: AnimaThreadRuntimeStatus | null,
  now: number,
): AnimaThreadSignal {
  if (status === null) return "idle";
  if (status.loop !== null) return "loop";
  if (status.breathDue) return "breath-due";
  const beat = status.lastHeartbeatAt === null ? Number.NaN : Date.parse(status.lastHeartbeatAt);
  return Number.isFinite(beat) && now - beat <= ANIMA_LIVE_WINDOW_MS ? "live" : "idle";
}

/** Breaths recorded since this thread woke its anima; null before the wake. */
export function breathsSinceWake(status: AnimaThreadRuntimeStatus): number | null {
  return status.breathsAtWake === null
    ? null
    : Math.max(0, status.breathCount - status.breathsAtWake);
}
