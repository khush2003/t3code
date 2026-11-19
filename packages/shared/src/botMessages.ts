/**
 * What one bot reads when another tells it something, and what it reads when the answer comes
 * back. The text is written for the model; `parseBotMessage` takes it apart again so a person
 * sees who said what, without the instructions meant for the bot.
 */
const ANSWER_CHARS = 20_000;

const ASK_NOTE = (from: string) =>
  `(Your last message this turn is sent back to ${from} by itself, so write it for ${from} and put in it everything ${from} asked for. Do not call t3_bot_tell for it. When the work ends in a later turn, tell ${from} then with t3_bot_tell.)`;
const ANSWER_NOTE =
  "(This is its answer and it is not waiting on you. Carry on with what you needed it for, and tell your person what matters in it.)";

export const renderBotMessage = (from: string, message: string) =>
  `From the bot "${from}": ${message}\n\n${ASK_NOTE(from)}`;

export const renderBotAnswer = (from: string, said: string | undefined, status: string) =>
  said === undefined
    ? `The bot "${from}" ended its turn on what you told it without an answer (${status}). Tell it again when you still need one, and tell your person when this holds their work up.`
    : `The bot "${from}" answers what you told it:\n\n${said.length <= ANSWER_CHARS ? said : `${said.slice(0, ANSWER_CHARS)}…`}\n\n${ANSWER_NOTE}`;

export interface BotMessage {
  readonly bot: string;
  /** It asked this bot something, answered what this bot asked, or ended without answering. */
  readonly kind: "asks" | "answers" | "silent";
  readonly body: string;
}

const NAME = '"([a-z0-9][a-z0-9-]*)"';

/** Null for any message that is not one bot speaking to another. */
export function parseBotMessage(text: string): BotMessage | null {
  const asks = new RegExp(`^From the bot ${NAME}: ([\\s\\S]*)$`).exec(text);
  if (asks) {
    const note = `\n\n${ASK_NOTE(asks[1]!)}`;
    const body = asks[2]!;
    return {
      bot: asks[1]!,
      kind: "asks",
      body: (body.endsWith(note) ? body.slice(0, -note.length) : body).trim(),
    };
  }
  const answers = new RegExp(`^The bot ${NAME} answers what you told it:\\n\\n([\\s\\S]*)$`).exec(
    text,
  );
  if (answers) {
    const note = `\n\n${ANSWER_NOTE}`;
    const body = answers[2]!;
    return {
      bot: answers[1]!,
      kind: "answers",
      body: (body.endsWith(note) ? body.slice(0, -note.length) : body).trim(),
    };
  }
  const silent = new RegExp(
    `^The bot ${NAME} ended its turn on what you told it without an answer \\(([^)]*)\\)\\.`,
  ).exec(text);
  return silent
    ? { bot: silent[1]!, kind: "silent", body: `Ended without an answer (${silent[2]}).` }
    : null;
}
