import { describe, expect, it } from "@effect/vitest";

import * as AnimaFiles from "./AnimaFiles.ts";

const AGENT = `# anima v1
# id:41d9555aef07 name:atlas born:2026-02-25 breaths:2 accent:#223464
# parent:56bdf06b71d5
# role: agent
# projects: atlas=C,other=D
# self: architecture=.77±.15~1,systems_thinking=.90±.14!
# skills: typescript=.88±.15,type-design=.85±.20,vite=.30
# memo: Types complete.
# vow:
0|2026-02-25T23:13|0,0,50|C4.M.20.0.3.60|0.1/0.1/0.1+0/0/0|||
1|2026-02-26T08:47|0,0,50|Review phase complete.|0.8/0.7/0.5+0.7/0.6/0.4|
2|2026-03-12T19:08|210,75,65|C4.M.60.1.2.80|0.7/0.6/0.3+-0.1/-0.1/-0.2|a:D,b:?|consolidate types|proj
`;

const breath = (index: number, hash: string, extra = "") =>
  `# breath:${index} ts:2026-03-19T17:29 parent:${index === 0 ? "-" : index - 1} hash:${hash}
# files: a.ts b.ts
# decisions: one two three
# open: first open thing
${extra}`;

const file = (path: string, content: string) => ({ path, content });

const anima = (hashes: ReadonlyArray<string>, extra: ReadonlyArray<string> = []) => {
  const files = [
    file("agent.anima", AGENT.replace("breaths:2", `breaths:${hashes.length - 1}`)),
    file("identity.md", "# atlas\n\n## voice\nSpeaks slowly.\nPrecise.\n\n## values\nKind.\n"),
    file("policy.md", "# Policy: atlas\n# rev: 1 updated: 2026-01-01 by: atlas\n"),
    ...hashes.map((hash, index) =>
      file(`breaths/${String(index).padStart(3, "0")}.breath`, breath(index, hash)),
    ),
    ...extra.map((path) => file(path, "x")),
  ];
  return { files, digest: AnimaFiles.digestFiles(files), chain: AnimaFiles.breathChain(files) };
};

describe("parseAgentFile", () => {
  const parsed = AnimaFiles.parseAgentFile(AGENT);

  it("reads the identity line and headers without a space after the colon", () => {
    expect(parsed).toMatchObject({
      id: "41d9555aef07",
      name: "atlas",
      born: "2026-02-25",
      breaths: 2,
      accent: "#223464",
      parent: "56bdf06b71d5",
      role: "agent",
      enabled: true,
      memo: "Types complete.",
      vow: null,
      projects: ["atlas", "other"],
    });
  });

  it("parses rows with and without trailing fields", () => {
    expect(parsed.rows.map((row) => [row.index, row.aim, row.project])).toEqual([
      [0, null, null],
      [1, null, null],
      [2, "consolidate types", "proj"],
    ]);
    expect(parsed.rows[1]?.ts).toBe("2026-02-26T08:47");
  });

  it("parses Kalman traits and drops markers", () => {
    expect(parsed.traits).toEqual([
      { name: "architecture", mean: 0.77, sigma: 0.15 },
      { name: "systems_thinking", mean: 0.9, sigma: 0.14 },
    ]);
    expect(parsed.skills[2]).toEqual({ name: "vite", mean: 0.3, sigma: null });
  });

  it("honours active: false", () => {
    expect(AnimaFiles.parseAgentFile("# anima v1\n# active: false\n").enabled).toBe(false);
  });
});

describe("identity, breath, policy, inbox, session", () => {
  it("takes the first voice paragraph", () => {
    expect(AnimaFiles.parseIdentityVoice(anima(["a"]).files[1]!.content)).toBe(
      "Speaks slowly. Precise.",
    );
    expect(AnimaFiles.parseIdentityVoice("# x\n")).toBeNull();
  });

  it("parses breath files", () => {
    expect(AnimaFiles.parseBreathFile(breath(8, "223464d76ec4"), "008.breath")).toEqual({
      index: 8,
      ts: "2026-03-19T17:29",
      hash: "223464d76ec4",
      parent: "7",
      files: ["a.ts", "b.ts"],
      decisions: ["one", "two", "three"],
      open: ["first open thing"],
    });
    expect(AnimaFiles.parseBreathFile(breath(0, "x"), "000.breath")?.parent).toBeNull();
  });

  it("parses policy sections with numbered rules", () => {
    const policy = AnimaFiles.parsePolicy(
      `# Policy: t3-atlas
# rev: 2 updated: 2026-10-26 by: t3-atlas

## Operational
WHEN a THEN b
ALWAYS c

## Pending
NEVER d [proposed by x, 2026-01-01]

## Audit
2|2026-10-26|t3-atlas|added: ALWAYS c
`,
    );
    expect(policy.revision).toBe(2);
    expect(policy.operational).toEqual([
      { index: 1, text: "WHEN a THEN b" },
      { index: 2, text: "ALWAYS c" },
    ]);
    expect(policy.pending).toHaveLength(1);
    expect(policy.audit).toEqual(["2|2026-10-26|t3-atlas|added: ALWAYS c"]);
  });

  it("parses JSONL and legacy inbox lines, skipping garbage", () => {
    const inbox = AnimaFiles.parseInbox(
      `{"id":"m_1","ts":"t","from":"a","to":"b","type":"self-aim","body":"hi"}\n{broken\n2026|bob|info|a|b\n`,
    );
    expect(inbox.map((message) => [message.id, message.type, message.body])).toEqual([
      ["m_1", "self-aim", "hi"],
      ["2026:bob", "info", "a|b"],
    ]);
  });

  it("treats a heartbeat older than 90 minutes as stale", () => {
    const now = AnimaFiles.localTimestampMs("2026-10-26T16:00");
    const live = AnimaFiles.parseSession("2026-10-26T15:00|2026-10-26T15:30|/work/x\n", now);
    expect(live).toMatchObject({ live: true, cwd: "/work/x" });
    expect(AnimaFiles.parseSession("2026-10-26T10:00|2026-10-26T10:30|/work/x\n", now)?.live).toBe(
      false,
    );
  });

  it("parses opens list output", () => {
    expect(
      AnimaFiles.parseOpensListOutput(
        "\natlas (/p/atlas):\n  open-001 [t3-atlas]: Is it done?\n  open-002 [x] [blocked]: Why?\n",
      ),
    ).toEqual([
      {
        id: "open-001",
        project: "/p/atlas",
        question: "Is it done?",
        status: "active",
        assignee: "t3-atlas",
      },
      { id: "open-002", project: "/p/atlas", question: "Why?", status: "blocked", assignee: "x" },
    ]);
  });
});

describe("bundle paths and digest", () => {
  it("rejects paths that could escape the anima directory", () => {
    for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a//b", "a\\b", "", "./a"]) {
      expect(AnimaFiles.isSafeRelativePath(bad)).toBe(false);
    }
    expect(AnimaFiles.isBundlePath("breaths/000.breath")).toBe(true);
    expect(AnimaFiles.isBundlePath("skills/a/b.md")).toBe(true);
    expect(AnimaFiles.isBundlePath("session")).toBe(false);
    expect(AnimaFiles.isBundlePath("evil.sh")).toBe(false);
  });

  it("ignores volatile files, skills and order in the digest", () => {
    const base = anima(["a", "b"]);
    const shuffled = AnimaFiles.digestFiles([...base.files].reverse());
    const noisy = AnimaFiles.digestFiles([
      ...base.files,
      file("session", "now"),
      file("inbox", "{}"),
      file("agent.anima.pre-repair-2026", "old"),
      file("skills/a.md", "skill"),
    ]);
    expect(shuffled).toBe(base.digest);
    expect(noisy).toBe(base.digest);
    expect(AnimaFiles.digestFiles([...base.files, file("policy.md", "other")])).not.toBe(
      base.digest,
    );
  });
});

describe("compareAnimas", () => {
  const make = (id: string, hashes: ReadonlyArray<string>, extra?: Array<string>) => {
    const built = anima(hashes, extra);
    return {
      id,
      digest: built.digest,
      chain: built.chain,
      files: built.files,
    };
  };

  it("reports each relation", () => {
    const base = make("id1", ["a", "b"]);
    expect(AnimaFiles.compareAnimas(null, base).relation).toBe("missing");
    expect(AnimaFiles.compareAnimas(base, make("id1", ["a", "b"])).relation).toBe("identical");
    expect(AnimaFiles.compareAnimas(base, make("id2", ["a", "b"])).relation).toBe("unrelated");
    expect(AnimaFiles.compareAnimas(base, make("id1", ["a", "b", "c"]))).toMatchObject({
      relation: "incoming-ahead",
      commonBreath: 1,
      incomingOnlyBreaths: 1,
      localOnlyBreaths: 0,
      changedFiles: ["agent.anima", "breaths/002.breath"],
    });
    expect(AnimaFiles.compareAnimas(make("id1", ["a", "b", "c"]), base).relation).toBe(
      "local-ahead",
    );
    expect(
      AnimaFiles.compareAnimas(make("id1", ["a", "b", "x"]), make("id1", ["a", "b", "y"])),
    ).toMatchObject({
      relation: "diverged",
      commonBreath: 1,
      localOnlyBreaths: 1,
      incomingOnlyBreaths: 1,
    });
  });
});

describe("validateAnimaTree", () => {
  it("accepts a coherent tree and flags mismatches", () => {
    const good = anima(["a", "b", "c"]);
    expect(
      AnimaFiles.validateAnimaTree(good.files, { name: "atlas", id: "41d9555aef07" }),
    ).toBeNull();
    expect(
      AnimaFiles.validateAnimaTree([...good.files, file("../x", "")], { name: "atlas" }),
    ).toContain("not allowed");
    expect(AnimaFiles.validateAnimaTree(good.files.slice(0, -1), { name: "atlas" })).toContain(
      "declares 2 breaths",
    );
    expect(AnimaFiles.validateAnimaTree(good.files, { name: "other" })).toContain("name");
  });
});

describe("buildSummary", () => {
  it("assembles summary fields", () => {
    const built = anima(["a", "b", "c"]);
    const summary = AnimaFiles.buildSummary({
      name: "atlas",
      agent: AnimaFiles.parseAgentFile(built.files[0]!.content),
      identity: built.files[1]!.content,
      policy: AnimaFiles.parsePolicy(built.files[2]!.content),
      inbox: [],
      session: null,
      digest: built.digest,
    });
    expect(summary).toMatchObject({
      name: "atlas",
      breathCount: 2,
      aim: "consolidate types",
      lastBreathAt: "2026-03-12T19:08",
      voice: "Speaks slowly. Precise.",
      live: false,
    });
    expect(summary.topSkills.map((skill) => skill.name)).toEqual([
      "typescript",
      "type-design",
      "vite",
    ]);
  });
});

describe("stripFrontmatter and buildIdentityCapsule", () => {
  it("drops a leading frontmatter block only", () => {
    expect(AnimaFiles.stripFrontmatter("---\nname: a\n---\n\n# a\nhi\n")).toBe("# a\nhi");
    expect(AnimaFiles.stripFrontmatter("# a\n---\nnot front\n---\n")).toBe(
      "# a\n---\nnot front\n---",
    );
  });

  it("builds a capsule with voice, refusals, memo and the latest aim", () => {
    const agent = [
      "# anima v1",
      "# id:x name:iris born:2026-01-01 breaths:2 accent:#112233",
      "# role: lead",
      "# vow: Be exact.",
      "# style: terse",
      "# biases: prefers tests",
      "# memo: remember",
      "0|2026-01-01T10:00|0.0.50|C4.M.20.0.3.60|0.1/0.1/0.1+0/0/0|||",
      "2|2026-01-02T10:00|0.0.50|C4.M.20.0.3.60|0.1/0.1/0.1+0/0/0||Ship the fix and run tests|p",
    ].join("\n");
    const identity = "## voice\nx\n## refusals\n- no guessing\n- no padding\n## other\n- nope\n";
    const capsule = AnimaFiles.buildIdentityCapsule("iris", agent, identity);
    expect(capsule).toContain("you are iris (lead, 2 breaths)");
    for (const line of [
      "Vow: Be exact.",
      "Voice: terse",
      "Biases: prefers tests",
      "Refusal: no guessing",
      "Refusal: no padding",
      "Memo: remember",
      "Aim: Ship the fix and run tests",
    ])
      expect(capsule).toContain(line);
    expect(capsule).not.toContain("nope");
  });
});
