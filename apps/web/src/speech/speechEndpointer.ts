/** When a person starts and stops speaking, decided from the microphone's level alone. */
export interface SpeechEndpointer {
  /**
   * `level` is the meter's 0..1 reading at `atMs`. `guarded` is true while the bot's own voice
   * plays, so what leaks back through the speakers does not count as the person speaking.
   */
  readonly push: (level: number, atMs: number, guarded: boolean) => "start" | "end" | null;
  readonly speaking: () => boolean;
  readonly reset: () => void;
}

const QUIET_FLOOR = 0.045;
const START_AFTER_MS = 120;
/** A sound that holds one level this long is the room, not a voice. */
const STEADY_MS = 1_500;
/** A pause this long ends what the person was saying; shorter ones are breaths. */
const SPEECH_HANG_MS = 800;

export function createSpeechEndpointer(hangMs = SPEECH_HANG_MS): SpeechEndpointer {
  let floor = 0;
  let speaking = false;
  let loudSince: number | null = null;
  let quietSince: number | null = null;
  let low = 0;
  let steadySince: number | null = null;
  const reset = () => {
    speaking = false;
    loudSince = null;
    quietSince = null;
    steadySince = null;
  };
  return {
    speaking: () => speaking,
    reset,
    push(level, atMs, guarded) {
      const threshold = Math.max(QUIET_FLOOR, floor * 2.5 + 0.02) * (guarded ? 2.2 : 1);
      if (!speaking) {
        if (level < threshold) {
          // The room's own noise, followed slowly so a fan does not read as speech.
          floor += (level - floor) * 0.05;
          loudSince = null;
          return null;
        }
        loudSince ??= atMs;
        if (atMs - loudSince < START_AFTER_MS) return null;
        speaking = true;
        quietSince = null;
        low = level;
        return "start";
      }
      // A voice rises and falls; a fan that came on does not, and becomes the new floor.
      low = Math.min(level, low + 0.002);
      if (level - low >= 0.03) steadySince = null;
      else steadySince ??= atMs;
      if (steadySince !== null && atMs - steadySince >= STEADY_MS) {
        floor = low;
        reset();
        return "end";
      }
      if (level >= threshold * 0.7) {
        quietSince = null;
        return null;
      }
      quietSince ??= atMs;
      if (atMs - quietSince < hangMs) return null;
      reset();
      return "end";
    },
  };
}
