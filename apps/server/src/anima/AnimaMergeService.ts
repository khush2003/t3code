import {
  AnimaCommandRejectedError,
  AnimaError,
  AnimaName,
  AnimaNotFoundError,
  type AnimaBundle,
  type AnimaBundleFile,
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

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as AnimaFiles from "./AnimaFiles.ts";
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

function renderMergeInstructions(input: {
  readonly name: string;
  readonly mergeId: string;
  readonly stagingPath: string;
  readonly relation: string;
  readonly commonBreath: number;
  readonly localOnlyBreaths: number;
  readonly incomingOnlyBreaths: number;
  readonly changedFiles: ReadonlyArray<string>;
}): string {
  const changed =
    input.changedFiles.length === 0
      ? "(none)"
      : input.changedFiles
          .slice(0, 60)
          .map((file) => `- ${file}`)
          .join("\n");
  return `# Merge anima '${input.name}' (${input.mergeId})

Two copies of the anima \`${input.name}\` have diverged: one on this machine (\`local/\`) and one
imported from another machine (\`incoming/\`). Produce one merged anima in \`merged/\`.

Staging directory: \`${input.stagingPath}\`

\`\`\`
local/     current files on this machine (read only)
incoming/  files from the other machine (read only)
merged/    your output; starts empty
\`\`\`

Relation: ${input.relation}. Last shared breath: ${input.commonBreath < 0 ? "none" : input.commonBreath}.
Local-only breaths: ${input.localOnlyBreaths}. Incoming-only breaths: ${input.incomingOnlyBreaths}.

Files that differ:
${changed}

## File semantics

- \`agent.anima\`: header lines \`# key: value\` followed by one row per breath
  (\`n|ts|hsl|note|shape|graph|aim|project\`). The first header line after \`# anima v1\` is
  \`# id:<id> name:<name> born:<date> breaths:<N> accent:<color>\`. Keep \`id\`, \`name\`, \`born\` and
  \`accent\` from local. \`breaths:\` is the index of the last breath, so recompute it.
- \`breaths/NNN.breath\`: one file per breath, with \`# breath:N ts:... parent:N-1 hash:...\`,
  \`# files:\`, \`# decisions:\` (space separated) and \`# open:\` lines.
- \`identity.md\`: the anima's voice and values. \`policy.md\`: \`## Operational\` rules (one per line),
  \`## Pending\`, and a \`## Audit\` log of \`rev|date|who|text\`.
- \`constitution.json\` and \`skills/**/*.md\` are optional.

## How to merge

1. **Breaths.** Both lineages share breaths up to the common breath. Keep those as they are.
   Union the breaths after it (local-only and incoming-only) ordered by timestamp, and renumber
   them consecutively from the common breath + 1. Keep every lineage's \`decisions\` and \`open\`
   items. Rewrite each breath file's \`# breath:\` and \`parent:\` to the new numbers (the \`hash:\`
   may be kept) and renumber the matching rows in \`agent.anima\`. Do not drop breaths.
2. **identity.md.** Synthesise one document that preserves what is distinctive in both. Do not
   concatenate; resolve contradictions in favour of the more recent breath.
3. **policy.md.** Union the operational rules and drop exact or near-duplicates. Keep at most 40
   operational rules (the CLI cap); move the surplus to \`## Pending\`. Merge the audit logs,
   bump \`# rev:\` above both sides, and add an audit line saying the policies were merged.
4. **Traits.** \`# self:\` and \`# skills:\` are \`trait=mean±sigma\` estimates. For each trait present
   on both sides keep the estimate with the lower sigma (higher precision); on a tie keep the one
   from the longer history. Traits on one side only are kept as they are.
5. **Other header lines.** Take memo, vow and aim from the side with the most recent breath.
   Union list-like values (\`projects\`, \`kin\`, \`tension\`) without duplicates.
6. **Header.** Recompute \`breaths:\` so it equals the last breath index, and make sure the last
   row in \`agent.anima\` has that same index.
7. Copy any other file (constitution, skills) from whichever side has it; prefer the newer one.

## Finishing

- \`merged/\` must be a complete anima tree on its own: \`agent.anima\`, \`identity.md\`,
  \`policy.md\` and every \`breaths/NNN.breath\`.
- Only write inside \`${input.stagingPath}/merged\`. Never touch the live anima, \`local/\` or \`incoming/\`.
- When the tree is complete, write an empty file \`merged/DONE\`. If the merge is impossible, write
  \`merged/FAILED\` with the reason instead.
- Reply with a short summary of how you resolved the conflicts. A person reviews it and applies the
  merge; the live files are backed up first.
`;
}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const animas = yield* AnimaService.AnimaService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const projects = yield* ProjectStore.ProjectStoreV2;

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
      const project = yield* projects
        .get(input.projectId)
        .pipe(Effect.mapError(failed("mergeStart")));
      if (Option.isNone(project))
        return yield* rejected("mergeStart", "The project was not found.");
      const modelSelection = project.value.defaultModelSelection;
      if (modelSelection === null)
        return yield* rejected("mergeStart", "The project has no default model to run the merge.");

      const comparison = yield* animas.compare(bundle);
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
        projectId: input.projectId,
        threadId: ThreadId.make(`anima-merge:${mergeId}`),
        createdAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
      };
      yield* Effect.gen(function* () {
        yield* writeFiles(path.join(staging, "local"), local.files);
        yield* writeFiles(path.join(staging, "incoming"), bundle.files);
        yield* fs.makeDirectory(path.join(staging, "merged"), { recursive: true });
        yield* fs.writeFileString(
          path.join(staging, INSTRUCTIONS_FILE),
          renderMergeInstructions({
            name: bundle.name,
            mergeId,
            stagingPath: staging,
            relation: comparison.relation,
            commonBreath: comparison.commonBreath,
            localOnlyBreaths: comparison.localOnlyBreaths,
            incomingOnlyBreaths: comparison.incomingOnlyBreaths,
            changedFiles: comparison.changedFiles,
          }),
        );
        yield* fs.writeFileString(path.join(staging, META_FILE), yield* encodeMergeMeta(meta));
      }).pipe(Effect.mapError(failed("mergeStart")));

      const commandId = CommandId.make(`anima-merge:${mergeId}`);
      yield* launches
        .launch({
          commandId,
          threadId: meta.threadId,
          projectId: input.projectId,
          title: `Merge anima ${bundle.name}`,
          modelSelection,
          // The agent writes under ~/.claude/anima, outside the project workspace.
          runtimeMode: "full-access",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: {
            messageId: MessageId.make(`anima-merge-message:${mergeId}`),
            text: `Merge the anima '${bundle.name}'. Read ${path.join(staging, INSTRUCTIONS_FILE)} and follow it exactly; write the result to ${path.join(staging, "merged")} and finish by creating merged/DONE.`,
            attachments: [],
          },
          createdBy: "system",
          creationSource: "server",
        })
        .pipe(Effect.mapError(failed("mergeStart")));
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
