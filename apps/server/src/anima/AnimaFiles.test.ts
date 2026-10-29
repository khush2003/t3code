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
      friction: null,
      narrativeAim: null,
      self: [],
      corrections: [],
      seeking: null,
      resume: null,
      open: ["first open thing"],
      closedOpens: [],
    });
    expect(AnimaFiles.parseBreathFile(breath(0, "x"), "000.breath")?.parent).toBeNull();
    const current = [
      "# breath:9 ts:2026-07-30T09:38 parent:8 hash:51c1182d5505",
      "# chose a over b,then kept c|dropped d; kept e | the build hid a type error | ship the importer until tests pass",
      "# self: rigor=0.94,autonomy=bad,directness=0.9",
      "# closed-opens: first | second",
      '# corrections: "stop guessing"|verify first; "smaller"|yagni',
    ].join("\n");
    expect(AnimaFiles.parseBreathFile(current, "009.breath")).toMatchObject({
      decisions: ["chose a over b, then kept c", "dropped d", "kept e"],
      friction: "the build hid a type error",
      narrativeAim: "ship the importer until tests pass",
      self: [
        { name: "rigor", mean: 0.94, sigma: null },
        { name: "directness", mean: 0.9, sigma: null },
      ],
      corrections: ['"stop guessing"|verify first', '"smaller"|yagni'],
      closedOpens: ["first", "second"],
    });
    expect(AnimaFiles.parseBreathFile("# breath:3\n# - | - | -\n", "003.breath")).toMatchObject({
      decisions: [],
      friction: null,
      narrativeAim: null,
    });
    expect(
      AnimaFiles.parseBreathFile("# breath:4\n# slug-a,slug-b | - | -\n", "004.breath")?.decisions,
    ).toEqual(["slug-a", "slug-b"]);
    expect(
      AnimaFiles.parseBreathFile(
        "# breath:5\n# decisions: Created a.md (philosophy framework); Created b.md (Act 8)\n",
        "005.breath",
      )?.decisions,
    ).toEqual(["Created a.md (philosophy framework)", "Created b.md (Act 8)"]);
  });

  it("reads tensions whose slugs contain colons", () => {
    expect(AnimaFiles.parseTensions("fix-shipped:needs-restart:10,house(4):9,bad")).toEqual([
      { slug: "fix-shipped:needs-restart", age: 10 },
      { slug: "house(4)", age: 9 },
    ]);
  });

  it("parses policy sections with numbered rules and hook fire stats", () => {
    // `1phfl5w` is hook.ts's hashOf("WHEN a THEN b"); pending rules never count fires.
    const fires = [
      '{"h":"1phfl5w","ts":"2026-07-16T06:33"}',
      "garbage",
      '{"h":"1phfl5w","ts":"2026-07-20T06:35"}',
      '{"h":"other","ts":"2026-07-20T06:36"}',
    ].join("\n");
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
      fires,
    );
    expect(policy.revision).toBe(2);
    expect(policy.operational).toEqual([
      { index: 1, text: "WHEN a THEN b", fires: 2, lastFiredAt: "2026-07-20T06:35" },
      { index: 2, text: "ALWAYS c", fires: 0, lastFiredAt: null },
    ]);
    expect(policy.pending).toEqual([
      { index: 1, text: "NEVER d [proposed by x, 2026-01-01]", fires: 0, lastFiredAt: null },
    ]);
    expect(policy.audit).toEqual(["2|2026-10-26|t3-atlas|added: ALWAYS c"]);
  });

  it("parses JSONL and legacy inbox lines, skipping garbage", () => {
    const inbox = AnimaFiles.parseInbox(
      `{"id":"m_1","ts":"t","from":"a","to":"b","type":"self-aim","body":"hi"}\n{broken\n2026|bob|info|a|b\n{"id":"m_2","ts":"t","from":"b","to":"a","type":"query","body":"re","contextId":"ctx_m_1","replyTo":"m_1","status":"done"}\n`,
    );
    expect(inbox.map((message) => [message.id, message.type, message.body])).toEqual([
      ["m_1", "self-aim", "hi"],
      ["2026:bob", "info", "a|b"],
      ["m_2", "query", "re"],
    ]);
    expect(inbox[0]).toMatchObject({ to: "b", replyTo: null, contextId: null, status: null });
    expect(inbox[2]).toMatchObject({
      to: "a",
      replyTo: "m_1",
      contextId: "ctx_m_1",
      status: "done",
    });
  });

  it("treats a heartbeat older than 90 minutes as stale", () => {
    const now = AnimaFiles.localTimestampMs("2026-10-26T16:00");
    const live = AnimaFiles.parseSession("2026-10-26T15:00|2026-10-26T15:30|/work/x\n", now);
    expect(live).toMatchObject({ live: true, cwd: "/work/x" });
    expect(AnimaFiles.parseSession("2026-10-26T10:00|2026-10-26T10:30|/work/x\n", now)?.live).toBe(
      false,
    );
  });

  it("reads the session project from both the legacy and the packaged CLI formats", () => {
    const now = AnimaFiles.localTimestampMs("2026-10-26T16:00");
    const project = encodeURIComponent(
      JSON.stringify({
        projectPath: "/work/a|b",
        projectName: "a|b",
        source: "explicit",
        recordedAt: "2026-10-26T15:00:00.000Z",
      }),
    );
    const cases: ReadonlyArray<readonly [string, string | null]> = [
      ["2026-10-26T15:00|2026-10-26T15:30|/work/x", "/work/x"],
      ["2026-10-26T15:00|2026-10-26T15:30|/work/a|b", "/work/a|b"],
      [`2026-10-26T15:00|2026-10-26T15:30|${project}`, "/work/a|b"],
      ['2026-10-26T15:00|2026-10-26T15:30|{"projectPath":"/work/y"}', "/work/y"],
      ["2026-10-26T15:00|2026-10-26T15:30|%7Bbroken", null],
      ["2026-10-26T15:00|2026-10-26T15:30", null],
    ];
    for (const [content, cwd] of cases) {
      expect(AnimaFiles.parseSession(`${content}\n`, now)).toMatchObject({ live: true, cwd });
    }
  });

  it("reads a clinic check-in and ignores malformed ones", () => {
    const valid = { version: 1, form: "owl", accent: "#9b82bc", checkedInAt: "x" };
    expect(AnimaFiles.parseAppearance(JSON.stringify(valid))).toEqual({
      form: "owl",
      accent: "#9b82bc",
    });
    for (const bad of [
      { ...valid, version: 2 },
      { ...valid, form: "dragon" },
      { ...valid, accent: "purple" },
      [],
    ]) {
      expect(AnimaFiles.parseAppearance(JSON.stringify(bad))).toBeNull();
    }
    expect(AnimaFiles.parseAppearance("")).toBeNull();
  });

  it("parses opens.json, skipping malformed entries", () => {
    const opens = AnimaFiles.parseOpensFile(
      JSON.stringify([
        {
          id: "open-001",
          question: "Is it done?",
          opened_by: "atlas",
          assigned: "kite",
          opened: "2026-08-06",
          context: "ctx",
          resolves_when: "tests pass",
          related: ["open-002", 3],
          status: "watching",
        },
        { id: "open-002", question: "Why?", assigned: "", resolves_when: "x" },
        { question: "no id" },
        "nope",
      ]),
      "/p/atlas",
    );
    expect(opens).toEqual([
      {
        id: "open-001",
        project: "/p/atlas",
        question: "Is it done?",
        status: "watching",
        assignee: "kite",
        resolves: "tests pass",
        context: "ctx",
        openedBy: "atlas",
        openedAt: "2026-08-06",
        related: ["open-002"],
      },
      {
        id: "open-002",
        project: "/p/atlas",
        question: "Why?",
        status: "active",
        assignee: null,
        resolves: "x",
        context: null,
        openedBy: null,
        openedAt: null,
        related: [],
      },
    ]);
    expect(AnimaFiles.parseOpensFile("{not json", "/p")).toEqual([]);
    expect(AnimaFiles.parseOpensFile('{"id":"open-001"}', "/p")).toEqual([]);
  });

  it("reads card.json loosely and the library title", () => {
    expect(
      AnimaFiles.parseCard(
        JSON.stringify({
          name: "indigo",
          description: "Direct.",
          version: "1.0.0",
          generatedAt: "2026-10-28T10:49",
          skills: [{ name: "a", confidence: 0.95 }, { name: "b" }, null],
          interfaces: ["inbox", 1],
          status: "inactive",
        }),
      ),
    ).toEqual({
      description: "Direct.",
      version: "1.0.0",
      generatedAt: "2026-10-28T10:49",
      skills: [{ name: "a", confidence: 0.95 }],
      interfaces: ["inbox"],
      status: "inactive",
    });
    expect(AnimaFiles.parseCard("[]")).toBeNull();
    expect(AnimaFiles.parseCard("")).toBeNull();
    expect(AnimaFiles.libraryTitle("From: x\n# Codec notes\nbody")).toBe("Codec notes");
    expect(AnimaFiles.libraryTitle("no heading")).toBeNull();
  });
});

describe("health and audit", () => {
  const HEALTH_AGENT = `# anima v1
# id:x1 name:hx born:2026-02-25 breaths:3 accent:#223464
# role: agent
# projects: atlas=C,other=D
# self: rigor=.6±.45~4,warmth=.5±.12,humor=.5±.13,density=.5±.14,certainty=.4
# tension: speed-vs-care:15,scope:3
# circuit: open
# circuit-count: 2
# team: kite, quill
0|2026-03-01T10:00|0.0.50|C4|0.1/0.1/0.1+0/0/0|||
1|2026-03-02T10:00|200,40,60|n1|0.5/0.2/0.1+0/0/0|||
2|2026-03-03T10:00|210,20,40|n2|0.4/0.3/0.3+0/0/0|||
3|2026-03-04T10:00|90,10,30|n3|0.1/0.3/0.5+0/0/0|g|aim|p
`;

  it("matches the CLI's assessHealth on the same anima", () => {
    // Expected values come from running the anima CLI's assessHealth on this fixture at this time.
    const health = AnimaFiles.assessHealth({
      agentContent: HEALTH_AGENT,
      latestBreathFile: "",
      nowMs: AnimaFiles.localTimestampMs("2026-03-04T20:00"),
    });
    expect(health?.score).toBeCloseTo(0.81375, 10);
    expect(health).toMatchObject({
      action: "proactive",
      maxNegStreak: 4,
      maxTensionAge: 15,
      reasons: ["uncertainty: σ=0.45", "neg-streak: 4", "stale-tension: age 15"],
      warnings: [
        "coupling climbing fast",
        "very diffuse focus",
        "vitality low",
        "vitality declining",
        "recognition deficit: 3 traits at σ floor",
      ],
    });
    expect(health?.components.drift).toBe(1);
    expect(health?.silenceHours).toBeCloseTo(10, 10);
    expect(AnimaFiles.parseAgentFile(HEALTH_AGENT)).toMatchObject({
      circuit: "open",
      circuitCount: 2,
      team: ["kite", "quill"],
    });
    expect(
      AnimaFiles.assessHealth({ agentContent: "# anima v1\n", latestBreathFile: "", nowMs: 0 }),
    ).toBeNull();
  });

  it("falls back to the latest breath file and damps drift while recently active", () => {
    const untimed = HEALTH_AGENT.replace(
      "3|2026-03-04T10:00|90,10,30|n3|0.1/0.3/0.5+0/0/0|g|aim|p",
      "3|90,10,30|n3",
    );
    const health = AnimaFiles.assessHealth({
      agentContent: untimed,
      latestBreathFile: "# breath:3 ts:2026-03-04T19:00 parent:2 hash:h\n",
      nowMs: AnimaFiles.localTimestampMs("2026-03-04T20:00"),
    });
    expect(health?.silenceHours).toBeCloseTo(1, 10);
    expect(health?.components.drift).toBeCloseTo(0.2, 10);
  });

  it("reports the CLI's audit findings", () => {
    const agent = [
      "# anima v1",
      "# id:x name:a born:2026-01-01 breaths:3",
      "0|2026-01-01T10:00|0.0.50|C4|0.1/0.1/0.1+0/0/0|||",
      "1|2026-01-02T10:00|x,1,2|n|0.1/a/0.1|" + "k:".repeat(40) + "||",
      "2|2026-01-03T10:00|1,2,3|" + "n".repeat(400) + "|0.1/0.1/0.1|||",
    ].join("\n");
    const findings = AnimaFiles.auditAnima({
      agentContent: agent,
      breathFiles: new Map([
        ["000.breath", "# breath:0\n# decisions: genesis\n"],
        ["001.breath", "# breath:1\n# decisions: \n"],
      ]),
      hasIdentity: false,
    });
    expect(findings).toEqual([
      {
        level: "error",
        message: "breath count mismatch: header says 3, found 3 data lines (expected 4)",
      },
      { level: "info", message: "breath 0: dot-separated HSL" },
      { level: "error", message: "breath 1: NaN in HSL (x,1,2)" },
      { level: "warn", message: "breath 1: NaN in shape/drift" },
      { level: "info", message: "breath 1: graph not compressed (80 chars)" },
      { level: "info", message: "breath 1: empty decisions in detail file" },
      { level: "warn", message: "breath 2: line length 440 (>400)" },
      { level: "warn", message: "breath 2: missing detail file" },
      { level: "warn", message: "no identity.md" },
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
    expect(AnimaFiles.isBundlePath("appearance.json")).toBe(true);
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
      appearance: null,
      digest: built.digest,
      health: 0.25,
    });
    expect(summary).toMatchObject({
      name: "atlas",
      breathCount: 2,
      aim: "consolidate types",
      lastBreathAt: "2026-03-12T19:08",
      lastActiveAt: "2026-03-12T19:08",
      voice: "Speaks slowly. Precise.",
      live: false,
      health: 0.25,
    });
    expect(summary.topSkills.map((skill) => skill.name)).toEqual([
      "typescript",
      "type-design",
      "vite",
    ]);
    expect(summary.form).toBeNull();
    const checkedIn = AnimaFiles.buildSummary({
      name: "atlas",
      agent: AnimaFiles.parseAgentFile(built.files[0]!.content),
      identity: "",
      policy: AnimaFiles.parsePolicy(""),
      inbox: [],
      session: null,
      appearance: { form: "fox", accent: "#ff8800" },
      digest: built.digest,
      health: null,
    });
    expect(checkedIn).toMatchObject({ form: "fox", accent: "#ff8800" });
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
