import { describe, expect, it } from "vite-plus/test";

import { botMood, defaultBotFace, readBotIcon } from "./botFace.logic";

const calm = { waiting: 0, working: false, failed: false, unseen: false, quietForMs: 60_000 };

describe("botMood", () => {
  it("shows the one thing that matters most", () => {
    expect(botMood(calm)).toBe("idle");
    expect(botMood({ ...calm, unseen: true })).toBe("happy");
    expect(botMood({ ...calm, unseen: true, failed: true })).toBe("worried");
    expect(botMood({ ...calm, failed: true, working: true })).toBe("working");
    // Waiting on its person shows even while it works on something else.
    expect(botMood({ ...calm, working: true, waiting: 2 })).toBe("waiting");
    expect(botMood({ ...calm, quietForMs: 9 * 60 * 60_000 })).toBe("asleep");
    expect(botMood({ ...calm, quietForMs: null })).toBe("idle");
  });
});

describe("readBotIcon", () => {
  it("reads a character, an initial or a glyph from the one stored name", () => {
    expect(readBotIcon("rover", null)).toEqual({ kind: "face", face: defaultBotFace("rover") });
    expect(readBotIcon("rover", "face-cat")).toEqual({ kind: "face", face: "cat" });
    // A character this build does not draw falls back to the bot's own.
    expect(readBotIcon("rover", "face-dragon")).toEqual({
      kind: "face",
      face: defaultBotFace("rover"),
    });
    expect(readBotIcon("rover", "initial")).toEqual({ kind: "initial" });
    expect(readBotIcon("rover", "crown")).toEqual({ kind: "glyph", glyph: "crown" });
  });
});
