import { describe, expect, it } from "@effect/vitest";

import * as AnimaPolicyMatch from "./AnimaPolicyMatch.ts";

// Real rule shapes from ~/.claude/anima/*/policy.md.
const RESTART_RULE =
  "WHEN I need to restart t3code.service (or any service whose ExecStart is the claude process I run inside) THEN hand the restart to the user — running it myself SIGTERMs my own session mid-call. Verify with systemctl --user status showing my claude --resume PID as a child.";
const UNION_RULE =
  "WHEN extending a discriminated union (TS variant types / Schema.Union) with a new case THEN before building, grep for every `switch (x.type)` and case branch on the discriminant.";
const MCP_RULE =
  "WHEN user names a tool/MCP by exact name and it is not in ToolSearch THEN grep ~/.claude.json mcpServers for that name before substituting a similar tool";
const BUN_RULE =
  "WHEN adding Bun tests to a TypeScript project THEN configure the bun compiler type and verify typecheck before treating test setup as complete";

const POLICY = `# rev: 4

## Operational
${RESTART_RULE}
${UNION_RULE}
${MCP_RULE}
${BUN_RULE}
WHEN running bash commands THEN be careful

## Pending
WHEN deploying to production THEN ask first
`;

const rules = AnimaPolicyMatch.parsePolicyRules(POLICY);
const textsFiring = (
  call: AnimaPolicyMatch.AnimaToolCall,
  fired: ReadonlySet<string> = new Set(),
) => AnimaPolicyMatch.selectRules(rules, call, fired).map((rule) => rule.text);

describe("AnimaPolicyMatch", () => {
  it("hashes rules exactly like hook.ts so policy-fires.jsonl stays shared with the CLI", () => {
    // `1tdq60m` is what hook.ts recorded for this rule in a real policy-fires.jsonl.
    expect(AnimaPolicyMatch.hashOf(RESTART_RULE)).toBe("1tdq60m");
    expect(AnimaPolicyMatch.hashOf("")).toBe("0");
  });

  it("parses only operational rules that carry trigger tokens", () => {
    expect(rules.map((rule) => rule.text)).toEqual([RESTART_RULE, UNION_RULE, MCP_RULE, BUN_RULE]);
    expect(rules[0]?.strong).toEqual(expect.arrayContaining(["t3code.service", "execstart"]));
    expect(rules[1]?.strong).toEqual(expect.arrayContaining(["schema.union"]));
    expect(rules[1]?.weak).toContain("discriminated");
  });

  it.each([
    {
      label: "a strong token in a shell command",
      call: { toolName: "Bash", toolInput: { command: "systemctl --user restart t3code.service" } },
      fires: [RESTART_RULE],
    },
    {
      label: "a strong token inside an edit body",
      call: {
        toolName: "Edit",
        toolInput: { file_path: "src/contracts.ts", new_string: "export const X = Schema.Union([" },
      },
      fires: [UNION_RULE],
    },
    {
      label: "one distinctive weak word in the intent",
      call: { toolName: "Grep", toolInput: { pattern: "discriminated" } },
      fires: [UNION_RULE],
    },
    {
      label: "a weak word only inside the code body",
      call: {
        toolName: "Edit",
        toolInput: { file_path: "src/a.ts", new_string: "// a discriminated value" },
      },
      fires: [],
    },
    {
      label: "one short weak word",
      call: { toolName: "Bash", toolInput: { command: "echo union" } },
      fires: [],
    },
    {
      label: "a tool name that is generic",
      call: { toolName: "Bash", toolInput: { command: "ls" } },
      fires: [],
    },
  ])("scores $label", ({ call, fires }) => {
    expect(textsFiring(call)).toEqual(fires);
  });

  it("caps fires per call at two, best score first, and skips rules already fired", () => {
    const call = {
      toolName: "Bash",
      toolInput: {
        command: "grep -r Schema.Union mcpServers ToolSearch t3code.service ExecStart",
      },
    };
    const first = AnimaPolicyMatch.selectRules(rules, call, new Set());
    expect(first).toHaveLength(AnimaPolicyMatch.MAX_RULES_PER_CALL);
    const second = AnimaPolicyMatch.selectRules(
      rules,
      call,
      new Set(first.map((rule) => rule.hash)),
    );
    expect(second.map((rule) => rule.text)).not.toContain(first[0]!.text);
    expect(second.length).toBeGreaterThan(0);
  });

  it("describes the triggering call from its first intent field", () => {
    expect(
      AnimaPolicyMatch.describeToolCall({
        toolName: "Bash",
        toolInput: { command: "git push --force\nsecond line" },
      }),
    ).toBe("Bash: git push --force");
    expect(AnimaPolicyMatch.describeToolCall({ toolName: "mcp__t3__read", toolInput: {} })).toBe(
      "mcp__t3__read",
    );
  });
});
