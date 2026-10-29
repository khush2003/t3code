import { describe, expect, it } from "@effect/vitest";
import type { AnimaBundleFile } from "@t3tools/contracts";

import { breathChain, relationBetween } from "./AnimaFiles.ts";
import { mergeAnimaFiles } from "./AnimaMerge.ts";

type Breath = { readonly hash: string; readonly ts: string; readonly aim: string };

const anima = (input: {
  readonly breaths: ReadonlyArray<Breath>;
  readonly header?: Record<string, string>;
  readonly identity?: string;
  readonly policy?: ReadonlyArray<string>;
}): ReadonlyArray<AnimaBundleFile> => {
  const last = input.breaths.length - 1;
  const header = Object.entries(input.header ?? {}).map(([key, value]) => `# ${key}: ${value}`);
  return [
    {
      path: "agent.anima",
      content: [
        "# anima v1",
        `# id:a1 name:ada born:2026-01-01 breaths:${last} accent:#000000`,
        ...header,
        ...input.breaths.map((b, n) => `${n}|${b.ts}|1,2,3|C4|s|1D|${b.aim}`),
        "",
      ].join("\n"),
    },
    { path: "identity.md", content: input.identity ?? "# ada\n" },
    {
      path: "policy.md",
      content: ["# Policy: ada", "# rev: 3 updated: x by: ada", "", "## Operational"]
        .concat(input.policy ?? ["ALWAYS a"])
        .join("\n"),
    },
    ...input.breaths.map((b, n) => ({
      path: `breaths/${String(n).padStart(3, "0")}.breath`,
      content: `# breath:${n} ts:${b.ts} parent:${n === 0 ? "-" : n - 1} hash:${b.hash}\n# ${b.aim}\n`,
    })),
  ];
};

const file = (files: ReadonlyArray<AnimaBundleFile>, path: string) =>
  files.find((entry) => entry.path === path)?.content;

const shared: ReadonlyArray<Breath> = [
  { hash: "h0", ts: "2026-01-01T10:00", aim: "born" },
  { hash: "h1", ts: "2026-01-02T10:00", aim: "shared" },
];

describe("mergeAnimaFiles", () => {
  it("keeps every breath from both lineages, ordered by time after the shared prefix", () => {
    const local = anima({
      breaths: [...shared, { hash: "l1", ts: "2026-01-05T10:00", aim: "local later" }],
      header: { memo: "local memo", self: "rigor=.8±.2,care=.5±.1", kin: "ion=sibling.2" },
    });
    const incoming = anima({
      breaths: [
        ...shared,
        { hash: "i1", ts: "2026-01-03T10:00", aim: "there first" },
        { hash: "i2", ts: "2026-01-06T10:00", aim: "there last" },
      ],
      header: { memo: "there memo", self: "rigor=.9±.1,care=.4±.3", kin: "zed=peer.1" },
    });
    const { files, conflicts } = mergeAnimaFiles({ local, incoming, base: null });
    expect(conflicts).toEqual([]);
    expect(breathChain(files)).toEqual(["0:h0", "1:h1", "2:i1", "3:l1", "4:i2"]);
    expect(file(files, "breaths/003.breath")).toBe(
      "# breath:3 ts:2026-01-05T10:00 parent:2 hash:l1\n# local later\n",
    );
    const agent = file(files, "agent.anima")!;
    expect(agent).toContain("breaths:4");
    expect(agent).toContain("3|2026-01-05T10:00|1,2,3|C4|s|1D|local later");
    // The newest breath is the other machine's, so its CLI state wins.
    expect(agent).toContain("# memo: there memo");
    // Per trait, the lower sigma; lists combine.
    expect(agent).toContain("# self: rigor=.9±.1,care=.5±.1");
    expect(agent).toContain("# kin: ion=sibling.2,zed=peer.1");
  });

  it("takes one-sided changes since the base and flags voice changed on both sides", () => {
    const base = anima({ breaths: shared, header: { vow: "up", role: "builder" } });
    const local = anima({
      breaths: [...shared, { hash: "l1", ts: "2026-01-04T10:00", aim: "l" }],
      header: { vow: "up always", role: "builder" },
    });
    const incoming = anima({
      breaths: [...shared, { hash: "i1", ts: "2026-01-03T10:00", aim: "i" }],
      header: { vow: "up", role: "architect" },
    });
    const clean = mergeAnimaFiles({ local, incoming, base });
    expect(clean.conflicts).toEqual([]);
    expect(file(clean.files, "agent.anima")).toContain("# vow: up always\n# role: architect");

    const both = mergeAnimaFiles({
      local,
      incoming: anima({
        breaths: [...shared, { hash: "i1", ts: "2026-01-03T10:00", aim: "i" }],
        header: { vow: "down", role: "builder" },
        identity: "# ada\nchanged there\n",
      }),
      base: null,
    });
    expect(both.conflicts.map((conflict) => conflict.key ?? conflict.path)).toEqual([
      "vow",
      "identity.md",
    ]);
    expect(both.conflicts[0]).toMatchObject({ local: "up always", incoming: "down" });
  });

  it("merges policy rules three-way: additions from both, removals stick", () => {
    const base = anima({ breaths: shared, policy: ["ALWAYS a", "NEVER b"] });
    const local = anima({
      breaths: [...shared, { hash: "l1", ts: "2026-01-04T10:00", aim: "l" }],
      policy: ["ALWAYS a", "NEVER b", "ALWAYS local"],
    });
    const incoming = anima({
      breaths: [...shared, { hash: "i1", ts: "2026-01-03T10:00", aim: "i" }],
      policy: ["ALWAYS a", "ALWAYS there"],
    });
    const policy = file(mergeAnimaFiles({ local, incoming, base }).files, "policy.md")!;
    expect(policy.split("\n")).toEqual([
      "# Policy: ada",
      "# rev: 4 updated: x by: ada",
      "",
      "## Operational",
      "ALWAYS a",
      "ALWAYS local",
      "ALWAYS there",
    ]);
  });

  it("is settled once merged: the other side is then simply behind", () => {
    const local = anima({
      breaths: [...shared, { hash: "l1", ts: "2026-01-05T10:00", aim: "l" }],
    });
    const incoming = anima({
      breaths: [...shared, { hash: "i1", ts: "2026-01-03T10:00", aim: "i" }],
    });
    const merged = mergeAnimaFiles({ local, incoming, base: null }).files;
    const comparable = (files: ReadonlyArray<AnimaBundleFile>) => ({
      id: "a1",
      digest: String(files.length),
      chain: breathChain(files),
      files,
    });
    expect(relationBetween(comparable(incoming), comparable(merged)).relation).toBe(
      "incoming-ahead",
    );
    const again = mergeAnimaFiles({ local: merged, incoming, base: merged }).files;
    expect(again).toEqual(merged);
  });
});
