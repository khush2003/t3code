import type { BotNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botNoteMatches, groupBotNotesByDay, listBotNote } from "./botMemory.logic";

const note = (fields: Partial<BotNote>) =>
  ({
    id: "note:1",
    text: "The user's name is Khush.",
    createdAt: "2026-11-19T08:00:00.000Z",
    quote: "I'm Khush",
    source: null,
    outdatedAt: null,
    ...fields,
  }) as BotNote;

describe("bot memory", () => {
  it("files a note under the day it says it is about and drops that opening", () => {
    expect(
      listBotNote(note({ text: "As of 2026-11-18, the branch is pushed to origin." })),
    ).toMatchObject({ day: "2026-11-18", text: "The branch is pushed to origin." });
    expect(listBotNote(note({ text: "On 2026-11-17, Khush asked for a plan." }))).toMatchObject({
      day: "2026-11-17",
      text: "Khush asked for a plan.",
    });
  });

  it("files an undated note under the day it was written, text untouched", () => {
    expect(listBotNote(note({}))).toMatchObject({
      day: "2026-11-19",
      text: "The user's name is Khush.",
    });
  });

  it("groups by day, newest day and newest note first", () => {
    const groups = groupBotNotesByDay([
      note({ id: "a", text: "On 2026-11-17, one.", createdAt: "2026-11-17T09:00:00.000Z" }),
      note({ id: "b", text: "As of 2026-11-18, two.", createdAt: "2026-11-18T09:00:00.000Z" }),
      note({ id: "c", text: "As of 2026-11-18, three.", createdAt: "2026-11-18T12:00:00.000Z" }),
    ]);
    expect(groups.map((group) => [group.day, group.notes.map((listed) => listed.note.id)])).toEqual(
      [
        ["2026-11-18", ["c", "b"]],
        ["2026-11-17", ["a"]],
      ],
    );
  });

  it("finds a note by words in its text, its passage or its source, in any order", () => {
    const starblast = note({
      text: "The Starblast work lives on a local branch.",
      quote: "17 commits ahead, not pushed",
      source: "Starblast UI: where does the work stand?",
    });
    expect(botNoteMatches(starblast, "branch starblast")).toBe(true);
    expect(botNoteMatches(starblast, "PUSHED")).toBe(true);
    expect(botNoteMatches(starblast, "stand")).toBe(true);
    expect(botNoteMatches(starblast, "starblast powerups")).toBe(false);
    expect(botNoteMatches(starblast, "  ")).toBe(true);
  });
});
