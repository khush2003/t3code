/** What a bot's face shows, read from what the bot is doing. One mood at a time. */
export type BotMood = "idle" | "working" | "waiting" | "happy" | "asleep" | "worried";

/** A bot nobody has heard from for this long has dozed off. */
const ASLEEP_AFTER_MS = 8 * 60 * 60_000;

export function botMood(input: {
  /** Work items and requests that wait on its person. */
  readonly waiting: number;
  readonly working: boolean;
  /** Its last turn failed. */
  readonly failed: boolean;
  /** It answered and its person has not looked yet. */
  readonly unseen: boolean;
  /** How long since anything happened in its chat; null when unknown. */
  readonly quietForMs: number | null;
}): BotMood {
  // What needs its person outranks what the bot is doing.
  if (input.waiting > 0) return "waiting";
  if (input.working) return "working";
  if (input.failed) return "worried";
  if (input.unseen) return "happy";
  return input.quietForMs !== null && input.quietForMs > ASLEEP_AFTER_MS ? "asleep" : "idle";
}

export const BOT_FACE_NAMES = ["blob", "ghost", "cat", "robot", "drop", "bear", "sprout"] as const;
export type BotFaceName = (typeof BOT_FACE_NAMES)[number];

const hashOf = (name: string) => {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
};

/** The character a bot gets before its person chooses one, so no two start out alike. */
export const defaultBotFace = (name: string): BotFaceName =>
  BOT_FACE_NAMES[(hashOf(name) >>> 3) % BOT_FACE_NAMES.length]!;

/**
 * What the stored icon name stands for: a character (`face-cat`), the bot's initial, or a
 * glyph. Nothing stored means the character its name picks.
 */
export function readBotIcon(
  name: string,
  icon: string | null | undefined,
):
  | { readonly kind: "face"; readonly face: BotFaceName }
  | { readonly kind: "initial" }
  | { readonly kind: "glyph"; readonly glyph: string } {
  if (icon == null) return { kind: "face", face: defaultBotFace(name) };
  if (icon === "initial") return { kind: "initial" };
  const face = icon.startsWith("face-") ? icon.slice(5) : null;
  if (face !== null)
    return {
      kind: "face",
      face: (BOT_FACE_NAMES as ReadonlyArray<string>).includes(face)
        ? (face as BotFaceName)
        : defaultBotFace(name),
    };
  return { kind: "glyph", glyph: icon };
}
