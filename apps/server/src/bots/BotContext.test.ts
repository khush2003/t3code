import { BotName } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { renderBotStanding } from "./BotContext.ts";
import type { BotNote, BotRecord } from "./BotStore.ts";

const note = (id: string, text: string, author: BotNote["author"] = "bot") =>
  ({ id, text, author }) as BotNote;

describe("renderBotStanding", () => {
  it("always sends what the person wrote, and the newest of the bot's own notes after it", () => {
    const standing = renderBotStanding(
      { name: BotName.make("atlas"), charter: "c", oversees: false } as BotRecord,
      [],
      [
        note("note:new", "n".repeat(1_500)),
        note("note:mid", "m".repeat(1_500)),
        note("note:old", "o".repeat(1_500)),
        note("note:mine", "Never post on Sundays.", "user"),
      ],
    );
    expect(standing).toContain("- [note:mine] (written by your person) Never post on Sundays.");
    expect(standing.indexOf("note:mine")).toBeLessThan(standing.indexOf("note:new"));
    expect(standing).not.toContain("note:mid");
    expect(standing).toContain("(2 older notes; t3_bot_recall finds them.)");
  });
});
