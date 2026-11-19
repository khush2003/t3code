import type { BotNote } from "@t3tools/contracts";

/** A note as the memory page lists it. */
export interface ListedBotNote {
  readonly note: BotNote;
  /** `YYYY-MM-DD`: the day the note says it is about, or the day it was written. */
  readonly day: string;
  readonly title: string;
  /** The note without the date it opened with; null when the title already says all of it. */
  readonly body: string | null;
}

const LEADING_DAY = /^(?:As of|On|Since) (\d{4}-\d{2}-\d{2})[,:]?\s+/;
const plain = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[\s.]+/g, " ")
    .trim();

/**
 * A bot dates what it writes down ("As of 2026-11-18, the branch is pushed"). The row shows that
 * day beside the note, so its text starts at what was learned. A note not titled yet is its own
 * title.
 */
export function listBotNote(note: BotNote): ListedBotNote {
  const match = LEADING_DAY.exec(note.text);
  const rest = match === null ? note.text : note.text.slice(match[0].length);
  const text = match === null ? rest : rest.charAt(0).toUpperCase() + rest.slice(1);
  const day = match === null ? note.createdAt.slice(0, 10) : match[1]!;
  if (note.title === null || plain(note.title) === plain(text))
    return { note, day, title: text, body: null };
  return { note, day, title: note.title, body: text };
}

/** Newest day first, and within a day the note written last. */
export function listBotNotes(notes: ReadonlyArray<BotNote>): ReadonlyArray<ListedBotNote> {
  return notes
    .map(listBotNote)
    .toSorted(
      (a, b) => b.day.localeCompare(a.day) || b.note.createdAt.localeCompare(a.note.createdAt),
    );
}

/** The topics notes are filed under, the fullest first. */
export function botNoteTopics(
  notes: ReadonlyArray<BotNote>,
): ReadonlyArray<{ readonly topic: string; readonly count: number }> {
  const counts = new Map<string, number>();
  for (const note of notes)
    if (note.topic !== null) counts.set(note.topic, (counts.get(note.topic) ?? 0) + 1);
  return [...counts]
    .map(([topic, count]) => ({ topic, count }))
    .toSorted((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
}

const searchWords = (search: string) => search.toLowerCase().split(/\s+/).filter(Boolean);

/** Every word of the search appears in the note, its title or topic, its passage or its source. */
export function botNoteMatches(note: BotNote, search: string): boolean {
  const words = searchWords(search);
  if (words.length === 0) return true;
  const haystack = [note.title, note.topic, note.text, note.quote, note.source]
    .join("\n")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** `text` cut where the search's words occur, so a row can mark them. */
export function markBotNoteSearch(
  text: string,
  search: string,
): ReadonlyArray<{ readonly text: string; readonly hit: boolean }> {
  const words = searchWords(search);
  if (words.length === 0) return [{ text, hit: false }];
  const pattern = new RegExp(
    `(${words.map((word) => word.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text
    .split(pattern)
    .map((part, index) => ({ text: part, hit: index % 2 === 1 }))
    .filter((part) => part.text !== "");
}

/** A charter in the shape bots keep it: what the bot is for, then rules, one to a line. */
export interface BotCharterParts {
  readonly purpose: string;
  /** The line the bot put above its rules; null while it has none. */
  readonly heading: string | null;
  readonly rules: ReadonlyArray<string>;
}

const PURPOSE = "What I am for: ";
const RULES_HEADING = "How my person wants work done:";
const NO_RULES = `${RULES_HEADING} nothing recorded yet.`;

export function writeBotCharter(parts: BotCharterParts): string {
  const rules = parts.rules.map((rule) => rule.replaceAll(/\s+/g, " ").trim()).filter(Boolean);
  return [
    `${PURPOSE}${parts.purpose.replaceAll(/\s+/g, " ").trim()}`,
    "",
    ...(rules.length === 0
      ? [NO_RULES]
      : [parts.heading ?? RULES_HEADING, ...rules.map((rule) => `- ${rule}`)]),
  ].join("\n");
}

/**
 * The parts of a charter, or null when it is not exactly that shape. A bot may rewrite its charter
 * any way it likes, so one that would not be written back letter for letter is edited as text.
 */
export function readBotCharter(charter: string): BotCharterParts | null {
  const [first = "", gap, ...rest] = charter.split("\n");
  if (!first.startsWith(PURPOSE) || gap !== "" || rest.length === 0) return null;
  const purpose = first.slice(PURPOSE.length);
  const parts =
    rest.length === 1 && rest[0] === NO_RULES
      ? { purpose, heading: null, rules: [] }
      : {
          purpose,
          heading: rest[0]!,
          rules: rest.slice(1).map((line) => line.replace(/^- /, "")),
        };
  return writeBotCharter(parts) === charter ? parts : null;
}
