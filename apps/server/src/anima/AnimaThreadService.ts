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
 * Self-contained so the agent never opens the anima skill or breathe.md: those walk through the
 * wake and a bare template run, which is what made earlier breaths noisy and invented.
 */
export function breathePrompt(name: string): string {
  const cli = "bun ~/.claude/skills/anima/anima.ts";
  return [
    `Breathe now. This is an explicit request from the user, so the "is this a chapter boundary" gate is satisfied: do not decline. Record one breath for the anima "${name}" from this thread only. Do not open the anima skill or breathe.md, do not run the wake step or \`read --wake\` again.`,
    "",
    "Reflect only on what actually happened in THIS thread. If little happened, say so plainly in decisions and friction instead of inventing anything, and still record the breath.",
    "",
    "Step 1. Run exactly one command (never redirect or suppress stderr; read its output):",
    `${cli} breathe --agent ${name} --self "trait=0.x,trait=0.x,trait=0.x" --decisions "..." --friction "..." --aim "..." [--corrections "\"the user's own words\"|principle"]`,
    "- --self: at least 3 traits whose value really shifted in this thread, each as name=value between 0 and 1.",
    "- --decisions: the real choices made here and why, in one or two sentences.",
    "- --friction: what actually slowed or surprised you here, or say plainly that nothing did.",
    "- --aim: the next move as a verb, a target and a done-when, at least 15 characters. Never a wait or a vague intention.",
    "- --corrections: only when the user corrected you; quote their words, then a pipe, then the principle. Leave the flag out otherwise.",
    "",
    "Step 2. Encode what the breath taught you, only where it qualifies, and nothing at all is fine:",
    `- A policy rule (\`${cli} policy --agent ${name} --add "WHEN ... THEN ..."\`) only if it will fire again in future work.`,
    "- identity.md only if your self-understanding shifted.",
    "- A skill only if you found a reusable technique.",
    "",
    "Finish with a 2-3 sentence plain-language summary for the user that names the new breath number and the aim. No raw command output and no jargon.",
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
          text: breathePrompt(name),
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
