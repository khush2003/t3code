const FENCE = /^\s*(```|~~~)/;
const TABLE_ROW = /^\s*\|/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const SENTENCE_END = /[.!?…]["')\]]*\s+/g;

function sayable(markdown: string) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
    .replace(/[*_~#`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const LONG_UNIT = 80;
const CLAUSE_END = /[,;:]\s+/g;

/** A long sentence in clauses, so the voice starts on its first part while the rest is made. */
function clauses(sentence: string): ReadonlyArray<string> {
  if (sentence.length <= LONG_UNIT) return [sentence];
  const parts: string[] = [];
  let from = 0;
  for (const match of sentence.matchAll(CLAUSE_END)) {
    const end = match.index + match[0].length;
    // A clause too short to be worth its own breath stays with what follows.
    if (end - from < 30 || sentence.length - end < 20) continue;
    parts.push(sentence.slice(from, end).trim());
    from = end;
  }
  parts.push(sentence.slice(from).trim());
  return parts;
}

/**
 * What of a reply is said aloud, cut into the pieces a voice says one at a time. Code and tables
 * are for the eye and are left out. A piece is given only once it is whole, so the pieces of a
 * reply still arriving never change: say `units.slice(said)` each time more text comes.
 */
export function spokenUnits(markdown: string, done: boolean): ReadonlyArray<string> {
  const units: string[] = [];
  const lines = markdown.split("\n");
  // Without its newline the last line may still grow; a fence could be half of its marker.
  const open = done ? null : lines.pop()!;
  let fenced = false;
  const take = (line: string, whole: boolean) => {
    if (FENCE.test(line)) {
      if (whole) fenced = !fenced;
      return;
    }
    if (fenced || TABLE_ROW.test(line) || RULE.test(line)) return;
    let from = 0;
    for (const match of line.matchAll(SENTENCE_END)) {
      const end = match.index + match[0].length;
      const unit = sayable(line.slice(from, end));
      if (unit !== "") units.push(...clauses(unit));
      from = end;
    }
    if (!whole) return;
    const rest = sayable(line.slice(from));
    if (rest !== "") units.push(...clauses(rest));
  };
  for (const line of lines) take(line, true);
  if (open !== null) take(open, false);
  return units;
}

/** `x` and `y` are parts of the view's half width and half height; `z` is depth behind the centre. */
export interface BotStarPlace {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function hash(text: string) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++)
    value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

const ARC = (50 * Math.PI) / 180;

/**
 * Where each bot hangs. The one that oversees the others is at the centre; the rest sit to its
 * left and right, the side taken from their name, so the middle column stays clear for the
 * centre's label and what is being said. A crowded side staggers into two rings.
 */
export function placeBotStars(
  bots: ReadonlyArray<{ readonly name: string; readonly oversees: boolean }>,
): ReadonlyMap<string, BotStarPlace> {
  const places = new Map<string, BotStarPlace>();
  const centre = bots.find((bot) => bot.oversees) ?? bots[0];
  if (centre === undefined) return places;
  places.set(centre.name, { x: 0, y: 0, z: 0 });
  const around = bots
    .filter((bot) => bot !== centre)
    .map((bot) => ({ name: bot.name, seed: hash(bot.name) }))
    .toSorted((a, b) => a.seed - b.seed || a.name.localeCompare(b.name));
  const right = around.filter((bot) => bot.seed % 2 === 0);
  const left = around.filter((bot) => bot.seed % 2 === 1);
  // One lopsided side reads as a mistake; the fuller side lends its last bot to the other.
  while (Math.abs(right.length - left.length) > 1)
    (right.length > left.length ? left : right).push(
      (right.length > left.length ? right : left).pop()!,
    );
  for (const [side, direction] of [
    [right, 1],
    [left, -1],
  ] as const)
    side.forEach((bot, index) => {
      const angle = ARC * (((index + 0.5) / side.length) * 2 - 1);
      const reach = side.length > 3 && index % 2 === 1 ? 0.62 : 0.86;
      places.set(bot.name, {
        x: direction * Math.cos(angle) * reach,
        y: Math.sin(angle) * 0.8,
        z: -(((bot.seed >>> 20) % 100) / 100) * 2,
      });
    });
  return places;
}
