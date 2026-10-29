/** A breath's `--note`: pitch.quality.velocity.duration.tension.tempo, as numbers or words. */
export interface BreathNote {
  readonly pitch: string;
  /** MIDI note number of the root. */
  readonly midi: number;
  readonly quality: "major" | "minor" | "diminished" | "seventh";
  /** 1..127 */
  readonly velocity: number;
  readonly beats: number;
  /** Beats per minute. */
  readonly tempo: number;
}

const SEMITONES: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const VELOCITY_WORDS: Readonly<Record<string, number>> = {
  ppp: 20,
  pp: 32,
  p: 48,
  soft: 40,
  quiet: 40,
  gentle: 48,
  mp: 60,
  moderate: 72,
  mf: 72,
  medium: 72,
  f: 96,
  loud: 96,
  strong: 96,
  ff: 112,
  fff: 124,
};
const DURATION_WORDS: Readonly<Record<string, number>> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  long: 3,
  short: 0.5,
  dotted: 1.5,
};
const TEMPO_WORDS: Readonly<Record<string, number>> = {
  grave: 40,
  largo: 50,
  lento: 56,
  adagio: 70,
  andante: 90,
  moderato: 110,
  allegretto: 116,
  allegro: 130,
  vivace: 156,
  presto: 170,
};

function quality(raw: string): BreathNote["quality"] {
  const value = raw.toLowerCase();
  if (raw === "m" || /^(min|minor|aeolian|dorian|phrygian)/.test(value)) return "minor";
  if (/^(d|dim|diminished|locrian)$/.test(value)) return "diminished";
  if (/^(7|dom|seventh|mixolydian)/.test(value)) return "seventh";
  return "major";
}

function numberOr(
  raw: string | undefined,
  words: Readonly<Record<string, number>>,
  fallback: number,
) {
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  if (Number.isFinite(parsed)) return parsed;
  return words[raw.toLowerCase()] ?? fallback;
}

/** Null for prose notes, which newer breaths store instead of music. */
export function parseBreathNote(note: string): BreathNote | null {
  const parts = note.trim().split(".");
  if (parts.length < 4 || parts.length > 7) return null;
  const match = /^([A-Ga-g])([#b]?)(\d)?$/.exec(parts[0]!);
  if (!match) return null;
  const letter = match[1]!.toUpperCase();
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const octave = match[3] === undefined ? 4 : Number(match[3]);
  return {
    pitch: `${letter}${match[2] ?? ""}${octave}`,
    midi: 12 * (octave + 1) + SEMITONES[letter]! + accidental,
    quality: quality(parts[1] ?? ""),
    velocity: Math.min(127, Math.max(1, numberOr(parts[2], VELOCITY_WORDS, 72))),
    beats: Math.min(8, Math.max(0.25, numberOr(parts[3], DURATION_WORDS, 1))),
    tempo: Math.min(220, Math.max(30, numberOr(parts.at(-1), TEMPO_WORDS, 100))),
  };
}

export const CHORD_INTERVALS: Readonly<Record<BreathNote["quality"], ReadonlyArray<number>>> = {
  major: [4, 7],
  minor: [3, 7],
  diminished: [3, 6],
  seventh: [4, 7, 10],
};

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
