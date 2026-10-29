import {
  AnimaCommandRejectedError,
  AnimaError,
  AnimaForm,
  AnimaLibrarySlug,
  AnimaName,
  AnimaNotFoundError,
  AnimaSetEnabledInput,
  ANIMA_BUNDLE_VERSION,
  type AnimaAttachInput,
  type AnimaClinicInput,
  type AnimaRecordInput,
  type AnimaBundle,
  type AnimaBundleFile,
  type AnimaCompareResult,
  type AnimaCreateInput,
  type AnimaDetail,
  type AnimaGetInput,
  type AnimaHealthResult,
  type AnimaImportInput,
  type AnimaInboxInput,
  type AnimaInboxMessage,
  type AnimaLibraryListResult,
  type AnimaLibraryReadResult,
  type AnimaLibraryShelveInput,
  type AnimaListResult,
  type AnimaMutationResult,
  type AnimaOpen,
  type AnimaOpensInput,
  type AnimaPolicyInput,
  type AnimaSummary,
  type AnimaTeamInput,
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
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as AnimaFiles from "./AnimaFiles.ts";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const MAX_WAKE_BYTES = 256 * 1024;
/** Recall matches words; the start of a long message carries its intent. */
const MAX_RECALL_MESSAGE_CHARS = 2000;
const MAX_VOICE_BYTES = 16 * 1024;
/** Stand-in caller for the very first anima: the CLI cannot `init` without an architect to act as. */
const BOOTSTRAP_CALLER = "bootstrap-caller";
/** Sender recorded for messages a person sends from T3. */
const DEFAULT_SENDER = "user";
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
  "project",
  "team",
  "offers",
]);

type AnimaFailure = AnimaError | AnimaCommandRejectedError | AnimaNotFoundError;

export interface AnimaWakeInput {
  readonly name: string;
  /** The thread workspace; the CLI records it as the session cwd. */
  readonly cwd: string;
}

/** The host whose instructions format the identity brief. */
export type AnimaBriefTarget = "claude" | "codex";

export interface AnimaCliInfo {
  /** True for the packaged CLI (`anima version --json` answers); false for the legacy skill script. */
  readonly modern: boolean;
  readonly version: string | null;
}

interface CliCommand {
  readonly command: string;
  readonly prefixArgs: ReadonlyArray<string>;
  /** Passed as ANIMA_CLI so the command lines the CLI embeds in its output name the CLI in use. */
  readonly envValue: string;
  /** Checked on every call: absent until the user installs it. */
  readonly checkPath: string | null;
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
    readonly inbox: (name: string) => Effect.Effect<ReadonlyArray<AnimaInboxMessage>, AnimaFailure>;
    readonly inboxAction: (
      input: AnimaInboxInput,
    ) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    /** Opens of the anima's `# project:` directory, read from its opens.json. */
    readonly opens: (name: string) => Effect.Effect<ReadonlyArray<AnimaOpen>, AnimaFailure>;
    readonly opensAction: (
      input: AnimaOpensInput,
    ) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    readonly health: (name: string) => Effect.Effect<AnimaHealthResult, AnimaFailure>;
    readonly libraryList: Effect.Effect<AnimaLibraryListResult, AnimaError>;
    readonly libraryRead: (slug: string) => Effect.Effect<AnimaLibraryReadResult, AnimaFailure>;
    readonly libraryShelve: (
      input: AnimaLibraryShelveInput,
    ) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    readonly team: (input: AnimaTeamInput) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    /** Writes the anima's self-chosen creature form (and optional accent) to appearance.json. */
    readonly clinic: (input: AnimaClinicInput) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
    readonly record: (input: AnimaRecordInput) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
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
    /** Probed once per service lifetime; legacy when the CLI is missing or does not answer. */
    readonly cliInfo: Effect.Effect<AnimaCliInfo>;
    /** The CLI's breathe guide (`resource read breathe`, or the skill's breathe.md), or "" when absent. */
    readonly breatheGuide: Effect.Effect<string>;
    /** The anima's generated output-style text (frontmatter stripped), or "" when absent. */
    readonly voice: (name: string) => Effect.Effect<string>;
    /** Compact identity refresh built from files only: no wake, no clock-in, no inbox. */
    readonly capsule: (name: string) => Effect.Effect<string>;
    /**
     * Periodic identity refresh: the CLI's `brief` for the host when it has one, else `capsule`.
     * Writes nothing and never fails; "" when there is nothing to inject.
     */
    readonly identityBrief: (input: {
      readonly name: string;
      readonly target: AnimaBriefTarget;
    }) => Effect.Effect<string>;
    /**
     * Lived precedents and owned knowledge relevant to `message` (`anima recall`), so the agent
     * need not shell out for them each turn. "" for the legacy CLI, on error, or when nothing applies.
     */
    readonly recall: (input: {
      readonly name: string;
      readonly message: string;
    }) => Effect.Effect<string>;
    /** Validates the tree, moves the current anima into `.backups/`, and installs the files. */
    readonly install: (
      input: AnimaInstallInput,
    ) => Effect.Effect<AnimaMutationResult, AnimaFailure>;
  }
>()("t3/anima/AnimaService") {}

const isAnimaName = Schema.is(AnimaName);
/** `appearance.json` as the packaged CLI's `clinic check-in` writes it. */
const encodeAppearance = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      form: AnimaForm,
      accent: Schema.String,
      checkedInAt: Schema.String,
    }),
  ),
);
const isLibrarySlug = Schema.is(AnimaLibrarySlug);

const stripTerminalControls = (text: string) =>
  // The CLI emits OSC title sequences on stderr.
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

const parseVersionEnvelope = (stdout: string): Option.Option<string> => {
  try {
    const value: unknown = JSON.parse(stdout);
    if (typeof value !== "object" || value === null) return Option.none();
    const envelope = value as { cliVersion?: unknown; data?: { version?: unknown } };
    const version = envelope.data?.version ?? envelope.cliVersion;
    return typeof version === "string" ? Option.some(version) : Option.none();
  } catch {
    return Option.none();
  }
};

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const home = yield* HostProcess.HomeDirectory;
  const environment = yield* HostProcess.Environment;
  const pathDelimiter = (yield* HostProcess.isWindows) ? ";" : ":";

  const root = environment.ANIMA_HOME?.trim() || path.join(home, ".claude", "anima");
  const libraryDir = path.join(root, "library");
  const legacyCliPath = path.join(home, ".claude", "skills", "anima", "anima.ts");
  const outputStylesDir = path.join(home, ".claude", "output-styles");

  const isExecutableFile = (candidate: string) =>
    fs.stat(candidate).pipe(
      Effect.map((info) => info.type === "File" && (info.mode & 0o111) !== 0),
      Effect.orElseSucceed(() => false),
    );

  const findOnPath = Effect.fn("AnimaService.findOnPath")(function* (command: string) {
    for (const dir of (environment.PATH ?? "").split(pathDelimiter)) {
      if (dir === "") continue;
      const candidate = path.join(dir, command);
      if (yield* isExecutableFile(candidate)) return Option.some(candidate);
    }
    return Option.none<string>();
  });

  const scriptCommand = (script: string): CliCommand => ({
    command: "bun",
    prefixArgs: [script],
    envValue: script,
    checkPath: script,
  });

  // Same order as the CLI's own resolveAnimaCli: ANIMA_CLI, `anima` on PATH, the legacy script.
  const overrideCli = environment.ANIMA_CLI?.trim();
  const cli: CliCommand =
    overrideCli !== undefined && overrideCli !== ""
      ? overrideCli.endsWith(".ts")
        ? scriptCommand(overrideCli)
        : {
            command: overrideCli,
            prefixArgs: [],
            envValue: overrideCli,
            checkPath: path.isAbsolute(overrideCli) ? overrideCli : null,
          }
      : yield* findOnPath("anima").pipe(
          Effect.map(
            Option.match({
              onNone: () => scriptCommand(legacyCliPath),
              onSome: (found): CliCommand => ({
                command: found,
                prefixArgs: [],
                envValue: found,
                checkPath: null,
              }),
            }),
          ),
        );
  const cliEnv = {
    HOME: home,
    ANIMA_HOME: root,
    ANIMA_CLI: cli.envValue,
    ANIMA_OUTPUT_STYLES_DIR: outputStylesDir,
  };

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

  const cliAvailable = cli.checkPath === null ? Effect.succeed(true) : exists(cli.checkPath);

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
        command: cli.command,
        args: [...cli.prefixArgs, ...args],
        spawnCwd: options?.cwd ?? root,
        env: cliEnv,
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

  const LEGACY_CLI: AnimaCliInfo = { modern: false, version: null };
  const probedCli = yield* Ref.make(Option.none<AnimaCliInfo>());

  /** The legacy script has no `version` command and prints its help instead. */
  const cliInfo: AnimaService["Service"]["cliInfo"] = Effect.gen(function* () {
    const cached = yield* Ref.get(probedCli);
    if (Option.isSome(cached)) return cached.value;
    if (!(yield* cliAvailable)) return LEGACY_CLI;
    const info = yield* runCli("version", ["version", "--json"]).pipe(
      Effect.map((result) =>
        Option.match(parseVersionEnvelope(result.stdout), {
          onNone: () => LEGACY_CLI,
          onSome: (version): AnimaCliInfo => ({ modern: true, version }),
        }),
      ),
      Effect.orElseSucceed(() => LEGACY_CLI),
    );
    yield* Ref.set(probedCli, Option.some(info));
    return info;
  }).pipe(Effect.withSpan("AnimaService.cliInfo"));

  const isModern = cliInfo.pipe(Effect.map((info) => info.modern));

  const breatheGuide: AnimaService["Service"]["breatheGuide"] = Effect.gen(function* () {
    if (yield* isModern)
      return yield* runCli("breatheGuide", ["resource", "read", "breathe"]).pipe(
        Effect.map((result) => result.stdout),
        Effect.orElseSucceed(() => ""),
      );
    return yield* readOptional(path.join(path.dirname(legacyCliPath), "breathe.md"));
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
    const appearance = AnimaFiles.parseAppearance(byPath.get("appearance.json") ?? "");
    const agentContent = byPath.get("agent.anima") ?? "";
    const agent = AnimaFiles.parseAgentFile(agentContent);
    const assessment = AnimaFiles.assessHealth({
      agentContent,
      latestBreathFile: byPath.get(`breaths/${AnimaFiles.breathFileName(agent.breaths)}`) ?? "",
      nowMs,
    });
    return {
      summary: AnimaFiles.buildSummary({
        name,
        agent,
        identity: byPath.get("identity.md") ?? "",
        policy: AnimaFiles.parsePolicy(byPath.get("policy.md") ?? ""),
        inbox: AnimaFiles.parseInbox(inbox),
        session: AnimaFiles.parseSession(session, nowMs),
        appearance,
        digest: AnimaFiles.digestFiles(files),
        health: assessment?.score ?? null,
      }),
      agent,
      assessment,
      files,
      byPath,
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
      cliVersion: (yield* cliInfo).version,
    };
  });

  const mutationResult = (name: string, output: string) =>
    summary(name).pipe(
      Effect.map((value): AnimaMutationResult => ({ output, summary: value })),
      Effect.orElseSucceed((): AnimaMutationResult => ({ output, summary: null })),
    );

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

  const readOpens = (projectPath: string | null) =>
    projectPath === null || !path.isAbsolute(projectPath)
      ? Effect.succeed([])
      : readOptional(path.join(projectPath, "opens.json")).pipe(
          Effect.map((content) => AnimaFiles.parseOpensFile(content, projectPath)),
        );

  /** Team membership lives only on the lead's header, so finding the lead scans every anima. */
  const findLead = Effect.fn("AnimaService.findLead")(function* (name: string) {
    for (const candidate of yield* listAnimaNames) {
      if (candidate === name) continue;
      const header = yield* readOptional(path.join(root, candidate, "agent.anima"));
      if (AnimaFiles.parseAgentFile(header).team.includes(name)) return candidate;
    }
    return null;
  });

  const get: AnimaService["Service"]["get"] = Effect.fn("AnimaService.get")(function* (input) {
    const { summary: current, agent, byPath, dir } = yield* summarize(input.name);
    const [inboxRaw, fireLog, card, opens, lead] = yield* Effect.all([
      readOptional(path.join(dir, "inbox")),
      readOptional(path.join(dir, "policy-fires.jsonl")),
      readOptional(path.join(dir, "card.json")),
      readOpens(agent.projectPath),
      findLead(input.name),
    ]);
    const policy = AnimaFiles.parsePolicy(byPath.get("policy.md") ?? "", fireLog);
    const limit = input.breathLimit ?? DEFAULT_BREATH_LIMIT;
    const rows = limit === 0 ? agent.rows : agent.rows.slice(-limit);
    const wanted = new Set(rows.map((row) => row.index));
    const details = [...byPath.entries()].flatMap(([filePath, content]) => {
      const match = /^breaths\/([^/]+\.breath)$/.exec(filePath);
      const parsed = match === null ? null : AnimaFiles.parseBreathFile(content, match[1]!);
      return parsed !== null && wanted.has(parsed.index) ? [parsed] : [];
    });
    return {
      summary: current,
      identity: byPath.get("identity.md") ?? "",
      header: agent.header.filter((entry) => !DEDICATED_HEADER_KEYS.has(entry.key)),
      traits: agent.traits,
      skills: agent.skills,
      policy: { ...policy, cap: AnimaFiles.ANIMA_POLICY_CAP },
      breaths: AnimaFiles.mergeBreaths(rows, details),
      inbox: AnimaFiles.parseInbox(inboxRaw),
      opens,
      projectPath: agent.projectPath,
      card: AnimaFiles.parseCard(card),
      offers: agent.offers,
      team: agent.team,
      lead,
      // Clients resolve threads from the shell snapshot's `animaName`.
      threadIds: [],
    };
  });

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

  const writeAtomically = Effect.fn("AnimaService.writeAtomically")(function* (
    target: string,
    content: string,
  ) {
    const nowMs = yield* Clock.currentTimeMillis;
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}-${nowMs}.tmp`);
    yield* fs.writeFileString(temporary, content);
    yield* fs
      .rename(temporary, target)
      .pipe(Effect.tapError(() => fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
  });

  const clinic: AnimaService["Service"]["clinic"] = Effect.fn("AnimaService.clinic")(
    function* (input) {
      const dir = yield* requireAnima(input.name);
      if (yield* isModern) {
        const caller = yield* callerFor(input.name);
        const result = yield* runCli("clinic", [
          "clinic",
          "check-in",
          "--agent",
          input.name,
          "--form",
          input.form,
          ...(input.accent === undefined ? [] : ["--accent", input.accent]),
          "--as",
          caller,
        ]);
        return yield* mutationResult(input.name, result.stdout);
      }
      // The legacy script has no clinic command; the file shape is the packaged CLI's.
      const [current, header] = yield* Effect.all([
        readOptional(path.join(dir, "appearance.json")),
        readOptional(path.join(dir, "agent.anima")),
      ]);
      const fallback =
        AnimaFiles.parseAppearance(current)?.accent ?? AnimaFiles.parseAgentFile(header).accent;
      const accent = input.accent ?? fallback;
      if (accent === null || !/^#[0-9a-fA-F]{6}$/.test(accent))
        return yield* rejected("clinic", `${input.name} has no accent color yet; choose one.`);
      const nowMs = yield* Clock.currentTimeMillis;
      yield* encodeAppearance({
        version: 1,
        form: input.form,
        accent,
        checkedInAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
      }).pipe(
        Effect.flatMap((json) => writeAtomically(path.join(dir, "appearance.json"), `${json}\n`)),
        Effect.mapError(failed("clinic")),
      );
      return yield* mutationResult(
        input.name,
        `${input.name} chose ${input.form} with accent ${accent}.`,
      );
    },
  );

  const record: AnimaService["Service"]["record"] = Effect.fn("AnimaService.record")(
    function* (input) {
      yield* requireAnima(input.name);
      const tensions = input.tensions ?? [];
      const resolves = input.resolves ?? [];
      // The CLI splits both flags on commas, so a comma would silently become two tensions.
      if ([...tensions, ...resolves].some((entry) => entry.includes(",")))
        return yield* rejected("record", "Tensions cannot contain commas.");
      const result = yield* runCli("record", [
        "breathe",
        "--agent",
        input.name,
        "--hsl",
        input.hsl,
        "--note",
        input.note,
        "--shape",
        input.shape,
        ...(input.aim === undefined ? [] : ["--aim", input.aim]),
        ...(input.memo === undefined ? [] : ["--memo", input.memo]),
        ...(tensions.length === 0 ? [] : ["--tension", tensions.join(",")]),
        ...(resolves.length === 0 ? [] : ["--decisions", resolves.join(",")]),
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

  const inbox: AnimaService["Service"]["inbox"] = Effect.fn("AnimaService.inbox")(function* (name) {
    const dir = yield* requireAnima(name);
    return AnimaFiles.parseInbox(yield* readOptional(path.join(dir, "inbox")));
  });

  const inboxArgs = (input: AnimaInboxInput): ReadonlyArray<string> => {
    const { action } = input;
    switch (action.type) {
      case "send":
        return [
          "message",
          "--to",
          input.name,
          "--type",
          action.messageType,
          "--as",
          action.from ?? DEFAULT_SENDER,
          action.body,
        ];
      case "reply":
        return ["reply", "--to", action.messageId, "--as", input.name, action.body];
      case "clear":
        return ["inbox", "--agent", input.name, "--clear"];
      case "ack":
        return [
          "inbox",
          "--agent",
          input.name,
          ...action.messageIds.flatMap((id) => ["--ack", id]),
        ];
    }
  };

  /** The legacy script has no `--ack`, so drop exactly those messages from the file. */
  const ackLegacy = Effect.fn("AnimaService.ackLegacy")(function* (
    dir: string,
    messageIds: ReadonlyArray<string>,
  ) {
    const target = path.join(dir, "inbox");
    const content = yield* readOptional(target);
    const wanted = new Set(messageIds);
    const lines = content.split("\n").filter((line) => line.trim() !== "");
    const kept = lines.filter((line) => {
      const [message] = AnimaFiles.parseInbox(line);
      return message === undefined || !wanted.has(message.id);
    });
    const removed = lines.length - kept.length;
    if (removed === 0) return yield* rejected("inbox", "None of those messages are in the inbox.");
    yield* writeAtomically(target, kept.map((line) => `${line}\n`).join("")).pipe(
      Effect.mapError(failed("inbox")),
    );
    return `Acknowledged ${removed} message${removed === 1 ? "" : "s"}.`;
  });

  const inboxAction: AnimaService["Service"]["inboxAction"] = Effect.fn("AnimaService.inboxAction")(
    function* (input) {
      const dir = yield* requireAnima(input.name);
      const { action } = input;
      // The CLI takes the first argument without a leading `--` as the body.
      if ((action.type === "send" || action.type === "reply") && action.body.startsWith("--"))
        return yield* rejected("inbox", "A message cannot start with '--'.");
      if (action.type === "ack" && !(yield* isModern))
        return yield* mutationResult(input.name, yield* ackLegacy(dir, action.messageIds));
      const result = yield* runCli("inbox", inboxArgs(input));
      return yield* mutationResult(input.name, result.stdout);
    },
  );

  const projectOf = Effect.fn("AnimaService.projectOf")(function* (name: string) {
    const dir = yield* requireAnima(name);
    return AnimaFiles.parseAgentFile(yield* readOptional(path.join(dir, "agent.anima")))
      .projectPath;
  });

  const opens: AnimaService["Service"]["opens"] = Effect.fn("AnimaService.opens")(function* (name) {
    return yield* readOpens(yield* projectOf(name));
  });

  const opensArgs = (input: AnimaOpensInput, project: string): ReadonlyArray<string> => {
    const { action } = input;
    const optional = (flag: string, value: string | undefined) =>
      value === undefined ? [] : [flag, value];
    switch (action.type) {
      case "add":
        return [
          "opens",
          "add",
          "--project",
          project,
          "--agent",
          input.name,
          "--question",
          action.question,
          "--resolves",
          action.resolves,
          ...optional("--assign", action.assignee),
          ...optional("--context", action.context),
        ];
      case "close":
        return ["opens", "close", action.id, "--project", project];
      case "assign":
        return ["opens", "assign", action.id, "--to", action.assignee, "--project", project];
      case "update":
        return [
          "opens",
          "update",
          action.id,
          "--project",
          project,
          ...optional("--status", action.status),
          ...optional("--context", action.context),
          ...optional("--resolves", action.resolves),
        ];
    }
  };

  const opensAction: AnimaService["Service"]["opensAction"] = Effect.fn("AnimaService.opensAction")(
    function* (input) {
      const project = yield* projectOf(input.name);
      if (project === null || !path.isAbsolute(project))
        return yield* rejected(
          "opens",
          `${input.name} has no '# project:' directory, so it has no opens.`,
        );
      const { action } = input;
      if (
        action.type === "update" &&
        action.status === undefined &&
        action.context === undefined &&
        action.resolves === undefined
      )
        return yield* rejected("opens", "Nothing to update.");
      const result = yield* runCli("opens", opensArgs(input, project));
      return yield* mutationResult(input.name, result.stdout);
    },
  );

  const health: AnimaService["Service"]["health"] = Effect.fn("AnimaService.health")(
    function* (name) {
      const { agent, assessment, byPath } = yield* summarize(name);
      const breathFiles = new Map(
        [...byPath].flatMap(([filePath, content]) => {
          const match = /^breaths\/([^/]+\.breath)$/.exec(filePath);
          return match === null ? [] : [[match[1]!, content] as const];
        }),
      );
      return {
        name,
        health: assessment,
        circuit: agent.circuit,
        circuitCount: agent.circuitCount,
        audit: AnimaFiles.auditAnima({
          agentContent: byPath.get("agent.anima") ?? "",
          breathFiles,
          hasIdentity: byPath.has("identity.md"),
        }),
      };
    },
  );

  const libraryEntry = Effect.fn("AnimaService.libraryEntry")(function* (file: string) {
    const target = path.join(libraryDir, file);
    const info = yield* fs.stat(target);
    if (info.type !== "File") return Option.none();
    const bytes = Number(info.size);
    const content = bytes > MAX_FILE_BYTES ? "" : yield* fs.readFileString(target);
    return Option.some({
      slug: file.slice(0, -".md".length),
      title: AnimaFiles.libraryTitle(content),
      bytes,
      modifiedAt: Option.match(info.mtime, {
        onNone: () => null,
        onSome: (date) => DateTime.formatIso(DateTime.fromDateUnsafe(date)),
      }),
    });
  });

  const libraryList: AnimaService["Service"]["libraryList"] = Effect.gen(function* () {
    const files = yield* fs
      .readDirectory(libraryDir)
      .pipe(Effect.orElseSucceed((): string[] => []));
    const entries = yield* Effect.forEach(
      files.filter((file) => file.endsWith(".md")).toSorted(),
      (file) => libraryEntry(file).pipe(Effect.orElseSucceed(() => Option.none())),
      { concurrency: SUMMARY_CONCURRENCY },
    );
    return { entries: entries.flatMap((entry) => (Option.isSome(entry) ? [entry.value] : [])) };
  });

  const libraryRead: AnimaService["Service"]["libraryRead"] = Effect.fn("AnimaService.libraryRead")(
    function* (slug) {
      const missing = rejected("libraryRead", `No library entry named '${slug.slice(0, 128)}'.`);
      if (!isLibrarySlug(slug)) return yield* missing;
      const target = path.join(libraryDir, `${slug}.md`);
      const info = yield* fs.stat(target).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "File") return yield* missing;
      if (Number(info.value.size) > MAX_FILE_BYTES)
        return yield* rejected("libraryRead", "The library entry is too large to read here.");
      const content = yield* fs.readFileString(target).pipe(Effect.mapError(failed("libraryRead")));
      return { slug, content };
    },
  );

  const libraryShelve: AnimaService["Service"]["libraryShelve"] = Effect.fn(
    "AnimaService.libraryShelve",
  )(function* (input) {
    // The CLI silently falls back to the shared library when the target anima is missing.
    if (input.forAnima !== undefined) yield* requireAnima(input.forAnima);
    const result = yield* runCli("libraryShelve", [
      "library",
      "shelve",
      input.slug,
      "--author",
      input.author,
      "--content",
      input.content,
      ...(input.forAnima === undefined ? [] : ["--for", input.forAnima]),
    ]);
    return input.forAnima === undefined
      ? { output: result.stdout, summary: null }
      : yield* mutationResult(input.forAnima, result.stdout);
  });

  const team: AnimaService["Service"]["team"] = Effect.fn("AnimaService.team")(function* (input) {
    yield* requireAnima(input.lead);
    yield* requireAnima(input.member);
    const caller = yield* callerFor(input.lead);
    const result = yield* runCli("team", [
      "team",
      input.action,
      input.member,
      input.lead,
      "--as",
      caller,
    ]);
    return yield* mutationResult(input.lead, result.stdout);
  });

  const wakeWith = Effect.fn("AnimaService.wakeWith")(function* (
    operation: string,
    name: string,
    cwd: string,
    peek: boolean,
  ) {
    yield* requireAnima(name);
    const modern = yield* isModern;
    // The packaged CLI dropped `--peek` (it now ignores it and clocks in) for `--no-clock-in`,
    // and only records the session project from an explicit `--project` or a marker above cwd.
    const extra = peek ? [modern ? "--no-clock-in" : "--peek"] : modern ? ["--project", cwd] : [];
    const result = yield* runCli(operation, ["read", "--wake", "--agent", name, ...extra], {
      cwd,
      maxOutputBytes: MAX_WAKE_BYTES,
    });
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

  const identityBrief: AnimaService["Service"]["identityBrief"] = Effect.fn(
    "AnimaService.identityBrief",
  )(
    function* (input) {
      if (!isAnimaName(input.name)) return "";
      if (!(yield* isModern)) return yield* capsule(input.name);
      yield* requireAnima(input.name);
      const result = yield* runCli("brief", [
        "brief",
        "--target",
        input.target,
        "--agent",
        input.name,
      ]);
      return result.stdout;
    },
    Effect.orElseSucceed(() => ""),
  );

  const recall: AnimaService["Service"]["recall"] = Effect.fn("AnimaService.recall")(
    function* (input) {
      const message = input.message.trim().slice(0, MAX_RECALL_MESSAGE_CHARS);
      if (!isAnimaName(input.name) || message === "" || !(yield* isModern)) return "";
      const result = yield* runCli("recall", [
        "recall",
        "--agent",
        input.name,
        "--message",
        message,
      ]);
      return result.stdout.trim();
    },
    Effect.orElseSucceed(() => ""),
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
    record,
    clinic,
    policy,
    inbox,
    inboxAction,
    opens,
    opensAction,
    health,
    libraryList,
    libraryRead,
    libraryShelve,
    team,
    wakePreview,
    wake,
    export: exportBundle,
    compare,
    import: importBundle,
    summary,
    rootPath: Effect.succeed(root),
    cliAvailable,
    cliInfo,
    breatheGuide,
    voice,
    capsule,
    identityBrief,
    recall,
    install,
  });
});

export const layer = Layer.effect(AnimaService, make);
