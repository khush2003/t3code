import {
  AnimaCommandRejectedError,
  AnimaError,
  AnimaNotFoundError,
  type AnimaBreatheInput,
  type AnimaBreatheResult,
  type AnimaStartBotInput,
  type AnimaStartBotResult,
  CommandId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AnimaService from "./AnimaService.ts";

/**
 * Sends the CLI's own breathe guide so the request never drifts from it. The overrides cover what
 * made earlier breaths noisy: the bare template run, the wake, breaths padded with invention, and
 * retry loops after the CLI refused the input.
 */
function breathePrompt(name: string, guide: string, bot: boolean): string {
  return [
    `Breathe now for the anima "${name}". The user asked for this breath explicitly, so the Step 0 gate is already satisfied: skip it and do not decline.`,
    "",
    "Follow the breathe guide below from Step 1, with these overrides:",
    "- Reflect only on what actually happened in THIS thread. If little happened, say so plainly instead of inventing decisions, friction or lessons, and still record the breath.",
    "- Do not open the anima skill, do not run the wake step or `read --wake` again. The guide below is all you need.",
    "- Skip the bare template run in Step 2. Write the full breathe command yourself from your Step 1 answers and run it once.",
    "- If the CLI prints validation problems, nothing was saved: fix exactly the fields it names and rerun once. Do not change fields it accepted.",
    "- If it prints a template instead of saving, you left out the hsl, note or shape: supply them and rerun.",
    "- Never invent values to get past validation, and never reuse values from an earlier breath. Every value comes from this thread.",
    "- Do not pass the deprecated --files or --open flags.",
    ...(bot
      ? [
          "- You have no shell: record this breath with t3_anima_record, passing the same values, instead of running the command.",
        ]
      : []),
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
    readonly startBot: (
      input: AnimaStartBotInput,
    ) => Effect.Effect<
      AnimaStartBotResult,
      AnimaCommandRejectedError | AnimaError | AnimaNotFoundError
    >;
    readonly breathe: (
      input: AnimaBreatheInput,
    ) => Effect.Effect<
      typeof AnimaBreatheResult.Type,
      AnimaError | AnimaCommandRejectedError | AnimaNotFoundError
    >;
  }
>()("t3/anima/AnimaThreadService") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const animas = yield* AnimaService.AnimaService;
  const random = yield* SecureRandom.SecureRandom;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const settings = yield* ServerSettings.ServerSettingsService;

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
          reason: "The anima CLI on this environment has no breathe guide.",
        });
      // Fails with AnimaNotFoundError when the anima was deleted after the thread started.
      const { breathCount } = yield* animas.summary(name);
      const id = yield* random
        .uuidV4()
        .pipe(Effect.mapError((cause) => new AnimaError({ operation: "breathe", cause })));
      const sent = yield* threads
        .sendToThread({
          projectId: shell.projectId,
          commandId: CommandId.make(`anima-breathe:${id}`),
          threadId: input.threadId,
          messageId: MessageId.make(`anima-breathe-message:${id}`),
          text: breathePrompt(name, guide, shell.bot === true),
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

  /** The anima's one bot thread: its id derives from the name, so asking again reopens it. */
  const startBot: AnimaThreadService["Service"]["startBot"] = Effect.fn(
    "AnimaThreadService.startBot",
  )(function* ({ name }) {
    const failed = (cause: unknown) => new AnimaError({ operation: "startBot", cause });
    yield* animas.summary(name);
    let threadId = ThreadId.make(`bot:${name}`);
    // A deleted thread keeps its id, so a bot started after one takes the next.
    for (let generation = 2; ; generation += 1) {
      const shell = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(failed));
      if (shell === null) break;
      if (shell.deletedAt === null) {
        if (shell.archivedAt !== null) {
          const id = yield* random.uuidV4().pipe(Effect.mapError(failed));
          yield* threads
            .dispatch({
              type: "thread.unarchive",
              commandId: CommandId.make(`anima-bot-unarchive:${id}`),
              threadId,
            })
            .pipe(Effect.mapError(failed));
        }
        return { threadId, created: false };
      }
      threadId = ThreadId.make(`bot:${name}:${generation}`);
    }
    const claude = (yield* providers.getProviders).find(
      (provider) =>
        provider.driver === "claudeAgent" &&
        provider.enabled &&
        provider.status !== "error" &&
        provider.status !== "disabled",
    );
    // Routing work is light; the threads it starts use each project's own model.
    const model =
      claude?.models.find((candidate) => /sonnet/i.test(candidate.slug)) ??
      claude?.models.find((candidate) => candidate.isDefault === true) ??
      claude?.models[0];
    if (claude === undefined || model === undefined) {
      return yield* new AnimaCommandRejectedError({
        operation: "startBot",
        reason: "A bot runs on Claude. Set up Claude on this environment first.",
      });
    }
    const { projectId } = yield* folders.ensureScratchProject.pipe(
      Effect.mapError(
        (error) => new AnimaCommandRejectedError({ operation: "startBot", reason: error.message }),
      ),
    );
    const project = yield* projects.getById(projectId).pipe(Effect.mapError(failed));
    const { defaultRuntimeMode } = resolveProjectSettings(
      yield* settings.getSettings.pipe(Effect.mapError(failed)),
      projectId,
      Option.getOrUndefined(project),
    ).settings;
    yield* launches
      .launch({
        commandId: CommandId.make(`anima-bot:${threadId}`),
        threadId,
        projectId,
        title: name,
        modelSelection: { instanceId: claude.instanceId, model: model.slug },
        runtimeMode: defaultRuntimeMode,
        interactionMode: "default",
        bot: true,
        animaName: name,
        workspaceStrategy: { type: "root" },
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(Effect.mapError(failed));
    return { threadId, created: true };
  });

  return AnimaThreadService.of({ breathe, startBot });
});

export const layer = Layer.effect(AnimaThreadService, make);
