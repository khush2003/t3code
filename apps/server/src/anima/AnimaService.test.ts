// @effect-diagnostics nodeBuiltinImport:off -- tests seed fixture trees and probe for the real CLI synchronously
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { type AnimaBundle, ProjectId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as AnimaFiles from "./AnimaFiles.ts";
import * as AnimaService from "./AnimaService.ts";

const AGENT = (id: string, name: string, breaths: number, extra = "") =>
  `# anima v1
# id:${id} name:${name} born:2026-02-25 breaths:${breaths} accent:#223464
# role: agent
# projects: atlas=C
# self: rigor=.58±.19
# skills: typescript=.88±.15
# vow: Be honest.
# memo: m
${extra}${Array.from({ length: breaths + 1 }, (_, n) => `${n}|2026-03-0${n + 1}T10:00|0,0,50|note ${n}|0.1/0.1/0.1+0/0/0|||`).join("\n")}
`;

const breathFile = (n: number) =>
  `# breath:${n} ts:2026-03-0${n + 1}T10:00 parent:${n === 0 ? "-" : n - 1} hash:h${n}\n# files:\n# decisions: d${n}\n# open:\n`;

interface Call {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly spawnCwd: string | undefined;
  readonly env: NodeJS.ProcessEnv | undefined;
}

const VERSION_ENVELOPE = JSON.stringify({
  schemaVersion: 1,
  cliVersion: "0.2.4",
  protocolVersion: 1,
  command: "version",
  ok: true,
  exitCode: 0,
  data: { version: "0.2.4", protocolVersion: 1 },
});

/** `modern` answers the `version --json` probe; probes are counted, not recorded as calls. */
const fakeRunner = (
  calls: Array<Call>,
  reply: { stdout?: string; stderr?: string; code?: number },
  modern: boolean,
  probes: { count: number },
) =>
  Layer.succeed(ProcessRunner.ProcessRunner, {
    run: (input) =>
      Effect.sync(() => {
        const probe = input.args.includes("version") && input.args.includes("--json");
        if (probe) probes.count += 1;
        else
          calls.push({
            command: input.command,
            args: input.args,
            spawnCwd: input.spawnCwd,
            env: input.env,
          });
        return {
          stdout: probe
            ? modern
              ? VERSION_ENVELOPE
              : "usage: anima <command>\n"
            : (reply.stdout ?? "ok\n"),
          stderr: reply.stderr ?? "",
          code: (reply.code ?? 0) as never,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  });

const projectStore = Layer.mock(ProjectStore.ProjectStoreV2)({
  get: (projectId) =>
    Effect.succeed(
      projectId === "p1"
        ? Option.some({ workspaceRoot: "/work/atlas" } as ProjectStore.ProjectRow)
        : Option.none(),
    ),
});

const withService = <A, E>(
  options: {
    readonly cli?: boolean;
    readonly modern?: boolean;
    readonly reply?: Parameters<typeof fakeRunner>[1];
    readonly env?: (home: string) => NodeJS.ProcessEnv;
  },
  body: (input: {
    readonly service: AnimaService.AnimaService["Service"];
    readonly home: string;
    readonly root: string;
    readonly calls: Array<Call>;
    readonly probes: { count: number };
  }) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "anima-home-" });
    const root = NodePath.join(home, ".claude", "anima");
    yield* fs.makeDirectory(root, { recursive: true });
    if (options.cli !== false) {
      yield* fs.makeDirectory(NodePath.join(home, ".claude", "skills", "anima"), {
        recursive: true,
      });
      yield* fs.writeFileString(NodePath.join(home, ".claude", "skills", "anima", "anima.ts"), "");
    }
    const calls: Array<Call> = [];
    const probes = { count: 0 };
    const layer = AnimaService.layer.pipe(
      Layer.provide(fakeRunner(calls, options.reply ?? {}, options.modern === true, probes)),
      Layer.provide(projectStore),
      Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home)),
      Layer.provide(Layer.succeed(HostProcess.Environment, options.env?.(home) ?? { PATH: "" })),
    );
    const service = yield* AnimaService.AnimaService.pipe(Effect.provide(layer));
    return yield* body({ service, home, root, calls, probes });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const seed = Effect.fn("seed")(function* (
  root: string,
  name: string,
  id: string,
  breaths: number,
  options?: { readonly extraHeader?: string; readonly session?: string },
) {
  const fs = yield* FileSystem.FileSystem;
  const dir = NodePath.join(root, name);
  yield* fs.makeDirectory(NodePath.join(dir, "breaths"), { recursive: true });
  yield* fs.writeFileString(
    NodePath.join(dir, "agent.anima"),
    AGENT(id, name, breaths, options?.extraHeader),
  );
  yield* fs.writeFileString(
    NodePath.join(dir, "identity.md"),
    `# ${name}\n\n## voice\nQuiet and exact.\n`,
  );
  yield* fs.writeFileString(
    NodePath.join(dir, "policy.md"),
    "# Policy: x\n# rev: 1 updated: 2026-01-01 by: x\n\n## Operational\nALWAYS a\n",
  );
  yield* fs.writeFileString(
    NodePath.join(dir, "inbox"),
    '{"id":"m1","type":"info","from":"a","ts":"t","body":"b"}\n',
  );
  if (options?.session !== undefined)
    yield* fs.writeFileString(NodePath.join(dir, "session"), options.session);
  for (let n = 0; n <= breaths; n += 1) {
    yield* fs.writeFileString(
      NodePath.join(dir, "breaths", AnimaFiles.breathFileName(n)),
      breathFile(n),
    );
  }
});

describe("AnimaService files", () => {
  it.effect("lists animas from files even without the CLI", () =>
    withService({ cli: false }, ({ service, root }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 2);
        yield* seed(root, "sage", "id-sage", 0);
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(NodePath.join(root, "library"), { recursive: true });
        yield* fs.makeDirectory(NodePath.join(root, ".backups"), { recursive: true });
        const result = yield* service.list;
        expect(result.cliAvailable).toBe(false);
        expect(result.rootPath).toBe(root);
        expect(result.animas.map((a) => a.name)).toEqual(["atlas", "sage"]);
        expect(result.animas[0]).toMatchObject({
          id: "id-atlas",
          breathCount: 2,
          inboxCount: 1,
          policyCount: 1,
          vow: "Be honest.",
          voice: "Quiet and exact.",
          live: false,
        });
      }),
    ),
  );

  it.effect("reads detail with a breath window and hides dedicated header keys", () =>
    withService({}, ({ service, root }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 4, {
          extraHeader: "# tension: a:1\n# user: direct=.9±.1\n",
        });
        const detail = yield* service.get({ name: "atlas", breathLimit: 2 });
        expect(detail.breaths.map((b) => [b.index, b.hash, b.decisions])).toEqual([
          [3, "h3", ["d3"]],
          [4, "h4", ["d4"]],
        ]);
        expect(detail.header.map((h) => h.key)).toContain("tension");
        expect(detail.header.map((h) => h.key)).toContain("user");
        expect(detail.header.map((h) => h.key)).not.toContain("memo");
        expect(detail.policy.cap).toBe(40);
        expect(detail.skills[0]?.name).toBe("typescript");
      }),
    ),
  );

  it.effect("reads opens, card, team, lead and fire stats from files", () =>
    withService({ cli: false }, ({ service, root, home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const project = NodePath.join(home, "work", "atlas");
        yield* fs.makeDirectory(project, { recursive: true });
        yield* fs.writeFileString(
          NodePath.join(project, "opens.json"),
          JSON.stringify([
            {
              id: "open-001",
              question: "Q?",
              assigned: "atlas",
              resolves_when: "R",
              status: "active",
            },
          ]),
        );
        yield* seed(root, "atlas", "id-atlas", 1, {
          extraHeader: `# project: ${project}\n# offers: review, typing\n`,
        });
        yield* seed(root, "boss", "id-boss", 0, { extraHeader: "# team: kite,atlas\n" });
        yield* fs.writeFileString(
          NodePath.join(root, "atlas", "card.json"),
          '{"description":"Quiet.","skills":[{"name":"ts","confidence":0.9}],"interfaces":["inbox"]}',
        );
        // `1bxae1c` is hook.ts's hashOf("ALWAYS a"), the seeded operational rule.
        yield* fs.writeFileString(
          NodePath.join(root, "atlas", "policy-fires.jsonl"),
          '{"h":"1bxae1c","ts":"2026-03-02T10:00"}\n',
        );

        const detail = yield* service.get({ name: "atlas" });
        expect(detail.opens).toMatchObject([
          { id: "open-001", project, question: "Q?", assignee: "atlas", resolves: "R" },
        ]);
        expect(detail).toMatchObject({
          projectPath: project,
          offers: ["review", "typing"],
          team: [],
          lead: "boss",
          card: { description: "Quiet.", skills: [{ name: "ts", confidence: 0.9 }] },
        });
        expect(detail.header.map((h) => h.key)).not.toContain("project");
        expect(detail.policy.operational).toEqual([
          { index: 1, text: "ALWAYS a", fires: 1, lastFiredAt: "2026-03-02T10:00" },
        ]);
        expect(yield* service.opens("atlas")).toEqual(detail.opens);
        expect((yield* service.get({ name: "boss" })).team).toEqual(["kite", "atlas"]);
        expect((yield* service.inbox("atlas")).map((message) => message.id)).toEqual(["m1"]);
      }),
    ),
  );

  it.effect("reports health with audit findings and scores every listed anima", () =>
    withService({ cli: false }, ({ service, root }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 2, {
          extraHeader: "# circuit: half-open\n# circuit-count: 1\n",
        });
        const fs = yield* FileSystem.FileSystem;
        yield* fs.remove(NodePath.join(root, "atlas", "breaths", "001.breath"));
        const result = yield* service.health("atlas");
        expect(result).toMatchObject({
          name: "atlas",
          circuit: "half-open",
          circuitCount: 1,
          audit: [{ level: "warn", message: "breath 1: missing detail file" }],
        });
        expect(result.health?.score).toBeGreaterThan(0);
        const listed = yield* service.list;
        expect(listed.animas[0]?.health).toBe(result.health?.score);
      }),
    ),
  );

  it.effect("lists and reads library entries without escaping the library", () =>
    withService({ cli: false }, ({ service, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const library = NodePath.join(root, "library");
        yield* fs.makeDirectory(NodePath.join(library, "nested.md"), { recursive: true });
        yield* fs.writeFileString(NodePath.join(library, "codec.md"), "# Codec\n\nFrom: x\n");
        yield* fs.writeFileString(NodePath.join(library, "notes.txt"), "skip");
        yield* fs.writeFileString(NodePath.join(root, "secret.md"), "outside");
        const { entries } = yield* service.libraryList;
        expect(entries).toMatchObject([{ slug: "codec", title: "Codec", bytes: 17 }]);
        expect(entries[0]?.modifiedAt).not.toBeNull();
        expect(yield* service.libraryRead("codec")).toEqual({
          slug: "codec",
          content: "# Codec\n\nFrom: x\n",
        });
        for (const slug of ["../secret", "missing", "nested"]) {
          const error = yield* Effect.flip(service.libraryRead(slug));
          expect(error._tag).toBe("AnimaCommandRejectedError");
        }
      }),
    ),
  );

  it.effect("rejects names that are not directory-safe", () =>
    withService({}, ({ service }) =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(service.get({ name: "../etc" }));
        expect(exit._tag).toBe("Failure");
        const wake = yield* Effect.exit(service.wake({ name: "a/b", cwd: "/tmp" }));
        expect(wake._tag).toBe("Failure");
      }),
    ),
  );
});

describe("AnimaService CLI invocation", () => {
  it.effect("builds create, policy, enable and attach commands with HOME", () =>
    withService({}, ({ service, root, home, calls }) =>
      Effect.gen(function* () {
        yield* seed(root, "boss", "id-boss", 0, { extraHeader: "" });
        const fs = yield* FileSystem.FileSystem;
        yield* fs.writeFileString(
          NodePath.join(root, "boss", "agent.anima"),
          AGENT("id-boss", "boss", 0).replace("# role: agent", "# role: architect"),
        );
        yield* seed(root, "atlas", "id-atlas", 0, { extraHeader: "# project: /work/atlas\n" });

        yield* service.create({ name: "kid", parent: "atlas" });
        yield* service.policy({
          name: "atlas",
          action: { type: "add", rule: "WHEN a THEN b", direct: true },
        });
        yield* service.policy({
          name: "atlas",
          action: { type: "update", index: 2, rule: "ALWAYS z" },
        });
        yield* service.policy({ name: "atlas", action: { type: "remove", index: 1 } });
        yield* service.policy({ name: "atlas", action: { type: "apply" } });
        yield* service.setEnabled({ name: "atlas", enabled: false });
        yield* service.attach({ name: "atlas", projectId: ProjectId.make("p1") });
        yield* service.inboxAction({
          name: "atlas",
          action: { type: "send", messageType: "query", body: "Ready?" },
        });
        yield* service.inboxAction({
          name: "atlas",
          action: { type: "send", messageType: "info", body: "hi", from: "boss" },
        });
        yield* service.inboxAction({
          name: "atlas",
          action: { type: "reply", messageId: "m1", body: "Yes." },
        });
        yield* service.inboxAction({ name: "atlas", action: { type: "clear" } });
        yield* service.opensAction({
          name: "atlas",
          action: { type: "add", question: "Q?", resolves: "R", assignee: "boss" },
        });
        yield* service.opensAction({ name: "atlas", action: { type: "close", id: "open-001" } });
        yield* service.opensAction({
          name: "atlas",
          action: { type: "assign", id: "open-002", assignee: "boss" },
        });
        yield* service.opensAction({
          name: "atlas",
          action: { type: "update", id: "open-002", status: "blocked", resolves: "R2" },
        });
        yield* service.team({ lead: "boss", action: "add", member: "atlas" });
        yield* service.libraryShelve({ slug: "codec", author: "atlas", content: "--x" });
        yield* service.libraryShelve({
          slug: "codec",
          author: "atlas",
          content: "y",
          forAnima: "boss",
        });

        const cliArgs = calls.map((call) => call.args.slice(1));
        expect(cliArgs).toEqual([
          ["birth", "--name", "kid", "--parent", "atlas", "--as", "boss"],
          ["policy", "--agent", "atlas", "--as", "boss", "--add", "WHEN a THEN b", "--auto"],
          ["policy", "--agent", "atlas", "--as", "boss", "--update", "2", "--add", "ALWAYS z"],
          ["policy", "--agent", "atlas", "--as", "boss", "--remove", "1"],
          ["policy", "--agent", "atlas", "--as", "boss", "--apply"],
          ["deactivate", "atlas", "--as", "boss"],
          ["setup", "--agent", "atlas", "--project", "/work/atlas"],
          ["message", "--to", "atlas", "--type", "query", "--as", "user", "Ready?"],
          ["message", "--to", "atlas", "--type", "info", "--as", "boss", "hi"],
          ["reply", "--to", "m1", "--as", "atlas", "Yes."],
          ["inbox", "--agent", "atlas", "--clear"],
          [
            "opens",
            "add",
            "--project",
            "/work/atlas",
            "--agent",
            "atlas",
            "--question",
            "Q?",
            "--resolves",
            "R",
            "--assign",
            "boss",
          ],
          ["opens", "close", "open-001", "--project", "/work/atlas"],
          ["opens", "assign", "open-002", "--to", "boss", "--project", "/work/atlas"],
          [
            "opens",
            "update",
            "open-002",
            "--project",
            "/work/atlas",
            "--status",
            "blocked",
            "--resolves",
            "R2",
          ],
          ["team", "add", "atlas", "boss", "--as", "boss"],
          ["library", "shelve", "codec", "--author", "atlas", "--content", "--x"],
          ["library", "shelve", "codec", "--author", "atlas", "--content", "y", "--for", "boss"],
        ]);
        expect(calls.every((call) => call.command === "bun")).toBe(true);
        expect(calls[0]?.env).toEqual({
          HOME: home,
          ANIMA_HOME: root,
          ANIMA_CLI: NodePath.join(home, ".claude", "skills", "anima", "anima.ts"),
          ANIMA_OUTPUT_STYLES_DIR: NodePath.join(home, ".claude", "output-styles"),
        });
        expect(calls.every((call) => call.env?.HOME === home)).toBe(true);
      }),
    ),
  );

  it.effect("maps non-zero exits and stderr-only output to a rejection", () =>
    Effect.gen(function* () {
      const zero = yield* withService(
        { reply: { stdout: "", stderr: "Policy cap reached: 40/40\nmore" } },
        ({ service, root }) =>
          Effect.gen(function* () {
            yield* seed(root, "atlas", "id-atlas", 0);
            return yield* Effect.flip(service.policy({ name: "atlas", action: { type: "apply" } }));
          }),
      );
      expect(zero).toMatchObject({
        _tag: "AnimaCommandRejectedError",
        reason: "Policy cap reached: 40/40",
      });

      const nonZero = yield* withService(
        { reply: { stdout: "", stderr: "\u001b]1;x\u0007not allowed\n", code: 1 } },
        ({ service, root }) =>
          Effect.gen(function* () {
            yield* seed(root, "atlas", "id-atlas", 0);
            return yield* Effect.flip(service.policy({ name: "atlas", action: { type: "apply" } }));
          }),
      );
      expect(nonZero).toMatchObject({ _tag: "AnimaCommandRejectedError", reason: "not allowed" });
    }),
  );

  it.effect("wakes with the workspace as spawn cwd and previews without clocking in", () =>
    Effect.gen(function* () {
      for (const modern of [false, true]) {
        yield* withService(
          { modern, reply: { stdout: "WAKE PAYLOAD\n", stderr: "\u001b]1;atlas\u0007" } },
          ({ service, root, calls, probes }) =>
            Effect.gen(function* () {
              yield* seed(root, "atlas", "id-atlas", 0);
              expect(yield* service.wake({ name: "atlas", cwd: "/work/atlas" })).toBe(
                "WAKE PAYLOAD",
              );
              expect(calls.at(-1)?.spawnCwd).toBe("/work/atlas");
              expect(calls.at(-1)?.args.slice(1)).toEqual([
                "read",
                "--wake",
                "--agent",
                "atlas",
                ...(modern ? ["--project", "/work/atlas"] : []),
              ]);
              yield* service.wakePreview("atlas");
              // The packaged CLI silently ignores --peek and clocks in.
              expect(calls.at(-1)?.args.slice(1)).toEqual([
                "read",
                "--wake",
                "--agent",
                "atlas",
                modern ? "--no-clock-in" : "--peek",
              ]);
              expect(calls.at(-1)?.spawnCwd).toBe(root);
              expect((yield* service.list).cliVersion).toBe(modern ? "0.2.4" : null);
              expect(probes.count).toBe(1);
            }),
        );
      }
    }),
  );

  it.effect("resolves ANIMA_CLI, then anima on PATH, then the legacy script", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const bin = yield* fs.makeTempDirectoryScoped({ prefix: "anima-bin-" });
      const script = NodePath.join(bin, "cli.ts");
      yield* fs.writeFileString(script, "");
      yield* fs.writeFileString(NodePath.join(bin, "anima"), "#!/bin/sh\n");
      yield* fs.chmod(NodePath.join(bin, "anima"), 0o755);
      const commandFor = (env: (home: string) => NodeJS.ProcessEnv) =>
        withService({ env }, ({ service, root, calls }) =>
          Effect.gen(function* () {
            yield* seed(root, "atlas", "id-atlas", 0);
            yield* service.wakePreview("atlas");
            const call = calls.at(-1)!;
            return { command: call.command, first: call.args[0], env: call.env, root };
          }),
        );
      const override = yield* commandFor(() => ({ PATH: bin, ANIMA_CLI: script }));
      expect(override).toMatchObject({ command: "bun", first: script });
      expect(override.env?.ANIMA_CLI).toBe(script);

      const binary = yield* commandFor(() => ({ PATH: "", ANIMA_CLI: "anima-dev" }));
      expect(binary).toMatchObject({ command: "anima-dev", first: "read" });

      const onPath = yield* commandFor((home) => ({
        PATH: `/nonexistent:${bin}`,
        ANIMA_HOME: NodePath.join(home, ".claude", "anima"),
      }));
      expect(onPath).toMatchObject({ command: NodePath.join(bin, "anima"), first: "read" });
      expect(onPath.env?.ANIMA_CLI).toBe(NodePath.join(bin, "anima"));
      expect(onPath.env?.ANIMA_HOME).toBe(onPath.root);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("checks in, acknowledges and briefs through the packaged CLI", () =>
    withService({ modern: true, reply: { stdout: "BRIEF\n" } }, ({ service, root, calls }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 0);
        yield* service.clinic({ name: "atlas", form: "owl", accent: "#9b82bc" });
        yield* service.clinic({ name: "atlas", form: "fox" });
        yield* service.inboxAction({
          name: "atlas",
          action: { type: "ack", messageIds: ["m1", "m2"] },
        });
        expect(yield* service.identityBrief({ name: "atlas", target: "codex" })).toBe("BRIEF");
        expect(yield* service.breatheGuide).toBe("BRIEF");
        expect(calls.map((call) => call.args.slice(1))).toEqual([
          [
            "clinic",
            "check-in",
            "--agent",
            "atlas",
            "--form",
            "owl",
            "--accent",
            "#9b82bc",
            "--as",
            "atlas",
          ],
          ["clinic", "check-in", "--agent", "atlas", "--form", "fox", "--as", "atlas"],
          ["inbox", "--agent", "atlas", "--ack", "m1", "--ack", "m2"],
          ["brief", "--target", "codex", "--agent", "atlas"],
          ["resource", "read", "breathe"],
        ]);
      }),
    ),
  );

  it.effect("checks in and acknowledges by editing files under the legacy script", () =>
    withService({}, ({ service, root, calls }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* seed(root, "atlas", "id-atlas", 0);
        yield* fs.writeFileString(
          NodePath.join(root, "atlas", "inbox"),
          '{"id":"m1","type":"info","from":"a","ts":"t","body":"b"}\n2026-01-01T10:00|boss|info|old\n{"id":"m3","type":"info","from":"a","ts":"t","body":"c"}\n',
        );
        const result = yield* service.clinic({ name: "atlas", form: "moth" });
        expect(result.summary).toMatchObject({ form: "moth", accent: "#223464" });
        const recolored = yield* service.clinic({
          name: "atlas",
          form: "frog",
          accent: "#00ff88",
        });
        expect(recolored.summary).toMatchObject({ form: "frog", accent: "#00ff88" });
        const saved = JSON.parse(
          yield* fs.readFileString(NodePath.join(root, "atlas", "appearance.json")),
        );
        expect(saved).toMatchObject({ version: 1, form: "frog", accent: "#00ff88" });
        // Kept in exports so the look travels with the anima.
        const bundle = yield* service.export("atlas");
        expect(bundle.files.map((file) => file.path)).toContain("appearance.json");

        yield* service.inboxAction({
          name: "atlas",
          action: { type: "ack", messageIds: ["m1", "2026-01-01T10:00:boss"] },
        });
        expect((yield* service.inbox("atlas")).map((message) => message.id)).toEqual(["m3"]);
        const unknown = yield* Effect.flip(
          service.inboxAction({ name: "atlas", action: { type: "ack", messageIds: ["m9"] } }),
        );
        expect(unknown).toMatchObject({ _tag: "AnimaCommandRejectedError" });
        // The legacy brief is the file-built capsule.
        expect(yield* service.identityBrief({ name: "atlas", target: "claude" })).toContain(
          "you are atlas",
        );
        expect(calls).toHaveLength(0);
      }),
    ),
  );

  it.effect("refuses inbox and opens requests the CLI would misread", () =>
    withService({}, ({ service, root, calls }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 0);
        const dashed = yield* Effect.flip(
          service.inboxAction({
            name: "atlas",
            action: { type: "send", messageType: "info", body: "--to x" },
          }),
        );
        expect(dashed).toMatchObject({ _tag: "AnimaCommandRejectedError" });
        const noProject = yield* Effect.flip(
          service.opensAction({ name: "atlas", action: { type: "close", id: "open-001" } }),
        );
        expect(noProject).toMatchObject({ _tag: "AnimaCommandRejectedError" });
        const missing = yield* Effect.flip(
          service.libraryShelve({ slug: "x", author: "atlas", content: "y", forAnima: "ghost" }),
        );
        expect(missing._tag).toBe("AnimaNotFoundError");
        expect(calls).toHaveLength(0);
      }),
    ),
  );

  it.effect("refuses architect-only commands when no architect exists", () =>
    withService({}, ({ service, root, calls }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 0);
        const error = yield* Effect.flip(service.create({ name: "kid", parent: "atlas" }));
        expect(error).toMatchObject({ _tag: "AnimaCommandRejectedError" });
        expect(calls).toHaveLength(0);
      }),
    ),
  );

  it.effect("rejects duplicate names and unknown parents before running the CLI", () =>
    withService({}, ({ service, root, calls }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* seed(root, "boss", "id-boss", 0);
        yield* fs.writeFileString(
          NodePath.join(root, "boss", "agent.anima"),
          AGENT("id-boss", "boss", 0).replace("# role: agent", "# role: architect"),
        );
        const duplicate = yield* Effect.flip(service.create({ name: "boss" }));
        expect(duplicate).toMatchObject({ reason: "An anima named 'boss' already exists." });
        const orphan = yield* Effect.flip(service.create({ name: "kid", parent: "ghost" }));
        expect(orphan).toMatchObject({ _tag: "AnimaCommandRejectedError" });
        expect(calls).toHaveLength(0);
      }),
    ),
  );

  it.effect("tells the user how to get an architect when animas exist without one", () =>
    withService({}, ({ service, root }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 0);
        const error = yield* Effect.flip(service.create({ name: "kid" }));
        expect(error).toMatchObject({ _tag: "AnimaCommandRejectedError" });
        expect(String((error as { reason: string }).reason)).toContain("# role: architect");
      }),
    ),
  );

  it.effect("bootstraps the first anima as an architect through a throwaway caller", () =>
    withService({}, ({ service, root, calls }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* service.create({ name: "first" });
        expect(calls.map((call) => call.args.slice(1))).toContainEqual([
          "init",
          "--name",
          "first",
          "--role",
          "architect",
          "--as",
          "bootstrap-caller",
        ]);
        expect(yield* fs.exists(NodePath.join(root, "bootstrap-caller"))).toBe(false);
        const rejected = yield* Effect.flip(service.create({ name: "x", parent: "first" }));
        expect(rejected).toMatchObject({ _tag: "AnimaCommandRejectedError" });
      }),
    ),
  );

  it.effect("reads the generated voice without frontmatter and builds a capsule from files", () =>
    withService({}, ({ service, root, home }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* seed(root, "atlas", "id-atlas", 0);
        expect(yield* service.voice("atlas")).toBe("");
        yield* fs.makeDirectory(NodePath.join(home, ".claude", "output-styles"), {
          recursive: true,
        });
        yield* fs.writeFileString(
          NodePath.join(home, ".claude", "output-styles", "atlas.md"),
          "---\nname: atlas\nkeep-coding-instructions: true\n---\n\n# atlas\nSpeak plainly.\n",
        );
        expect(yield* service.voice("atlas")).toBe("# atlas\nSpeak plainly.");
        const capsule = yield* service.capsule("atlas");
        expect(capsule).toContain("you are atlas");
        expect(capsule).toContain("Vow: Be honest.");
        expect(capsule).toContain("Memo: m");
        expect(yield* service.capsule("ghost")).toBe("");
      }),
    ),
  );

  it.effect("reports a missing CLI as a rejection", () =>
    withService({ cli: false }, ({ service, root }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 0);
        const error = yield* Effect.flip(service.setEnabled({ name: "atlas", enabled: true }));
        expect(error._tag).toBe("AnimaCommandRejectedError");
      }),
    ),
  );
});

describe("AnimaService sync", () => {
  const bundleOf = (service: AnimaService.AnimaService["Service"], name: string) =>
    service.export(name);

  it.effect("exports, compares and imports with backup and preserved session files", () =>
    withService({}, ({ service, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* seed(root, "atlas", "id-atlas", 1, {
          session: "2026-03-01T10:00|2026-03-01T10:00|/x\n",
        });
        const base = yield* bundleOf(service, "atlas");
        expect(base.files.map((f) => f.path)).not.toContain("session");
        expect(base.files.map((f) => f.path)).not.toContain("inbox");
        expect(base.breathChain).toEqual(["0:h0", "1:h1"]);
        expect((yield* service.summary("atlas")).digest).toBe(base.digest);

        const identical = yield* service.compare(base);
        expect(identical.relation).toBe("identical");

        yield* seed(root, "atlas", "id-atlas", 2);
        const ahead = yield* bundleOf(service, "atlas");
        yield* fs.remove(NodePath.join(root, "atlas"), { recursive: true });
        yield* seed(root, "atlas", "id-atlas", 1, {
          session: "2026-03-01T10:00|2026-03-01T10:00|/x\n",
        });

        const compare = yield* service.compare(ahead);
        expect(compare).toMatchObject({
          relation: "incoming-ahead",
          commonBreath: 1,
          incomingOnlyBreaths: 1,
        });

        yield* service.import({ bundle: ahead, mode: "fast-forward" });
        const after = yield* service.get({ name: "atlas" });
        expect(after.summary.breathCount).toBe(2);
        expect(yield* fs.exists(NodePath.join(root, "atlas", "session"))).toBe(true);
        const backups = yield* fs.readDirectory(NodePath.join(root, ".backups"));
        expect(backups).toHaveLength(1);
        expect(
          yield* fs.exists(NodePath.join(root, ".backups", backups[0]!, "breaths", "002.breath")),
        ).toBe(false);

        const again = yield* Effect.flip(service.import({ bundle: ahead, mode: "fast-forward" }));
        expect(again._tag).toBe("AnimaCommandRejectedError");
        const duplicate = yield* Effect.flip(service.import({ bundle: ahead, mode: "create" }));
        expect(duplicate._tag).toBe("AnimaCommandRejectedError");

        yield* TestClock.adjust("2 seconds");
        yield* service.import({ bundle: base, mode: "replace" });
        expect((yield* service.get({ name: "atlas" })).summary.breathCount).toBe(1);
        expect(yield* fs.readDirectory(NodePath.join(root, ".backups"))).toHaveLength(2);
      }),
    ),
  );

  it.effect("creates a missing anima from a bundle and refuses escaping paths", () =>
    withService({}, ({ service, root }) =>
      Effect.gen(function* () {
        yield* seed(root, "atlas", "id-atlas", 0);
        const bundle = yield* bundleOf(service, "atlas");
        const renamed: AnimaBundle = {
          ...bundle,
          name: "copy",
          files: bundle.files.map((f) =>
            f.path === "agent.anima"
              ? { ...f, content: f.content.replace("name:atlas", "name:copy") }
              : f,
          ),
        };
        yield* service.import({ bundle: renamed, mode: "create" });
        expect((yield* service.list).animas.map((a) => a.name)).toEqual(["atlas", "copy"]);

        const evil: AnimaBundle = {
          ...renamed,
          name: "evil",
          files: [...renamed.files, { path: "../outside.md", content: "x" }],
        };
        const error = yield* Effect.flip(service.import({ bundle: evil, mode: "create" }));
        expect(error._tag).toBe("AnimaCommandRejectedError");
        expect(NodeFS.existsSync(NodePath.join(root, "outside.md"))).toBe(false);
        expect(NodeFS.existsSync(NodePath.join(root, "evil"))).toBe(false);

        const mismatched = yield* Effect.flip(
          service.import({ bundle: { ...renamed, name: "other" }, mode: "create" }),
        );
        expect(mismatched._tag).toBe("AnimaCommandRejectedError");
      }),
    ),
  );
});

const realCli = NodePath.join(NodeOS.homedir(), ".claude", "skills", "anima", "anima.ts");
const bunAvailable = (() => {
  try {
    return (
      NodeFS.existsSync(realCli) && NodeChildProcess.spawnSync("bun", ["--version"]).status === 0
    );
  } catch {
    return false;
  }
})();

describe.skipIf(!bunAvailable)("AnimaService with the real CLI (temp HOME)", () => {
  it.live("births, edits policy and wakes against an isolated HOME", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "anima-real-" });
      yield* fs.makeDirectory(NodePath.join(home, ".claude", "skills"), { recursive: true });
      yield* fs.symlink(
        NodePath.dirname(realCli),
        NodePath.join(home, ".claude", "skills", "anima"),
      );
      yield* fs.makeDirectory(NodePath.join(home, ".claude", "anima"), { recursive: true });
      const layer = AnimaService.layer.pipe(
        Layer.provide(ProcessRunner.layer),
        Layer.provide(projectStore),
        Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home)),
        Layer.provide(Layer.succeed(HostProcess.Environment, { PATH: "" })),
      );
      const service = yield* AnimaService.AnimaService.pipe(Effect.provide(layer));
      const root = NodePath.join(home, ".claude", "anima");
      yield* fs.makeDirectory(NodePath.join(root, "boss", "breaths"), { recursive: true });
      yield* fs.writeFileString(
        NodePath.join(root, "boss", "agent.anima"),
        AGENT("id-boss", "boss", 0).replace("# role: agent", "# role: architect"),
      );
      yield* service.create({ name: "other", role: "agent" });
      yield* service.create({ name: "kid", parent: "boss" });
      yield* service.policy({
        name: "kid",
        action: { type: "add", rule: "WHEN x THEN y", direct: true },
      });
      const bad = yield* Effect.flip(
        service.policy({ name: "kid", action: { type: "add", rule: "nonsense", direct: true } }),
      );
      expect(bad).toMatchObject({ reason: "Invalid rule format." });
      yield* service.setEnabled({ name: "kid", enabled: false });
      const detail = yield* service.get({ name: "kid" });
      expect(detail.summary.enabled).toBe(false);
      expect(detail.policy.operational.map((r) => r.text)).toEqual(["WHEN x THEN y"]);
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "anima-cwd-" });
      const wake = yield* service.wake({ name: "boss", cwd });
      expect(wake.length).toBeGreaterThan(20);
      const session = yield* fs.readFileString(
        NodePath.join(home, ".claude", "anima", "boss", "session"),
      );
      expect(session.trim().endsWith(yield* fs.realPath(cwd))).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe.skipIf(!bunAvailable)("AnimaService.create with the real CLI (temp HOME)", () => {
  const realHome = (architect: boolean) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "anima-create-" });
      yield* fs.makeDirectory(NodePath.join(home, ".claude", "skills"), { recursive: true });
      yield* fs.symlink(
        NodePath.dirname(realCli),
        NodePath.join(home, ".claude", "skills", "anima"),
      );
      const root = NodePath.join(home, ".claude", "anima");
      yield* fs.makeDirectory(root, { recursive: true });
      if (architect) {
        yield* fs.makeDirectory(NodePath.join(root, "boss", "breaths"), { recursive: true });
        yield* fs.writeFileString(
          NodePath.join(root, "boss", "agent.anima"),
          AGENT("id-boss", "boss", 0).replace("# role: agent", "# role: architect"),
        );
      }
      const layer = AnimaService.layer.pipe(
        Layer.provide(ProcessRunner.layer),
        Layer.provide(projectStore),
        Layer.provide(Layer.succeed(HostProcess.HomeDirectory, home)),
        Layer.provide(Layer.succeed(HostProcess.Environment, { PATH: "" })),
      );
      const service = yield* AnimaService.AnimaService.pipe(Effect.provide(layer));
      return { fs, home, root, service };
    });

  it.live("creates by name, parent and project path, and lists fresh animas cleanly", () =>
    Effect.gen(function* () {
      const { fs, service } = yield* realHome(true);
      const project = yield* fs.makeTempDirectoryScoped({ prefix: "anima-project-" });
      yield* service.create({ name: "named" });
      yield* service.create({ name: "child", parent: "boss" });
      yield* service.create({ name: "scanned", fromProjectPath: project });
      const listed = yield* service.list;
      expect(listed.animas.map((entry) => entry.name).toSorted()).toEqual([
        "boss",
        "child",
        "named",
        "scanned",
      ]);
      for (const name of ["named", "child", "scanned"]) {
        const entry = listed.animas.find((candidate) => candidate.name === name)!;
        expect(entry.breathCount).toBe(0);
        expect(entry.hsl).toBeNull();
        expect(entry.shape).toBeNull();
        const detail = yield* service.get({ name });
        expect(detail.summary.name).toBe(name);
      }
      const duplicate = yield* Effect.flip(service.create({ name: "named" }));
      expect(duplicate).toMatchObject({ _tag: "AnimaCommandRejectedError" });
      const badPath = yield* Effect.flip(
        service.create({ name: "lost", fromProjectPath: "/nonexistent/anima-project" }),
      );
      expect(badPath).toMatchObject({ _tag: "AnimaCommandRejectedError" });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("bootstraps the first anima when none exists and then creates more", () =>
    Effect.gen(function* () {
      const { fs, root, service } = yield* realHome(false);
      yield* service.create({ name: "first" });
      yield* service.create({ name: "second" });
      const listed = yield* service.list;
      expect(listed.animas.map((entry) => [entry.name, entry.role]).toSorted()).toEqual([
        ["first", "architect"],
        ["second", "agent"],
      ]);
      expect(yield* fs.exists(NodePath.join(root, "bootstrap-caller"))).toBe(false);
      const wake = yield* service.wake({ name: "second", cwd: root });
      expect(wake.length).toBeGreaterThan(20);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
