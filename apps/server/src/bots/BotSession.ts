import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";

/** About 45 short turns past a fresh session, which starts near 35k tokens. */
const SESSION_TOKENS = 80_000;
/** Long past any prompt cache, so a fresh session is the cheaper turn as well. */
const SESSION_IDLE = Duration.hours(6);
/** The runs a fresh session is handed the tail of; anything older is in the bot's memory. */
export const SESSION_TAIL_RUNS = 12;

/**
 * Whether a bot's next turn starts a fresh model session. Nothing a bot needs lives in the
 * session, so replacing it often keeps turns small and shows a gap in its memory the day it
 * opens, not months later.
 */
export function botSessionDue(input: {
  readonly usedTokens: number | undefined;
  readonly lastRunEndedAt: DateTime.Utc | null;
  readonly now: DateTime.Utc;
}): boolean {
  if ((input.usedTokens ?? 0) >= SESSION_TOKENS) return true;
  return (
    input.lastRunEndedAt !== null &&
    DateTime.toEpochMillis(input.now) - DateTime.toEpochMillis(input.lastRunEndedAt) >=
      Duration.toMillis(SESSION_IDLE)
  );
}
