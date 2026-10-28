import {
  AnimaCommandRejectedError,
  AnimaError,
  AnimaName,
  AnimaNotFoundError,
  AnimaSetEnabledInput,
  ANIMA_BUNDLE_VERSION,
  type AnimaAttachInput,
  type AnimaBundle,
  type AnimaBundleFile,
  type AnimaCompareResult,
  type AnimaCreateInput,
  type AnimaDetail,
  type AnimaGetInput,
  type AnimaImportInput,
  type AnimaListResult,
  type AnimaMutationResult,
  type AnimaPolicyInput,
  type AnimaSummary,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
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
import * as ProcessRunner from "../processRunner.ts";
import * as AnimaFiles from "./AnimaFiles.ts";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_WAKE_BYTES = 256 * 1024;
const MAX_VOICE_BYTES = 16 * 1024;
/** Stand-in caller for the very first anima: the CLI cannot `init` without an architect to act as. */
const BOOTSTRAP_CALLER = "bootstrap-caller";
const DEFAULT_BREATH_LIMIT = 100;
const CLI_TIMEOUT = "60 seconds";
const SUMMARY_CONCURRENCY = 8;
/** Files the CLI keeps across a replace: they describe the live session, not the identity. */
const PRESERVED_ON_REPLACE = ["session", "inbox"] as const;
/** Header keys that already have a dedicated field in AnimaDetail. */
const DEDICATED_HEADER_KEYS = new Set([
  "id",
  "role",
  "projects",
  "self",
  "skills",
  "memo",
  "vow",
  "parent",
  "active",
  "hue",
  "schema",
  "user",
]);

type AnimaFailure = AnimaError | AnimaCommandRejectedError | AnimaNotFoundError;

export interface AnimaWakeInput {
  readonly name: string;
  /** The thread workspace; the CLI records it as the session cwd. */
  readonly cwd: string;
}

export interface AnimaInstallInput {
  readonly name: string;
  readonly files: ReadonlyArray<AnimaBundleFile>;
  /** When set, the files must belong to the anima with this id. */
  readonly expectedId?: string | undefined;
}

export class AnimaService extends Context.Service<
  AnimaService,
  {
    readonly list: Effect.Effect<AnimaListResult, AnimaError>;
    readonly get: (input: AnimaGetInput) => Effect.Effect<AnimaDetail, AnimaFailure>;
    readonly create: (input: AnimaCreateInput) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    readonly attach: (input: AnimaAttachInput) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    readonly setEnabled: (
      input: typeof AnimaSetEnabledInput.Type,
    ) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    readonly policy: (input: AnimaPolicyInput) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    /** The wake payload without clocking in or consuming the inbox. */
    readonly wakePreview: (name: string) => Effect.Effect<string, AnimaFailure>;
    /** Runs a real wake (clock-in, inbox consumption); never cached. */
    readonly wake: (
      input: AnimaWakeInput,
    ) => Effect.Effect<string, AnimaError | AnimaNotFoundError>;
    readonly export: (name: string) => Effect.Effect<AnimaBundle, AnimaFailure>;
    readonly compare: (bundle: AnimaBundle) => Effect.Effect<AnimaCompareResult, AnimaFailure>;
    readonly import: (input: AnimaImportInput) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    readonly summary: (name: string) => Effect.Effect<AnimaSummary, AnimaFailure>;
    readonly rootPath: Effect.Effect<string>;
    readonly cliAvailable: Effect.Effect<boolean>;
    /** The anima's generated output-style text (frontmatter stripped), or "" when absent. */
    readonly voice: (name: string) => Effect.Effect<string>;
    /** Compact identity refresh built from files only: no wake, no clock-in, no inbox. */
    readonly capsule: (name: string) => Effect.Effect<string>;
    /** Validates the tree, moves the current anima into `.backups/`, and installs the files. */
    readonly install: (
      input: AnimaInstallInput,
    ) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
  }
>()("t3/anima/AnimaService") {}

const isAnimaName = Schema.is(AnimaName);

const stripTerminalControls = (text: string) =>
  // oxlint-disable-next-line no-control-regex -- the CLI emits OSC title sequences on stderr.
  text.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

const firstLine = (text: string) =>
  stripTerminalControls(text)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "";

const timestampSlug = (ms: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(ms))
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");

const byteLength = (files: ReadonlyArray<AnimaBundleFile>) =>
  files.reduce((total, file) => total + Buffer.byteLength(file.content), 0);

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const home = yield* HostProcess.HomeDirectory;

  const root = path.join(home, ".claude", "anima");
  const cliPath = path.join(home, ".claude", "skills", "anima", "anima.ts");

  const failed = (operation: string) => (cause: unknown) => new AnimaError({ operation, cause });
  const rejected = (operation: string, reason: string) =>
    new AnimaCommandRejectedError({ operation, reason: reason.slice(0, 300) });

  const dirOf = (name: string): Effect.Effect<string, AnimaNotFoundError> =>
    isAnimaName(name)
      ? Effect.succeed(path.join(root, name))
      : Effect.fail(new AnimaNotFoundError({ name: String(name).slice(0, 64) }));

  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));

  const requireAnima = Effect.fn("AnimaService.requireAnima")(function* (name: string) {
    const dir = yield* dirOf(name);
    if (!(yield* exists(path.join(dir, "agent.anima"))))
      return yield* new AnimaNotFoundError({ name });
    return dir;
  });

  const readOptional = (target: string) =>
    fs.readFileString(target).pipe(Effect.orElseSucceed(() => ""));

  const cliAvailable = exists(cliPath);

  interface CliResult {
    readonly stdout: string;
    readonly stderr: string;
  }

  /**
   * The CLI reports many refusals by printing to stderr and exiting 0, so a clean exit with
   * only stderr output is still a rejection.
   */
  const runCli = Effect.fn("AnimaService.runCli")(function* (
    operation: string,
    args: ReadonlyArray<string>,
    options?: { readonly cwd?: string; readonly maxOutputBytes?: number },
  ) {
    if (!(yield* cliAvailable))
      return yield* rejected(operation, "The anima CLI is not installed on this environment.");
    const result = yield* runner
      .run({
        command: "bun",
        args: [cliPath, ...args],
        spawnCwd: options?.cwd ?? root,
        env: { HOME: home },
        timeout: CLI_TIMEOUT,
        maxOutputBytes: options?.maxOutputBytes ?? 1024 * 1024,
        outputMode: "truncate",
        truncatedMarker: "\n[output truncated]",
      })
      .pipe(Effect.mapError(failed(operation)));
    const stdout = result.stdout.trim();
    const stderr = stripTerminalControls(result.stderr).trim();
    if (result.timedOut) return yield* rejected(operation, "The anima CLI timed out.");
    if (result.code !== 0) {
      return yield* rejected(
        operation,
        firstLine(stderr) || firstLine(stdout) || "The anima CLI failed.",
      );
    }
    if (stdout === "" && stderr !== "") return yield* rejected(operation, firstLine(stderr));
    return { stdout, stderr } satisfies CliResult;
  });

  /** Architect-only commands (`birth`, `activate`, ...) need the architect as caller. */
  const findArchitect = Effect.fn("AnimaService.findArchitect")(function* () {
    const names = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed((): string[] => []));
    for (const name of names) {
      if (name.startsWith(".") || !isAnimaName(name)) continue;
      const header = yield* readOptional(path.join(root, name, "agent.anima"));
      if (/^# role: (architect|steward)\b/m.test(header)) return Option.some(name);
    }
    return Option.none<string>();
  });

  const callerFor = (fallback: string) =>
    findArchitect().pipe(Effect.map(Option.getOrElse(() => fallback)));

  const requireArchitect = (operation: string) =>
    findArchitect().pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              rejected(operation, "No architect anima exists; only an architect can do this."),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );

  const collectFiles = Effect.fn("AnimaService.collectFiles")(function* (
    dir: string,
    options: { readonly includeSkills: boolean },
  ) {
    const entries = yield* fs.readDirectory(dir, { recursive: true });
    const files: Array<AnimaBundleFile> = [];
    let total = 0;
    for (const entry of entries.toSorted()) {
      const relative = entry.split(path.sep).join("/");
      if (!AnimaFiles.isBundlePath(relative)) continue;
      if (!options.includeSkills && relative.startsWith("skills/")) continue;
      const absolute = path.join(dir, entry);
      const info = yield* fs.stat(absolute);
      if (info.type !== "File" || Number(info.size) > MAX_FILE_BYTES) continue;
      const content = yield* fs.readFileString(absolute);
      if (content.includes("\0")) continue;
      total += Buffer.byteLength(content);
      if (total > MAX_BUNDLE_BYTES) break;
      files.push({ path: relative, content });
    }
    return files;
  });

  const summarize = Effect.fn("AnimaService.summarize")(function* (name: string) {
    const dir = yield* requireAnima(name);
    const nowMs = yield* Clock.currentTimeMillis;
    const files = yield* collectFiles(dir, { includeSkills: false }).pipe(
      Effect.mapError(failed("summary")),
    );
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const [inbox, session] = yield* Effect.all([
      readOptional(path.join(dir, "inbox")),
      readOptional(path.join(dir, "session")),
    ]);
    return {
      summary: AnimaFiles.buildSummary({
        name,
        agent: AnimaFiles.parseAgentFile(byPath.get("agent.anima") ?? ""),
        identity: byPath.get("identity.md") ?? "",
        policy: AnimaFiles.parsePolicy(byPath.get("policy.md") ?? ""),
        inbox: AnimaFiles.parseInbox(inbox),
        session: AnimaFiles.parseSession(session, nowMs),
        digest: AnimaFiles.digestFiles(files),
      }),
      files,
      dir,
    };
  });

  const summary: AnimaService["Service"]["summary"] = (name) =>
    summarize(name).pipe(Effect.map((result) => result.summary));

  const list: AnimaService["Service"]["list"] = Effect.gen(function* () {
    const names = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed((): string[] => []));
    const animas = yield* Effect.forEach(
      names.toSorted(),
      (name) =>
        summary(name).pipe(
          // A half-written or foreign directory must not hide the others.
          Effect.asSome,
          Effect.orElseSucceed(Option.none<AnimaSummary>),
        ),
      { concurrency: SUMMARY_CONCURRENCY },
    );
    return {
      animas: animas.flatMap((entry) => (Option.isSome(entry) ? [entry.value] : [])),
      cliAvailable: yield* cliAvailable,
      rootPath: root,
    };
  });

  const mutationResult = (name: string, output: string) =>
    summary(name).pipe(
      Effect.map((value): AnimaMutationResult => ({ output, summary: value })),
      Effect.orElseSucceed((): AnimaMutationResult => ({ output, summary: null })),
    );

  const get: AnimaService["Service"]["get"] = Effect.fn("AnimaService.get")(function* (input) {
    const { summary: current, files, dir } = yield* summarize(input.name);
    const byPath = new Map(files.map((file) => [file.path, file.content]));
    const agent = AnimaFiles.parseAgentFile(byPath.get("agent.anima") ?? "");
    const policy = AnimaFiles.parsePolicy(byPath.get("policy.md") ?? "");
    const limit = input.breathLimit ?? DEFAULT_BREATH_LIMIT;
    const rows = limit === 0 ? agent.rows : agent.rows.slice(-limit);
    const wanted = new Set(rows.map((row) => row.index));
    const details = [...byPath.entries()].flatMap(([filePath, content]) => {
      const match = /^breaths\/([^/]+\.breath)$/.exec(filePath);
      const parsed = match === null ? null : AnimaFiles.parseBreathFile(content, match[1]!);
      return parsed !== null && wanted.has(parsed.index) ? [parsed] : [];
    });
    const [inboxRaw, opensOutput] = yield* Effect.all([
      readOptional(path.join(dir, "inbox")),
      runCli("opens", ["opens", "list", "--agent", input.name]).pipe(
        Effect.map((result) => result.stdout),
        Effect.orElseSucceed(() => ""),
      ),
    ]);
    return {
      summary: current,
      identity: byPath.get("identity.md") ?? "",
      header: agent.header.filter((entry) => !DEDICATED_HEADER_KEYS.has(entry.key)),
      traits: agent.traits,
      skills: agent.skills,
      policy: { ...policy, cap: AnimaFiles.ANIMA_POLICY_CAP },
      breaths: AnimaFiles.mergeBreaths(rows, details),
      inbox: AnimaFiles.parseInbox(inboxRaw),
      opens: AnimaFiles.parseOpensListOutput(opensOutput),
      // Clients resolve threads from the shell snapshot's `animaName`.
      threadIds: [],
    };
  });

  const listAnimaNames = fs.readDirectory(root).pipe(
    Effect.orElseSucceed((): string[] => []),
    Effect.flatMap((names) =>
      Effect.filter(names.toSorted(), (name) =>
        name.startsWith(".") || !isAnimaName(name)
          ? Effect.succeed(false)
          : exists(path.join(root, name, "agent.anima")),
      ),
    ),
  );

  /** The CLI exits when no agent exists to act as, so the first anima runs `init` as a throwaway architect. */
  const bootstrapFirst = Effect.fn("AnimaService.bootstrapFirst")(function* (name: string) {
    const stubDir = path.join(root, BOOTSTRAP_CALLER);
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(stubDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(stubDir, "agent.anima"),
        "# anima v1\n# id:bootstrap breaths:0\n# role: architect\n",
      );
    }).pipe(Effect.mapError(failed("create")));
    return yield* runCli("create", [
      "init",
      "--name",
      name,
      "--role",
      "architect",
      "--as",
      BOOTSTRAP_CALLER,
    ]).pipe(
      Effect.ensuring(fs.remove(stubDir, { recursive: true, force: true }).pipe(Effect.ignore)),
    );
  });

  const create: AnimaService["Service"]["create"] = Effect.fn("AnimaService.create")(
    function* (input) {
      if (!(yield* cliAvailable))
        return yield* rejected("create", "The anima CLI is not installed on this environment.");
      if (yield* exists(path.join(root, input.name, "agent.anima")))
        return yield* rejected("create", `An anima named '${input.name}' already exists.`);
      if (
        input.parent !== undefined &&
        !(yield* exists(path.join(root, input.parent, "agent.anima")))
      )
        return yield* rejected("create", `The parent anima '${input.parent}' does not exist.`);
      const architect = yield* findArchitect();
      if (Option.isNone(architect)) {
        if ((yield* listAnimaNames).length > 0)
          return yield* rejected(
            "create",
            "No architect anima exists, and only an architect can create animas. Set '# role: architect' in one anima's agent.anima header, then try again.",
          );
        if (input.parent !== undefined || input.fromProjectPath !== undefined)
          return yield* rejected(
            "create",
            "This is the first anima, so it cannot have a parent or come from a project. Create it by name first.",
          );
        const result = yield* bootstrapFirst(input.name);
        return yield* mutationResult(
          input.name,
          `${result.stdout}\n${input.name} is the first anima, so it was created as the architect.`,
        );
      }
      const caller = architect.value;
      const args =
        input.parent !== undefined || input.fromProjectPath !== undefined
          ? [
              "birth",
              "--name",
              input.name,
              ...(input.parent === undefined ? [] : ["--parent", input.parent]),
              ...(input.fromProjectPath === undefined
                ? []
                : ["--from-project", input.fromProjectPath]),
              "--as",
              caller,
            ]
          : ["init", "--name", input.name, "--role", input.role ?? "agent", "--as", caller];
      const result = yield* runCli("create", args);
      return yield* mutationResult(input.name, result.stdout);
    },
  );

  const attach: AnimaService["Service"]["attach"] = Effect.fn("AnimaService.attach")(
    function* (input) {
      yield* requireAnima(input.name);
      const project = yield* projects.get(input.projectId).pipe(Effect.mapError(failed("attach")));
      if (Option.isNone(project)) return yield* rejected("attach", "The project was not found.");
      const result = yield* runCli("attach", [
        "setup",
        "--agent",
        input.name,
        "--project",
        project.value.workspaceRoot,
      ]);
      return yield* mutationResult(input.name, result.stdout);
    },
  );

  const setEnabled: AnimaService["Service"]["setEnabled"] = Effect.fn("AnimaService.setEnabled")(
    function* (input) {
      yield* requireAnima(input.name);
      const caller = yield* requireArchitect("setEnabled");
      const result = yield* runCli("setEnabled", [
        input.enabled ? "activate" : "deactivate",
        input.name,
        "--as",
        caller,
      ]);
      return yield* mutationResult(input.name, result.stdout);
    },
  );

  const policyArgs = (input: AnimaPolicyInput): ReadonlyArray<string> => {
    const { action } = input;
    switch (action.type) {
      case "add":
        return ["--add", action.rule, ...(action.direct ? ["--auto"] : [])];
      case "update":
        return ["--update", String(action.index), "--add", action.rule];
      case "remove":
        return ["--remove", String(action.index)];
      case "apply":
        return ["--apply"];
    }
  };

  const policy: AnimaService["Service"]["policy"] = Effect.fn("AnimaService.policy")(
    function* (input) {
      yield* requireAnima(input.name);
      const caller = yield* callerFor(input.name);
      const result = yield* runCli("policy", [
        "policy",
        "--agent",
        input.name,
        "--as",
        caller,
        ...policyArgs(input),
      ]);
      return yield* mutationResult(input.name, result.stdout);
    },
  );

  const wakeWith = Effect.fn("AnimaService.wakeWith")(function* (
    operation: string,
    name: string,
    cwd: string,
    peek: boolean,
  ) {
    yield* requireAnima(name);
    const result = yield* runCli(
      operation,
      ["read", "--wake", "--agent", name, ...(peek ? ["--peek"] : [])],
      { cwd, maxOutputBytes: MAX_WAKE_BYTES },
    );
    return result.stdout;
  });

  const wakePreview: AnimaService["Service"]["wakePreview"] = (name) =>
    wakeWith("wakePreview", name, root, true);

  const wake: AnimaService["Service"]["wake"] = (input) =>
    wakeWith("wake", input.name, input.cwd, false).pipe(
      // Wake feeds a prompt: a CLI refusal degrades to an operational failure of the caller.
      Effect.catchTags({
        AnimaCommandRejectedError: (error) =>
          Effect.fail(new AnimaError({ operation: "wake", cause: error })),
      }),
    );

  const voice: AnimaService["Service"]["voice"] = (name) =>
    isAnimaName(name)
      ? readOptional(path.join(home, ".claude", "output-styles", `${name}.md`)).pipe(
          Effect.map((content) => AnimaFiles.stripFrontmatter(content.slice(0, MAX_VOICE_BYTES))),
        )
      : Effect.succeed("");

  const capsule: AnimaService["Service"]["capsule"] = Effect.fn("AnimaService.capsule")(
    function* (name) {
      const dir = yield* requireAnima(name).pipe(Effect.orElseSucceed(() => ""));
      if (dir === "") return "";
      const [agent, identity] = yield* Effect.all([
        readOptional(path.join(dir, "agent.anima")),
        readOptional(path.join(dir, "identity.md")),
      ]);
      return AnimaFiles.buildIdentityCapsule(name, agent, identity);
    },
  );

  const comparable = (
    id: string,
    files: ReadonlyArray<AnimaBundleFile>,
  ): AnimaFiles.ComparableAnima => ({
    id,
    digest: AnimaFiles.digestFiles(files),
    chain: AnimaFiles.breathChain(files),
    files,
  });

  const idOf = (files: ReadonlyArray<AnimaBundleFile>) =>
    AnimaFiles.parseAgentFile(files.find((file) => file.path === "agent.anima")?.content ?? "").id;

  const exportBundle: AnimaService["Service"]["export"] = Effect.fn("AnimaService.export")(
    function* (name) {
      const dir = yield* requireAnima(name);
      const files = yield* collectFiles(dir, { includeSkills: true }).pipe(
        Effect.mapError(failed("export")),
      );
      const nowMs = yield* Clock.currentTimeMillis;
      return {
        version: ANIMA_BUNDLE_VERSION,
        name,
        id: idOf(files),
        digest: AnimaFiles.digestFiles(files),
        exportedAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
        breathChain: AnimaFiles.breathChain(files),
        files,
      } satisfies AnimaBundle;
    },
  );

  const assertBundleSafe = (operation: string, bundle: AnimaBundle) => {
    const bad = bundle.files.find((file) => !AnimaFiles.isBundlePath(file.path));
    if (bad !== undefined)
      return Effect.fail(rejected(operation, "The bundle contains a file that is not allowed."));
    if (byteLength(bundle.files) > MAX_BUNDLE_BYTES)
      return Effect.fail(rejected(operation, "The bundle is too large."));
    return Effect.void;
  };

  const localComparable = (name: string) =>
    exportBundle(name).pipe(
      Effect.map((bundle) => Option.some(comparable(bundle.id, bundle.files))),
      Effect.catchTags({ AnimaNotFoundError: () => Effect.succeedNone }),
    );

  const compare: AnimaService["Service"]["compare"] = Effect.fn("AnimaService.compare")(
    function* (bundle) {
      yield* assertBundleSafe("compare", bundle);
      yield* dirOf(bundle.name);
      const local = yield* localComparable(bundle.name);
      // Recomputed rather than trusted: the digest and chain on the wire are advisory.
      const incoming = comparable(idOf(bundle.files), bundle.files);
      const result = AnimaFiles.compareAnimas(Option.getOrNull(local), incoming);
      const localSummary = Option.isSome(local)
        ? yield* summary(bundle.name).pipe(Effect.asSome)
        : Option.none<AnimaSummary>();
      return { ...result, local: Option.getOrNull(localSummary) };
    },
  );

  const writeTree = Effect.fn("AnimaService.writeTree")(function* (
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

  const install: AnimaService["Service"]["install"] = Effect.fn("AnimaService.install")(
    function* (input) {
      const operation = "install";
      const dir = yield* dirOf(input.name);
      const problem = AnimaFiles.validateAnimaTree(input.files, {
        name: input.name,
        id: input.expectedId,
      });
      if (problem !== null) return yield* rejected(operation, problem);
      const nowMs = yield* Clock.currentTimeMillis;
      const slug = timestampSlug(nowMs);
      const staging = path.join(root, `.staging-${input.name}-${slug}`);
      const present = yield* exists(dir);
      yield* Effect.gen(function* () {
        yield* writeTree(staging, input.files);
        if (!present) return yield* fs.rename(staging, dir);
        for (const keep of PRESERVED_ON_REPLACE) {
          const source = path.join(dir, keep);
          if (yield* exists(source)) yield* fs.copyFile(source, path.join(staging, keep));
        }
        const backups = path.join(root, ".backups");
        yield* fs.makeDirectory(backups, { recursive: true });
        yield* fs.rename(dir, path.join(backups, `${input.name}-${slug}`));
        yield* fs.rename(staging, dir);
      }).pipe(
        Effect.tapError(() =>
          fs.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
        ),
        Effect.mapError(failed(operation)),
      );
      return yield* mutationResult(
        input.name,
        present
          ? `Installed ${input.name}; the previous version is in .backups.`
          : `Created ${input.name}.`,
      );
    },
  );

  const importBundle: AnimaService["Service"]["import"] = Effect.fn("AnimaService.import")(
    function* (input) {
      const { bundle, mode } = input;
      yield* assertBundleSafe("import", bundle);
      yield* dirOf(bundle.name);
      const local = yield* localComparable(bundle.name);
      if (mode === "create" && Option.isSome(local))
        return yield* rejected("import", `Anima '${bundle.name}' already exists.`);
      if (mode === "fast-forward") {
        if (Option.isNone(local))
          return yield* rejected("import", `Anima '${bundle.name}' does not exist.`);
        const relation = AnimaFiles.relationBetween(
          local.value,
          comparable(idOf(bundle.files), bundle.files),
        ).relation;
        if (relation !== "incoming-ahead")
          return yield* rejected("import", "The incoming anima does not extend the local one.");
      }
      return yield* install({
        name: bundle.name,
        files: bundle.files,
        expectedId: mode === "fast-forward" && Option.isSome(local) ? local.value.id : undefined,
      });
    },
  );

  return AnimaService.of({
    list,
    get,
    create,
    attach,
    setEnabled,
    policy,
    wakePreview,
    wake,
    export: exportBundle,
    compare,
    import: importBundle,
    summary,
    rootPath: Effect.succeed(root),
    cliAvailable,
    voice,
    capsule,
    install,
  });
});

export const layer = Layer.effect(AnimaService, make);
