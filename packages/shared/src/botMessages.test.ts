import { describe, expect, it } from "vite-plus/test";

import { parseBotMessage, renderBotAnswer, renderBotMessage } from "./botMessages.ts";

describe("parseBotMessage", () => {
  it("reads back who said what from the text a bot was given", () => {
    expect(
      parseBotMessage(renderBotMessage("rover", "where does the site stand?\n\nbe brief")),
    ).toEqual({ bot: "rover", kind: "asks", body: "where does the site stand?\n\nbe brief" });
    expect(parseBotMessage(renderBotAnswer("manager", "Only sound is left.", "completed"))).toEqual(
      {
        bot: "manager",
        kind: "answers",
        body: "Only sound is left.",
      },
    );
    expect(parseBotMessage(renderBotAnswer("manager", undefined, "interrupted"))).toEqual({
      bot: "manager",
      kind: "silent",
      body: "Ended without an answer (interrupted).",
    });
    // An older message, written before the note at its end was added, still reads.
    expect(parseBotMessage('From the bot "scout": check the posters')?.body).toBe(
      "check the posters",
    );
    expect(parseBotMessage("From the bottom of the file")).toBeNull();
  });
});
