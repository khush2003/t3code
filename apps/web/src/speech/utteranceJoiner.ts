/**
 * Joins what a person says in pieces. A pause mid-thought ends one piece and starts another, and
 * each is written down by itself; they are handed over as one thing once nothing more is being
 * said or written down, so a thought is one message and not three.
 */
export function createUtteranceJoiner(handlers: {
  /** Everything said since the last hand-over, in the order it was said. */
  readonly onUtterance: (text: string) => void;
  /** What was heard held no words: a cough, a chair, the bot's own echo. */
  readonly onNothing: () => void;
  /** The words written down so far that are waiting for the rest; "" once handed over. */
  readonly onHeld: (text: string) => void;
}) {
  let open = 0;
  let held = "";
  return {
    /** A piece started: the person is speaking. */
    begin() {
      open++;
    },
    /** A piece was written down; `text` is null when it could not be, or held no words. */
    end(text: string | null) {
      open = Math.max(0, open - 1);
      if (text !== null) {
        held = held === "" ? text : `${held} ${text}`;
        if (open > 0) handlers.onHeld(held);
      }
      if (open > 0) return;
      const whole = held;
      held = "";
      handlers.onHeld("");
      if (whole === "") handlers.onNothing();
      else handlers.onUtterance(whole);
    },
  };
}
