import type { BotNote } from "@t3tools/contracts";

/** A note as the memory page lists it: under a day, without the date its text opened with. */
export interface ListedBotNote {
  readonly note: BotNote;
  /** `YYYY-MM-DD`: the day the note says it is about, or the day it was written. */
  readonly day: string;
  readonly text: string;
}

const LEADING_DAY = /^(?:As of|On|Since) (\d{4}-\d{2}-\d{2})[,:]\s+/;

/**
 * A bot dates what it writes down ("As of 2026-11-18, the branch is pushed"). The page groups notes
 * by that day, so the row drops the opening and starts at what was learned.
 */
export function listBotNote(note: BotNote): ListedBotNote {
  const match = LEADING_DAY.exec(note.text);
  if (match === null) return { note, day: note.createdAt.slice(0, 10), text: note.text };
  const rest = note.text.slice(match[0].length);
  return { note, day: match[1]!, text: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/** Notes under the day each is about, newest day first, newest note first within a day. */
export function groupBotNotesByDay(
  notes: ReadonlyArray<BotNote>,
): ReadonlyArray<{ readonly day: string; readonly notes: ReadonlyArray<ListedBotNote> }> {
  const days = new Map<string, Array<ListedBotNote>>();
  for (const note of notes.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const listed = listBotNote(note);
    days.set(listed.day, [...(days.get(listed.day) ?? []), listed]);
  }
  return [...days]
    .toSorted(([a], [b]) => b.localeCompare(a))
    .map(([day, listed]) => ({ day, notes: listed }));
}

/** Every word of the search appears in the note, the passage it rests on, or where it came from. */
export function botNoteMatches(note: BotNote, search: string): boolean {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${note.text}\n${note.quote}\n${note.source ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}
