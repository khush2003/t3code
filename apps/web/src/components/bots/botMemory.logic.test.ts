import type { BotNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  botNoteMatches,
  botNoteTopics,
  listBotNote,
  listBotNotes,
  markBotNoteSearch,
  readBotCharter,
  writeBotCharter,
} from "./botMemory.logic";

const note = (fields: Partial<BotNote>) =>
  ({
    id: "note:1",
    text: "The person's name is Sam.",
    createdAt: "2026-11-19T08:00:00.000Z",
    quote: "I'm Sam",
    source: null,
    title: null,
    topic: null,
    author: "bot",
    outdatedAt: null,
    ...fields,
  }) as BotNote;

describe("bot memory", () => {
  it("lists a note under the day it says it is about, without that opening", () => {
    expect(
      listBotNote(
        note({ text: "As of 2026-11-18, the branch is pushed to origin.", title: "Branch pushed" }),
      ),
    ).toMatchObject({
      day: "2026-11-18",
      title: "Branch pushed",
      body: "The branch is pushed to origin.",
    });
    expect(listBotNote(note({ text: "On 2026-11-17 Sam asked for a plan." }))).toMatchObject({
      day: "2026-11-17",
      title: "Sam asked for a plan.",
      body: null,
    });
  });

  it("shows one line for a note with no title yet, or one its title already says", () => {
    expect(listBotNote(note({}))).toMatchObject({
      day: "2026-11-19",
      title: "The person's name is Sam.",
      body: null,
    });
    expect(listBotNote(note({ title: "The person's name is Sam" })).body).toBeNull();
  });

  it("orders notes by the day they are about, then by when they were written", () => {
    expect(
      listBotNotes([
        note({ id: "a", text: "On 2026-11-17, one.", createdAt: "2026-11-19T09:00:00.000Z" }),
        note({ id: "b", text: "Two.", createdAt: "2026-11-18T09:00:00.000Z" }),
        note({ id: "c", text: "Three.", createdAt: "2026-11-18T12:00:00.000Z" }),
      ]).map((listed) => listed.note.id),
    ).toEqual(["c", "b", "a"]);
  });

  it("counts the notes under each topic, the fullest first, leaving out the unfiled", () => {
    expect(
      botNoteTopics([
        note({ topic: "You" }),
        note({ topic: "Posters" }),
        note({ topic: "Posters" }),
        note({ topic: "Billing" }),
        note({}),
      ]),
    ).toEqual([
      { topic: "Posters", count: 2 },
      { topic: "Billing", count: 1 },
      { topic: "You", count: 1 },
    ]);
  });

  it("finds a note by words in its text, title, topic, passage or source, in any order", () => {
    const posters = note({
      text: "The poster work lives on a local branch.",
      title: "Posters are not pushed",
      topic: "Launch",
      quote: "17 commits ahead",
      source: "Poster UI: where does the work stand?",
    });
    expect(botNoteMatches(posters, "branch poster")).toBe(true);
    expect(botNoteMatches(posters, "PUSHED launch")).toBe(true);
    expect(botNoteMatches(posters, "commits stand")).toBe(true);
    expect(botNoteMatches(posters, "poster billing")).toBe(false);
    expect(botNoteMatches(posters, "  ")).toBe(true);
  });

  it("marks where the search's words occur, whatever they contain", () => {
    expect(markBotNoteSearch("Use C++ for the Poster work", "poster c++")).toEqual([
      { text: "Use ", hit: false },
      { text: "C++", hit: true },
      { text: " for the ", hit: false },
      { text: "Poster", hit: true },
      { text: " work", hit: false },
    ]);
    expect(markBotNoteSearch("Plain", "")).toEqual([{ text: "Plain", hit: false }]);
  });

  it("reads a charter into its parts only when it writes back letter for letter", () => {
    const fresh =
      "What I am for: Ship the launch.\n\nHow my person wants work done: nothing recorded yet.";
    expect(readBotCharter(fresh)).toEqual({
      purpose: "Ship the launch.",
      heading: null,
      rules: [],
    });

    const ruled =
      "What I am for: Ship the launch.\n\nStanding instructions:\n- Plan first; ask before big decisions.\n- Use the stronger model (the big one) for heavy work.";
    const parts = readBotCharter(ruled)!;
    expect(parts).toMatchObject({ heading: "Standing instructions:", rules: { length: 2 } });
    expect(writeBotCharter(parts)).toBe(ruled);

    // A bot's own prose is not rules, and is left for the plain editor.
    for (const loose of [
      "What I am for: Ship the launch.\n\nStanding decisions: the video is 30 seconds.",
      "What I am for: Ship the launch.\n\nRules:\n- One.\n\nAlso remember the ad slot.",
      "I help with the launch.",
    ])
      expect(readBotCharter(loose)).toBeNull();
  });

  it("writes a first rule under the usual heading, and no rules as none recorded", () => {
    const fresh = { purpose: "Ship  the launch. ", heading: null, rules: [] };
    expect(writeBotCharter({ ...fresh, rules: ["Ask before\nmerging.", " "] })).toBe(
      "What I am for: Ship the launch.\n\nHow my person wants work done:\n- Ask before merging.",
    );
    expect(writeBotCharter({ ...fresh, heading: "Standing instructions:" })).toBe(
      "What I am for: Ship the launch.\n\nHow my person wants work done: nothing recorded yet.",
    );
  });
});
