import { describe, expect, it, vi } from "vite-plus/test";
import type { AnimaBundle, AnimaCompareResult, EnvironmentId } from "@t3tools/contracts";

import {
  type AnimaSyncPorts,
  invertAnimaRelation,
  planAnimaSync,
  quickAnimaState,
  resolveAnimaSync,
  syncAnima,
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

describe("planAnimaSync", () => {
  it("maps each relation to an action", () => {
    expect(planAnimaSync("missing")).toEqual({ kind: "import", mode: "create" });
    expect(planAnimaSync("incoming-ahead")).toEqual({ kind: "import", mode: "fast-forward" });
    expect(planAnimaSync("identical")).toEqual({ kind: "up-to-date" });
    expect(planAnimaSync("local-ahead")).toEqual({ kind: "destination-ahead" });
    expect(planAnimaSync("diverged")).toEqual({ kind: "needs-choice", reason: "diverged" });
    expect(planAnimaSync("unrelated")).toEqual({ kind: "needs-choice", reason: "unrelated" });
  });
});

describe("syncAnima", () => {
  it("creates a missing anima", async () => {
    const p = ports("missing");
    expect(await syncAnima(request, p.value)).toEqual({ status: "created", output: "ok" });
    expect(p.importBundle).toHaveBeenCalledWith(to, { bundle, mode: "create" });
  });

  it("fast-forwards when incoming is ahead", async () => {
    const p = ports("incoming-ahead");
    expect(await syncAnima(request, p.value)).toMatchObject({ status: "fast-forwarded" });
    expect(p.importBundle).toHaveBeenCalledWith(to, { bundle, mode: "fast-forward" });
  });

  it.each(["identical", "local-ahead"] as const)("does not write for %s", async (relation) => {
    const p = ports(relation);
    const outcome = await syncAnima(request, p.value);
    expect(outcome.status).toBe(relation === "identical" ? "up-to-date" : "destination-ahead");
    expect(p.importBundle).not.toHaveBeenCalled();
  });

  it.each(["diverged", "unrelated"] as const)("returns a choice for %s", async (relation) => {
    const p = ports(relation);
    const outcome = await syncAnima(request, p.value);
    expect(outcome).toMatchObject({ status: "needs-choice", reason: relation, bundle });
    expect(p.importBundle).not.toHaveBeenCalled();
    expect(p.mergeStart).not.toHaveBeenCalled();
  });
});

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
