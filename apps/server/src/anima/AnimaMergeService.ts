import {
  AnimaCommandRejectedError,
  AnimaError,
  AnimaName,
  AnimaNotFoundError,
  type AnimaBundle,
  AnimaBundleFile,
  type AnimaMergeConflict,
  AnimaMergeApplyInput,
  type AnimaMergeStartInput,
  type AnimaMergeStartResult,
  AnimaMergeStatusInput,
  type AnimaMergeStatusResult,
  type AnimaMutationResult,
  CommandId,
  MessageId,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { resolveNewThreadModelSelection } from "@t3tools/shared/usageLimits";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AnimaFiles from "./AnimaFiles.ts";
import * as AnimaMerge from "./AnimaMerge.ts";
import * as AnimaService from "./AnimaService.ts";

const MERGE_DIR = ".merge";
const DONE_FILE = "DONE";
const FAILED_FILE = "FAILED";
const APPLIED_FILE = "APPLIED";
const META_FILE = "meta.json";
const INSTRUCTIONS_FILE = "MERGE.md";
const MERGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type MergeFailure = AnimaError | AnimaCommandRejectedError | AnimaNotFoundError;

const MergeMeta = Schema.Struct({
  mergeId: Schema.String,
  name: AnimaName,
  animaId: Schema.String,
  projectId: ProjectId,
  threadId: ThreadId,
  createdAt: Schema.String,
});
type MergeMeta = typeof MergeMeta.Type;
const MergeMetaJson = Schema.fromJsonString(MergeMeta);
/** The other machine's files at merge start: after applying, the base for the next sync. */
const INCOMING_FILE = "incoming.json";
const IncomingJson = Schema.fromJsonString(Schema.Array(AnimaBundleFile));
const encodeIncoming = Schema.encodeEffect(IncomingJson);
const decodeIncoming = Schema.decodeUnknownEffect(IncomingJson);
const encodeMergeMeta = Schema.encodeEffect(MergeMetaJson);

export class AnimaMergeService extends Context.Service<
  AnimaMergeService,
  {
    readonly start: (
      input: AnimaMergeStartInput,
    ) => Effect.Effect<AnimaMergeStartResult, MergeFailure>;
    readonly status: (
      input: typeof AnimaMergeStatusInput.Type,
    ) => Effect.Effect<AnimaMergeStatusResult, MergeFailure>;
    readonly apply: (
      input: typeof AnimaMergeApplyInput.Type,
    ) => Effect.Effect<AnimaMutationResult, MergeFailure>;
  }
>()("t3/anima/AnimaMergeService") {}

function describeConflict(conflict: AnimaMergeConflict, index: number): string {
  const where =
    conflict.key === null ? conflict.path : `\`# ${conflict.key}:\` in ${conflict.path}`;
  const clip = (text: string) => (text.length > 1200 ? `${text.slice(0, 1200)}\n[...]` : text);
  return `### ${index + 1}. ${where}

This machine (local):
\`\`\`
${clip(conflict.local)}
\`\`\`

The other machine (incoming):
\`\`\`
${clip(conflict.incoming)}
\`\`\``;
}

function renderMergeInstructions(input: {
  readonly name: string;
  readonly mergeId: string;
  readonly stagingPath: string;
  readonly localOnlyBreaths: number;
  readonly incomingOnlyBreaths: number;
  readonly conflicts: ReadonlyArray<AnimaMergeConflict>;
}): string {
  const conflicts =
    input.conflicts.length === 0
      ? "None. Check the draft reads coherently, then finish."
      : input.conflicts.map(describeConflict).join("\n\n");
  return `# Merge anima '${input.name}' (${input.mergeId})

Two copies of the anima \`${input.name}\` drifted apart: one on this machine (\`local/\`) and one
from another machine (\`incoming/\`). Both did real work, so the result keeps both.

Staging directory: \`${input.stagingPath}\`

\`\`\`
local/     current files on this machine (read only)
incoming/  files from the other machine (read only)
merged/    a draft that already combines everything a rule could decide
\`\`\`

## What the draft already did

- **Breaths.** Every breath from both sides is kept (${input.localOnlyBreaths} only here,
  ${input.incomingOnlyBreaths} only there). Breaths after the last shared one are ordered by time
  and renumbered, with \`agent.anima\` rows, \`# breath:\` and \`parent:\` rewritten to match. Do not
  renumber, drop or rewrite breaths, and keep every \`hash:\` as it is.
- **State the CLI rewrites each breath** (memo, aim, arc, ka, hue) comes from the side with the
  latest breath. Traits (\`self\`, \`skills\`, \`user\`) keep the more certain estimate (lower sigma).
  Lists (\`projects\`, \`kin\`, \`team\`, \`tension\`) are combined. \`breaths:\` is recomputed.
- **policy.md** keeps rules added on either side and drops rules either side removed.
- Anything only one side changed since the two last synced takes that side's version.

## Conflicts to resolve with the user

Each item below was changed differently on both machines. The draft currently holds the version
from the machine with the latest breath; that is a placeholder, not a decision.

${conflicts}

For each conflict, ask the user how to resolve it with your question tool (AskUserQuestion, or
request_user_input). Offer: keep this machine's version, keep the other machine's, or a combined
version you write that keeps what is distinctive in both (show it). Ask about related conflicts
together when that is clearer, but never settle a contradiction without the user. Then write
their decision into \`merged/\`. For \`identity.md\`, synthesise rather than concatenate.

## Finishing

- Only edit inside \`${input.stagingPath}/merged\`. Never touch the live anima, \`local/\` or
  \`incoming/\`. \`merged/\` must stay a complete anima tree.
- When every conflict is resolved, write an empty file \`merged/DONE\`. If the merge is impossible,
  write \`merged/FAILED\` with the reason instead.
- Reply with a short summary of each decision. The user applies the result from the anima's Sync
  tab; the live files are backed up first, and the other machine catches up on its next sync.
`;
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const animas = yield* AnimaService.AnimaService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const managedFolders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;

  const failed = (operation: string) => (cause: unknown) => new AnimaError({ operation, cause });
  const rejected = (operation: string, reason: string) =>
    new AnimaCommandRejectedError({ operation, reason: reason.slice(0, 300) });

  const mergeRoot = Effect.map(animas.rootPath, (root) => path.join(root, MERGE_DIR));

  const stagingFor = Effect.fn("AnimaMergeService.stagingFor")(function* (mergeId: string) {
    if (!MERGE_ID_PATTERN.test(mergeId))
      return yield* new AnimaNotFoundError({ name: mergeId.slice(0, 64) });
    const dir = path.join(yield* mergeRoot, mergeId);
    if (!(yield* fs.exists(path.join(dir, META_FILE)).pipe(Effect.orElseSucceed(() => false))))
      return yield* new AnimaNotFoundError({ name: mergeId });
    return dir;
  });

  const readMeta = (dir: string) =>
    fs
      .readFileString(path.join(dir, META_FILE))
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MergeMetaJson)),
        Effect.mapError(failed("mergeStatus")),
      );

  const writeFiles = Effect.fn("AnimaMergeService.writeFiles")(function* (
    target: string,
    files: ReadonlyArray<AnimaBundleFile>,
  ) {
    yield* fs.makeDirectory(target, { recursive: true });
    for (const file of files) {
      const destination = path.join(target, ...file.path.split("/"));
      yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
      yield* fs.writeFileString(destination, file.content);
    }
  });

  const start: AnimaMergeService["Service"]["start"] = Effect.fn("AnimaMergeService.start")(
    function* (input: AnimaMergeStartInput) {
      const { bundle } = input;
      if (bundle.files.some((file) => !AnimaFiles.isBundlePath(file.path)))
        return yield* rejected("mergeStart", "The bundle contains a file that is not allowed.");
      const local: AnimaBundle = yield* animas.export(bundle.name).pipe(
        Effect.catchTags({
          AnimaNotFoundError: () =>
            Effect.fail(
              rejected("mergeStart", "There is no local anima to merge into; import it."),
            ),
        }),
      );
      const incomingId = AnimaFiles.parseAgentFile(
        bundle.files.find((file) => file.path === "agent.anima")?.content ?? "",
      ).id;
      if (incomingId !== local.id)
        return yield* rejected("mergeStart", "The bundle is a different anima with the same name.");
      const projectId =
        input.projectId ??
        (yield* managedFolders.ensureScratchProject.pipe(
          Effect.mapError((error) => rejected("mergeStart", error.message)),
        )).projectId;
      const project = yield* projects.get(projectId).pipe(Effect.mapError(failed("mergeStart")));
      if (Option.isNone(project))
        return yield* rejected("mergeStart", "The project was not found.");
      const settings = resolveProjectSettings(
        yield* serverSettings.getSettings.pipe(Effect.mapError(failed("mergeStart"))),
        projectId,
        project.value,
      ).settings;
      const modelSelection =
        project.value.defaultModelSelection ??
        resolveNewThreadModelSelection({
          defaultSelection: settings.defaultModelSelection,
          fallbackSelection: settings.fallbackModelSelection,
          providers: yield* providerRegistry.getProviders,
          settings,
          projectId,
          now: yield* Clock.currentTimeMillis,
        }).selection;
      if (modelSelection === null)
        return yield* rejected("mergeStart", "No model is set up to run the merge.");

      const comparison = yield* animas.compare(bundle);
      const draft = AnimaMerge.mergeAnimaFiles({
        local: local.files,
        incoming: bundle.files,
        base: yield* animas.syncBase(bundle.name),
      });
      const nowMs = yield* Clock.currentTimeMillis;
      const slug = DateTime.formatIso(DateTime.makeUnsafe(nowMs))
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
      const mergeId = `${bundle.name}-${slug}-${local.digest.slice(0, 6)}${bundle.digest.slice(0, 6)}`;
      const staging = path.join(yield* mergeRoot, mergeId);
      const meta: MergeMeta = {
        mergeId,
        name: bundle.name,
        animaId: local.id,
        projectId,
        threadId: ThreadId.make(`anima-merge:${mergeId}`),
        createdAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
      };
      yield* Effect.gen(function* () {
        yield* writeFiles(path.join(staging, "local"), local.files);
        yield* writeFiles(path.join(staging, "incoming"), bundle.files);
        yield* fs.writeFileString(
          path.join(staging, INCOMING_FILE),
          yield* encodeIncoming(bundle.files),
        );
        yield* writeFiles(path.join(staging, "merged"), draft.files);
        yield* fs.writeFileString(
          path.join(staging, INSTRUCTIONS_FILE),
          renderMergeInstructions({
            name: bundle.name,
            mergeId,
            stagingPath: staging,
            localOnlyBreaths: comparison.localOnlyBreaths,
            incomingOnlyBreaths: comparison.incomingOnlyBreaths,
            conflicts: draft.conflicts,
          }),
        );
        yield* fs.writeFileString(path.join(staging, META_FILE), yield* encodeMergeMeta(meta));
      }).pipe(Effect.mapError(failed("mergeStart")));

      const commandId = CommandId.make(`anima-merge:${mergeId}`);
      yield* launches
        .launch({
          commandId,
          threadId: meta.threadId,
          projectId,
          title: `Merge anima ${bundle.name}`,
          modelSelection,
          // The agent writes under ~/.claude/anima, outside the project workspace.
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: {
            messageId: MessageId.make(`anima-merge-message:${mergeId}`),
            text: `Merge the anima '${bundle.name}'. Read ${path.join(staging, INSTRUCTIONS_FILE)} and follow it exactly: resolve each conflict with me through your question tool, write the result to ${path.join(staging, "merged")}, and finish by creating merged/DONE.`,
            attachments: [],
          },
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(
          Effect.mapError((error) => {
            const cause =
              "cause" in error && error.cause instanceof Error ? error.cause.message : "";
            return rejected(
              "mergeStart",
              `Could not start the merge thread: ${cause || error.message}`,
            );
          }),
        );
      return { mergeId, threadId: meta.threadId, stagingPath: staging };
    },
  );

  const status: AnimaMergeService["Service"]["status"] = Effect.fn("AnimaMergeService.status")(
    function* (input: typeof AnimaMergeStatusInput.Type) {
      const dir = yield* stagingFor(input.mergeId);
      const meta = yield* readMeta(dir);
      const read = (file: string) =>
        fs
          .readFileString(path.join(dir, file))
          .pipe(Effect.asSome, Effect.orElseSucceed(Option.none<string>));
      const base = { mergeId: meta.mergeId, name: meta.name, threadId: meta.threadId };
      const applied = yield* read(APPLIED_FILE);
      if (Option.isSome(applied))
        return { ...base, state: "applied" as const, note: applied.value.trim() || null };
      const failure = yield* read(path.join("merged", FAILED_FILE));
      if (Option.isSome(failure))
        return {
          ...base,
          state: "failed" as const,
          note: failure.value.trim().slice(0, 500) || null,
        };
      const done = yield* fs
        .exists(path.join(dir, "merged", DONE_FILE))
        .pipe(Effect.orElseSucceed(() => false));
      return { ...base, state: done ? ("ready" as const) : ("running" as const), note: null };
    },
  );

  /** Reads `merged/` refusing symlinks and anything that resolves outside it. */
  const readMerged = Effect.fn("AnimaMergeService.readMerged")(function* (mergedDir: string) {
    const realRoot = yield* fs.realPath(mergedDir).pipe(Effect.mapError(failed("mergeApply")));
    const entries = yield* fs
      .readDirectory(mergedDir, { recursive: true })
      .pipe(Effect.mapError(failed("mergeApply")));
    const files: Array<AnimaBundleFile> = [];
    for (const entry of entries.toSorted()) {
      const relative = entry.split(path.sep).join("/");
      const absolute = path.join(mergedDir, entry);
      const info = yield* fs.stat(absolute).pipe(Effect.mapError(failed("mergeApply")));
      if (info.type === "Directory") continue;
      if (relative === DONE_FILE) continue;
      if (!AnimaFiles.isBundlePath(relative))
        return yield* rejected(
          "mergeApply",
          `merged/ contains a file that is not allowed: ${relative}`,
        );
      const real = yield* fs.realPath(absolute).pipe(Effect.mapError(failed("mergeApply")));
      if (info.type !== "File" || !real.startsWith(realRoot + path.sep))
        return yield* rejected("mergeApply", `merged/ contains an unsafe entry: ${relative}`);
      files.push({
        path: relative,
        content: yield* fs.readFileString(absolute).pipe(Effect.mapError(failed("mergeApply"))),
      });
    }
    return files;
  });

  const apply: AnimaMergeService["Service"]["apply"] = Effect.fn("AnimaMergeService.apply")(
    function* (input: typeof AnimaMergeApplyInput.Type) {
      const current = yield* status({ mergeId: input.mergeId });
      if (current.state !== "ready")
        return yield* rejected("mergeApply", `The merge is not ready (${current.state}).`);
      const dir = yield* stagingFor(input.mergeId);
      const meta = yield* readMeta(dir);
      const files = yield* readMerged(path.join(dir, "merged"));
      const result = yield* animas.install({ name: meta.name, files, expectedId: meta.animaId });
      // The merge already holds every change the other machine had at its start, so that copy is
      // the base: a later sync then reads the decisions here as this machine's changes.
      const incoming = yield* fs.readFileString(path.join(dir, INCOMING_FILE)).pipe(
        Effect.flatMap(decodeIncoming),
        Effect.orElseSucceed(() => files),
      );
      yield* animas.recordSyncBase(meta.name, incoming);
      const nowMs = yield* Clock.currentTimeMillis;
      yield* fs
        .writeFileString(
          path.join(dir, APPLIED_FILE),
          `Applied ${DateTime.formatIso(DateTime.makeUnsafe(nowMs))}\n`,
        )
        .pipe(Effect.mapError(failed("mergeApply")));
      return result;
    },
  );

  return AnimaMergeService.of({ start, status, apply });
});

export const layer = Layer.effect(AnimaMergeService, make);
