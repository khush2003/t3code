import { expect, it } from "vite-plus/test";

import { createUtteranceJoiner } from "./utteranceJoiner";

it("hands over what was said in pieces as one thing, once nothing more is on its way", () => {
  const got: string[] = [];
  const joiner = createUtteranceJoiner({
    onUtterance: (text) => got.push(`said:${text}`),
    onNothing: () => got.push("nothing"),
    onHeld: (text) => got.push(`held:${text}`),
  });

  // One thing said: handed over as soon as it is written down.
  joiner.begin();
  joiner.end("Hello rover.");
  expect(got).toEqual(["held:", "said:Hello rover."]);

  // A pause mid-thought: the first piece waits for the second, which started before it was done.
  got.length = 0;
  joiner.begin();
  joiner.begin();
  joiner.end("Tell scout");
  expect(got).toEqual(["held:Tell scout"]);
  joiner.end("the login is done.");
  expect(got.slice(1)).toEqual(["held:", "said:Tell scout the login is done."]);

  // A cough after a sentence does not lose the sentence, and a cough alone is nothing.
  got.length = 0;
  joiner.begin();
  joiner.begin();
  joiner.end("Stop there.");
  joiner.end(null);
  expect(got.at(-1)).toBe("said:Stop there.");
  got.length = 0;
  joiner.begin();
  joiner.end(null);
  expect(got).toEqual(["held:", "nothing"]);
});
