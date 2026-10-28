import {
  AnimaCommandRejectedError,
  AnimaError,
  AnimaNotFoundError,
  type AnimaBreatheInput,
  type AnimaBreatheResult,
  CommandId,
  MessageId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as AnimaService from "./AnimaService.ts";

/**
 * Sends the skill's own breathe.md so the request never drifts from it. The overrides cover what
 * made earlier breaths noisy: the bare template run, the wake, and breaths padded with invention.
 */
function breathePrompt(name: string, guide: string): string {
  return [
    `Breathe now for the anima "${name}". The user asked for this breath explicitly, so the Step 0 gate is already satisfied: skip it and do not decline.`,
    "",
    "Follow the breathe guide below from Step 1, with these overrides:",
    "- Reflect only on what actually happened in THIS thread. If little happened, say so plainly instead of inventing decisions, friction or lessons, and still record the breath.",
    "- Do not open the anima skill, do not run the wake step or `read --wake` again. The guide below is all you need.",
    "- Skip the bare template run in Step 2. Write the full breathe command yourself from your Step 1 answers and run it once.",
    "",
    "<breathe-guide>",
    guide.replaceAll("<name>", name).trim(),
    "</breathe-guide>",
    "",
    "Finish with a 2-3 sentence plain-language summary for the user that names the new breath number, the aim, and anything you encoded in Step 3. No raw command output and no jargon.",
  ].join("\n");
}

/**
 * Kept apart from AnimaService: AnimaService is a leaf that thread launch depends on, and anything
 * that reads or messages threads must sit above it.
 */
export class AnimaThreadService extends Context.Service<
  AnimaThreadService,
  {
    readonly breathe: (
      input: typeof AnimaBreatheInput.Type,
    ) => Effect.Effect<
      typeof AnimaBreatheResult.Type,
      AnimaError | AnimaCommandRejectedError | AnimaNotFoundError
    >;
  }
>()("t3/anima/AnimaThreadService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const animas = yield* AnimaService.AnimaService;
  const crypto = yield* Crypto.Crypto;

  const breathe: AnimaThreadService["Service"]["breathe"] = Effect.fn("AnimaThreadService.breathe")(
    function* (input) {
      const shell = yield* threads
        .getThreadShell(input.threadId)
        .pipe(Effect.mapError((cause) => new AnimaError({ operation: "breathe", cause })));
      if (shell === null)
        return yield* new AnimaCommandRejectedError({
          operation: "breathe",
          reason: "The thread was not found.",
        });
      const name = shell.animaName;
      if (name === undefined || name === null)
        return yield* new AnimaCommandRejectedError({
          operation: "breathe",
          reason: "This thread does not run with an anima.",
        });
      if (shell.archivedAt !== null)
        return yield* new AnimaCommandRejectedError({
          operation: "breathe",
          reason: "This thread is archived. Unarchive it before asking the anima to breathe.",
        });
      if (!(yield* animas.cliAvailable))
        return yield* new AnimaCommandRejectedError({
          operation: "breathe",
          reason: "The anima CLI is not installed on this environment.",
        });
      const guide = yield* animas.breatheGuide;
      if (guide.trim() === "")
        return yield* new AnimaCommandRejectedError({
          operation: "breathe",
          reason: "The anima skill on this environment has no breathe.md.",
        });
      // Fails with AnimaNotFoundError when the anima was deleted after the thread started.
      const { breathCount } = yield* animas.summary(name);
      const id = yield* crypto
        .randomUUIDv4()
        .pipe(Effect.mapError((cause) => new AnimaError({ operation: "breathe", cause })));
      const sent = yield* threads
        .sendToThread({
          projectId: shell.projectId,
          commandId: CommandId.make(`anima-breathe:${id}`),
          threadId: input.threadId,
          messageId: MessageId.make(`anima-breathe-message:${id}`),
          text: breathePrompt(name, guide),
          attachments: [],
          mode: "queue",
          createdBy: "user",
          creationSource: "web",
        })
        .pipe(Effect.mapError((cause) => new AnimaError({ operation: "breathe", cause })));
      return {
        name,
        threadId: input.threadId,
        breathCountBefore: breathCount,
        queued: sent.delivery === "queued",
      };
    },
  );

  return AnimaThreadService.of({ breathe });
});

export const layer = Layer.effect(AnimaThreadService, make);
