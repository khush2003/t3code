import { describe, expect, it, vi } from "vite-plus/test";
import type { AnimaBundle, AnimaCompareResult, EnvironmentId } from "@t3tools/contracts";

import {
  type AnimaSyncPorts,
  diffAnimaBundles,
  invertAnimaRelation,
  quickAnimaState,
  resolveAnimaSync,
} from "./animaSync.ts";

const bundle = { name: "ada", digest: "d" } as unknown as AnimaBundle;
const from = "env-a" as EnvironmentId;
const to = "env-b" as EnvironmentId;
const request = { fromEnvironmentId: from, toEnvironmentId: to, name: bundle.name };

function ports(relation: AnimaCompareResult["relation"]) {
  const importBundle = vi.fn(async () => ({ output: "ok", summary: null }));
  const mergeStart = vi.fn(async () => ({ mergeId: "m", threadId: "t", stagingPath: "/s" }));
  const value = {
    exportBundle: vi.fn(async () => bundle),
    compare: vi.fn(async () => ({ relation }) as AnimaCompareResult),
    importBundle,
    mergeStart,
  } as unknown as AnimaSyncPorts;
  return { value, importBundle, mergeStart };
}

describe("resolveAnimaSync", () => {
  it("replaces or starts a merge on the destination", async () => {
    const p = ports("diverged");
    expect(await resolveAnimaSync({ kind: "replace" }, request, bundle, p.value)).toEqual({
      kind: "replaced",
      output: "ok",
    });
    expect(p.importBundle).toHaveBeenCalledWith(to, { bundle, mode: "replace" });
    const projectId = "p1" as never;
    expect(
      await resolveAnimaSync({ kind: "merge", projectId }, request, bundle, p.value),
    ).toMatchObject({ kind: "merging", mergeId: "m" });
    expect(p.mergeStart).toHaveBeenCalledWith(to, { bundle, projectId });
  });
});

describe("helpers", () => {
  it("inverts directional relations only", () => {
    expect(invertAnimaRelation("incoming-ahead")).toBe("local-ahead");
    expect(invertAnimaRelation("local-ahead")).toBe("incoming-ahead");
    expect(invertAnimaRelation("diverged")).toBe("diverged");
  });

  it("classifies summaries without exporting", () => {
    const a = { id: "1", digest: "x" };
    expect(quickAnimaState(a, null)).toBe("only-here");
    expect(quickAnimaState(null, a)).toBe("only-there");
    expect(quickAnimaState(a, { id: "1", digest: "x" })).toBe("identical");
    expect(quickAnimaState(a, { id: "1", digest: "y" })).toBe("different");
    expect(quickAnimaState(a, { id: "2", digest: "x" })).toBe("unrelated");
  });
});

describe("diffAnimaBundles", () => {
  const exportOf = (breaths: ReadonlyArray<string>, files: Record<string, string>) =>
    ({
      breathChain: breaths,
      files: Object.entries(files).map(([path, content]) => ({ path, content })),
    }) as unknown as AnimaBundle;

  it("lists breaths each side lacks, header changes, and file line diffs", () => {
    const source = exportOf(["0:a", "1:b", "2:c"], {
      "agent.anima":
        "# aim: ship\n# vow: up\n0|t0|1,2,3|C4\n1|t1|4,5,6|C4|s|g|first\n2|t2|7,8,9|C4|s|g|second",
      "breaths/2.breath": "x",
      "identity.md": "a\nb\nc\nd\ne\nf\ng\nh",
      "policy.md": "rule",
    });
    const destination = exportOf(["0:a", "1:z"], {
      "agent.anima": "# aim: plan\n# vow: up\n0|t0|1,2,3|C4\n1|t9|0,0,0|C4|s|g|mine",
      "identity.md": "a\nb\nc\nd\ne\nf\nG\nh",
    });
    const diff = diffAnimaBundles(source, destination);
    expect(diff.sharedBreaths).toBe(1);
    expect(diff.sourceOnly).toEqual([
      { index: 2, at: "t2", hsl: "7,8,9", aim: "second" },
      { index: 1, at: "t1", hsl: "4,5,6", aim: "first" },
    ]);
    expect(diff.destinationOnly).toEqual([{ index: 1, at: "t9", hsl: "0,0,0", aim: "mine" }]);
    expect(diff.header).toEqual([{ key: "aim", source: "ship", destination: "plan" }]);
    expect(diff.files.map((file) => [file.path, file.status, file.added, file.removed])).toEqual([
      ["identity.md", "changed", 1, 1],
      ["policy.md", "only-source", 1, 0],
    ]);
    expect(diff.files[0]!.lines).toEqual([
      { kind: "gap", count: 4 },
      { kind: "same", text: "e" },
      { kind: "same", text: "f" },
      { kind: "remove", text: "G" },
      { kind: "add", text: "g" },
      { kind: "same", text: "h" },
    ]);
  });
});
