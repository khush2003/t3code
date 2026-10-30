// @effect-diagnostics nodeBuiltinImport:off -- tests seed fixture trees and probe for the real CLI synchronously
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { AnimaName, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as NodePath from "node:path";

import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as AnimaMergeService from "./AnimaMergeService.ts";
import * as AnimaService from "./AnimaService.ts";

const agent = (breaths: number, id = "id-atlas") =>
  `# anima v1
# id:${id} name:atlas born:2026-02-25 breaths:${breaths} accent:#223464
# role: agent
${Array.from({ length: breaths + 1 }, (_, n) => `${n}|2026-03-0${n + 1}T10:00|0,0,50|note ${n}|0.1/0.1/0.1+0/0/0|||`).join("\n")}
`;
const breath = (n: number, hash: string) =>
  `# breath:${n} ts:2026-03-0${n + 1}T10:00 parent:${n - 1} hash:${hash}\n# files:\n# decisions: d\n# open:\n`;

const tree = (hashes: ReadonlyArray<string>, id = "id-atlas") => [
  { path: "agent.anima", content: agent(hashes.length - 1, id) },
  { path: "identity.md", content: "# atlas\n\n## voice\nx\n" },
  {
    path: "policy.md",
    content:
      "# Policy: atlas\n# rev: 1 updated: 2026-01-01 by: atlas\n\n## Operational\nALWAYS a\n",
  },
  ...hashes.map((hash, n) => ({
    path: `breaths/${String(n).padStart(3, "0")}.breath`,
    content: breath(n, hash),
  })),
];

const launched: Array<ThreadLaunchService.ThreadLaunchInput> = [];

const run = <A, E>(
  body: (input: {
    readonly merge: AnimaMergeService.AnimaMergeService["Service"];
    readonly animas: AnimaService.AnimaService["Service"];
    readonly root: string;
  }) => Effect.Effect<A, E, FileSystem.FileSystem>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "anima-merge-" });
    const root = NodePath.join(home, ".claude", "anima");
    yield* fs.makeDirectory(root, { recursive: true });
    launched.length = 0;
    const projectStore = Layer.mock(ProjectStore.ProjectStoreV2)({
      get: (projectId) =>
        Effect.succeed(
          projectId === "p1"
            ? Option.some({
                workspaceRoot: "/work",
                defaultModelSelection: { instanceId: "codex", model: "gpt" },
              } as unknown as ProjectStore.ProjectRow)
            : Option.none(),
        ),
    });
    const launch = Layer.mock(ThreadLaunchService.ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          launched.push(input);
          return {} as never;
        }),
    });
    const base = Layer.mergeAll(
      projectStore,
      launch,
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/named",
        ensureScratchProject: Effect.succeed({ projectId: ProjectId.make("p1") }),
      }),
      Layer.mock(ProviderRegistry.ProviderRegistry)({ getProviders: Effect.succeed([]) }),
      ServerSettings.layerTest(),
      Layer.succeed(HostProcess.HomeDirectory, home),
      Layer.succeed(ProcessRunner.ProcessRunner, { run: () => Effect.die("no cli") }),
    );
    const animaLayer = AnimaService.layer.pipe(Layer.provide(base));
    const layer = Layer.merge(
      animaLayer,
      AnimaMergeService.layer.pipe(Layer.provide(Layer.merge(base, animaLayer))),
    );
    const context = yield* Layer.build(layer);
    const merge = yield* AnimaMergeService.AnimaMergeService.pipe(Effect.provide(context));
    const animas = yield* AnimaService.AnimaService.pipe(Effect.provide(context));
    return yield* body({ merge, animas, root });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("AnimaMergeService", () => {
  it.effect("stages, launches, reports status and applies a finished merge", () =>
    run(({ merge, animas, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* animas.install({ name: "atlas", files: tree(["h0", "h1", "x"]) });
        const incoming = {
          version: 1 as const,
          name: "atlas",
          id: "id-atlas",
          digest: "ignored",
          exportedAt: "2026-03-01T00:00:00Z",
          breathChain: [],
          files: tree(["h0", "h1", "y", "z"]),
        };

        const started = yield* merge.start({
          bundle: incoming,
          projectId: ProjectId.make("p1"),
          localLabel: "pop-os",
          incomingLabel: "hetzner",
        });
        expect(started.stagingPath).toBe(NodePath.join(root, ".merge", started.mergeId));
        expect(launched).toHaveLength(1);
        expect(launched[0]).toMatchObject({
          commandId: `anima-merge:${started.mergeId}`,
          threadId: started.threadId,
          projectId: "p1",
          workspaceStrategy: { type: "root" },
          creationSource: "server",
        });
        expect(launched[0]?.initialMessage?.text).toContain("MERGE.md");
        const instructions = yield* fs.readFileString(
          NodePath.join(started.stagingPath, "MERGE.md"),
        );
        expect(instructions).toContain("1 only here");
        expect(instructions).toContain("question tool");
        expect(instructions).toContain(`"Keep pop-os's version", "Keep hetzner's version"`);
        expect(
          yield* fs.exists(NodePath.join(started.stagingPath, "incoming", "breaths", "003.breath")),
        ).toBe(true);
        const draft = (file: string) =>
          fs.readFileString(NodePath.join(started.stagingPath, "merged", file));
        expect(yield* draft("agent.anima")).toContain("breaths:4");
        expect(yield* draft("breaths/004.breath")).toContain(
          "# breath:4 ts:2026-03-04T10:00 parent:3 hash:z",
        );

        expect((yield* merge.status({ mergeId: started.mergeId })).state).toBe("running");
        const early = yield* Effect.flip(merge.apply({ mergeId: started.mergeId }));
        expect(early._tag).toBe("AnimaCommandRejectedError");

        const mergedFiles = tree(["h0", "h1", "x", "y", "z"]);
        for (const file of mergedFiles) {
          const target = NodePath.join(started.stagingPath, "merged", file.path);
          yield* fs.makeDirectory(NodePath.dirname(target), { recursive: true });
          yield* fs.writeFileString(target, file.content);
        }
        yield* fs.writeFileString(NodePath.join(started.stagingPath, "merged", "DONE"), "");
        expect((yield* merge.status({ mergeId: started.mergeId })).state).toBe("ready");
        // A reopened Sync tab finds the merge by the anima's name alone.
        expect(yield* merge.status({ name: AnimaName.make("atlas") })).toMatchObject({
          mergeId: started.mergeId,
          state: "ready",
        });

        yield* merge.apply({ mergeId: started.mergeId });
        expect((yield* animas.get({ name: "atlas" })).summary.breathCount).toBe(4);
        expect((yield* merge.status({ mergeId: started.mergeId })).state).toBe("applied");
        expect(yield* fs.readDirectory(NodePath.join(root, ".backups"))).toHaveLength(1);
        const again = yield* Effect.flip(merge.apply({ mergeId: started.mergeId }));
        expect(again._tag).toBe("AnimaCommandRejectedError");
      }),
    ),
  );

  it.effect("refuses unrelated animas, unsafe merged trees and unknown or malformed ids", () =>
    run(({ merge, animas, root }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* animas.install({ name: "atlas", files: tree(["h0"]) });
        const other = {
          version: 1 as const,
          name: "atlas",
          id: "other",
          digest: "",
          exportedAt: "",
          breathChain: [],
          files: tree(["h0"], "other"),
        };
        const unrelated = yield* Effect.flip(
          merge.start({ bundle: other, projectId: ProjectId.make("p1") }),
        );
        expect(unrelated._tag).toBe("AnimaCommandRejectedError");
        expect(launched).toHaveLength(0);

        const started = yield* merge.start({
          bundle: { ...other, id: "id-atlas", files: tree(["h0", "n"]) },
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "luna" },
        });
        expect(launched[0]).toMatchObject({
          projectId: "p1",
          modelSelection: { instanceId: "codex", model: "luna" },
        });
        const merged = NodePath.join(started.stagingPath, "merged");
        for (const file of tree(["h0", "n"])) {
          const target = NodePath.join(merged, file.path);
          yield* fs.makeDirectory(NodePath.dirname(target), { recursive: true });
          yield* fs.writeFileString(target, file.content);
        }
        yield* fs.writeFileString(NodePath.join(merged, "DONE"), "");
        yield* fs.symlink("/etc/hostname", NodePath.join(merged, "skills-link.md"));
        const unsafe = yield* Effect.flip(merge.apply({ mergeId: started.mergeId }));
        expect(unsafe._tag).toBe("AnimaCommandRejectedError");
        expect((yield* animas.get({ name: "atlas" })).summary.breathCount).toBe(0);

        for (const bad of ["../x", "nope", ""]) {
          const error = yield* Effect.flip(merge.status({ mergeId: bad }));
          expect(error._tag).toBe("AnimaNotFoundError");
        }
        expect(yield* fs.exists(NodePath.join(root, ".merge", started.mergeId, "APPLIED"))).toBe(
          false,
        );
      }),
    ),
  );
});
