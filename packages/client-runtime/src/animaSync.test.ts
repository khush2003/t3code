import { describe, expect, it, vi } from "vite-plus/test";
import type { AnimaBundle, AnimaCompareResult, EnvironmentId } from "@t3tools/contracts";

import {
  type AnimaSyncPorts,
  diffAnimaBundles,
  quickAnimaState,
  syncAnimaPair,
} from "./animaSync.ts";

const bundle = { name: "ada", digest: "d" } as unknown as AnimaBundle;
const from = "env-a" as EnvironmentId;
const to = "env-b" as EnvironmentId;
describe("helpers", () => {
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
    const source = exportOf(["0:a", "1:b", "2:c", "3:d"], {
      "agent.anima":
        "# aim: ship\n# vow: up\n0|t0|1,2,3|C4\n1|t1|4,5,6|C4|s|g|first\n2|t2|7,8,9|C4|s|g|second",
      "breaths/2.breath": "x",
      "breaths/3.breath":
        "# breath:3 ts:t3 parent:2 hash:d\n# closed the loop | because\n# self: a=1",
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
      { index: 3, at: "t3", hsl: null, aim: "closed the loop" },
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

describe("syncAnimaPair", () => {
  const name = bundle.name;
  const pair = (compare: Partial<AnimaCompareResult>) => {
    const exports = new Map<string, AnimaBundle>([
      [from, { ...bundle, digest: "a" }],
      [to, { ...bundle, digest: "b" }],
    ]);
    const importBundle = vi.fn(async () => ({ output: "ok", summary: null }));
    const value = {
      exportBundle: vi.fn(async (environmentId: EnvironmentId) => exports.get(environmentId)!),
      compare: vi.fn(async () => ({ relation: "diverged", ...compare }) as AnimaCompareResult),
      importBundle,
      mergeStart: vi.fn(),
    } as unknown as AnimaSyncPorts;
    return { value, importBundle, exports };
  };
  const both = { first: true, second: true };

  it("merges into the first machine, then hands the result to the second", async () => {
    const p = pair({ conflicts: [] });
    p.importBundle.mockImplementationOnce(async () => {
      p.exports.set(from, { ...bundle, digest: "merged" });
      return { output: "ok", summary: null };
    });
    expect(await syncAnimaPair({ name, first: from, second: to, present: both }, p.value)).toEqual({
      status: "synced",
    });
    expect(p.importBundle.mock.calls).toEqual([
      [from, { bundle: { ...bundle, digest: "b" }, mode: "merge" }],
      [to, { bundle: { ...bundle, digest: "merged" }, mode: "fast-forward" }],
    ]);
  });

  it("stops without writing at conflicts or a different anima", async () => {
    const conflict = { path: "identity.md", key: null, local: "a", incoming: "b", draft: "a" };
    const conflicted = pair({ conflicts: [conflict] });
    expect(
      await syncAnimaPair({ name, first: from, second: to, present: both }, conflicted.value),
    ).toEqual({ status: "conflicts", conflicts: [conflict] });
    const unrelated = pair({ relation: "unrelated" });
    expect(
      await syncAnimaPair({ name, first: from, second: to, present: both }, unrelated.value),
    ).toEqual({ status: "unrelated" });
    expect(conflicted.importBundle).not.toHaveBeenCalled();
    expect(unrelated.importBundle).not.toHaveBeenCalled();
  });

  it("creates the anima only where an export finds nothing", async () => {
    const p = pair({});
    p.exports.delete(from);
    vi.mocked(p.value.exportBundle).mockImplementation(async (environmentId) => {
      const found = p.exports.get(environmentId);
      if (!found) throw new Error("not found");
      return found;
    });
    await syncAnimaPair(
      { name, first: from, second: to, present: { first: false, second: true } },
      p.value,
    );
    expect(p.importBundle).toHaveBeenCalledWith(from, {
      bundle: { ...bundle, digest: "b" },
      mode: "create",
    });
  });

  it("merges when a list says an anima is missing but the machine has it", async () => {
    const p = pair({ conflicts: [] });
    await syncAnimaPair(
      { name, first: from, second: to, present: { first: true, second: false } },
      p.value,
    );
    expect(p.importBundle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: "create" }),
    );
    expect(p.importBundle).toHaveBeenCalledWith(from, {
      bundle: { ...bundle, digest: "b" },
      mode: "merge",
    });
  });
});
