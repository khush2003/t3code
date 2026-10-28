/**
 * Port of the policy-firing half of `~/.claude/skills/anima/hook.ts` (extractTokens, loadRules,
 * buildHaystacks, the pretool score). Thresholds, caps and `hashOf` must stay identical so
 * `policy-fires.jsonl` written here reads the same to the CLI's ranking and decay.
 */

export const MAX_RULES_PER_CALL = 2;
export const LOOP_THRESHOLD = 3;
export const BREATH_NAG_MIN_EVENTS = 15;
const RULE_TEXT_MAX = 700;

export interface AnimaPolicyRuleMatcher {
  readonly text: string;
  readonly strong: ReadonlyArray<string>;
  readonly weak: ReadonlyArray<string>;
  readonly hash: string;
}

export interface AnimaToolCall {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
}

export interface AnimaPolicyHaystacks {
  readonly full: string;
  readonly intent: string;
}

export function hashOf(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

const GENERIC_TOKENS = new Set([
  "when",
  "then",
  "before",
  "after",
  "with",
  "that",
  "this",
  "have",
  "from",
  "file",
  "files",
  "code",
  "test",
  "tests",
  "user",
  "never",
  "always",
  "must",
  "bash",
  "read",
  "edit",
  "write",
  "grep",
  "glob",
  "about",
  "adding",
  "against",
  "should",
  "would",
  "could",
  "running",
  "editing",
  "writing",
  "reading",
  "checking",
  "making",
  "change",
  "changes",
  "changed",
  "instead",
  "without",
  "because",
  "between",
  "which",
  "where",
  "while",
  "there",
  "their",
  "using",
  "under",
  "other",
  "first",
  "second",
  "session",
  "sessions",
  "project",
  "projects",
  "command",
  "commands",
  "request",
  "response",
  "value",
  "values",
  "field",
  "fields",
  "working",
  "being",
  "doing",
  "going",
  "asked",
  "asks",
  "needs",
  "needed",
  "wants",
  "existing",
  "current",
  "actual",
  "single",
  "multiple",
  "every",
  "anything",
  "something",
  "nothing",
  "still",
  "already",
  "directly",
  "logic",
  "layer",
  "layers",
  "shared",
  "cannot",
  "won't",
  "doesn't",
  "import",
  "imports",
  "export",
  "exports",
  "module",
  "modules",
  "function",
  "functions",
  "return",
  "returns",
  "const",
  "class",
  "string",
  "number",
  "object",
  "array",
  "async",
  "await",
  "query",
  "mutation",
  "runtime",
  "silently",
  "resolves",
  "undefined",
  "throws",
  "config",
  "server",
  "client",
  "build",
  "builds",
  "branch",
  "commit",
  "define",
  "defined",
  "inside",
]);

export function extractTokens(when: string): {
  readonly strong: ReadonlyArray<string>;
  readonly weak: ReadonlyArray<string>;
} {
  const strong = new Set<string>();
  const weak = new Set<string>();
  for (const match of when.matchAll(/`([^`]{3,60})`/g)) strong.add(match[1]!.toLowerCase());
  for (const match of when.matchAll(/\b[\w]+(?:[./_-][\w]+)+\b/g)) {
    const token = match[0].toLowerCase();
    if (token.length >= 4 && token.length <= 60) strong.add(token);
  }
  for (const match of when.matchAll(/\b[A-Z][A-Z0-9_]{3,}\b/g)) strong.add(match[0].toLowerCase());
  for (const match of when.matchAll(/\b(?:[A-Z][a-z0-9]+){2,}\b/g)) {
    strong.add(match[0].toLowerCase());
  }
  for (const match of when.matchAll(/\b[a-z][a-z0-9]{3,23}\b/g)) {
    const token = match[0];
    if (!strong.has(token) && !GENERIC_TOKENS.has(token)) weak.add(token);
  }
  return {
    strong: [...strong].filter((token) => !GENERIC_TOKENS.has(token)).slice(0, 8),
    weak: [...weak].slice(0, 10),
  };
}

/** Operational `WHEN ... THEN ...` rules with at least one trigger token, from raw policy.md. */
export function parsePolicyRules(raw: string): ReadonlyArray<AnimaPolicyRuleMatcher> {
  const operational = raw.split(/^## Operational$/m)[1]?.split(/^## /m)[0] ?? "";
  const rules: Array<AnimaPolicyRuleMatcher> = [];
  for (const line of operational.split("\n")) {
    const text = line.trim();
    if (!/^WHEN /.test(text)) continue;
    const { strong, weak } = extractTokens(text.split(/ THEN /)[0] ?? text);
    if (strong.length === 0 && weak.length === 0) continue;
    rules.push({ text, strong, weak, hash: hashOf(text) });
  }
  return rules;
}

const INTENT_FIELDS = [
  "file_path",
  "path",
  "filePath",
  "command",
  "pattern",
  "description",
  "prompt",
] as const;
const CODE_FIELDS = ["old_string", "new_string"] as const;

export function buildHaystacks(call: AnimaToolCall): AnimaPolicyHaystacks {
  const intent = [call.toolName];
  const codeish: Array<string> = [];
  for (const field of INTENT_FIELDS) {
    const value = call.toolInput[field];
    if (typeof value === "string") intent.push(value.slice(0, 300));
  }
  for (const field of CODE_FIELDS) {
    const value = call.toolInput[field];
    if (typeof value === "string") codeish.push(value.slice(0, 300));
  }
  const intentText = intent.join(" ").toLowerCase();
  return { intent: intentText, full: `${intentText} ${codeish.join(" ").toLowerCase()}` };
}

export function scoreRule(rule: AnimaPolicyRuleMatcher, haystacks: AnimaPolicyHaystacks): number {
  const strong = rule.strong.filter((token) => haystacks.full.includes(token)).length * 2;
  const weak = rule.weak
    .filter((token) => haystacks.intent.includes(token))
    .reduce((sum, token) => sum + (token.length >= 6 ? 2 : 1), 0);
  return strong + weak;
}

/** Best-scoring unfired rules at or above the threshold, capped per call. */
export function selectRules(
  rules: ReadonlyArray<AnimaPolicyRuleMatcher>,
  call: AnimaToolCall,
  fired: ReadonlySet<string>,
): ReadonlyArray<AnimaPolicyRuleMatcher> {
  const haystacks = buildHaystacks(call);
  return rules
    .filter((rule) => !fired.has(rule.hash))
    .map((rule) => ({ rule, score: scoreRule(rule, haystacks) }))
    .filter((match) => match.score >= 2)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, MAX_RULES_PER_CALL)
    .map((match) => match.rule);
}

export function clipRuleText(text: string): string {
  return text.length > RULE_TEXT_MAX ? `${text.slice(0, RULE_TEXT_MAX)}…` : text;
}

/** One-line description of a call for the fire record, e.g. `Bash: git push --force`. */
export function describeToolCall(call: AnimaToolCall): string {
  for (const field of INTENT_FIELDS) {
    const value = call.toolInput[field];
    if (typeof value === "string" && value.trim() !== "") {
      return `${call.toolName}: ${value.trim().split("\n")[0]!.slice(0, 120)}`;
    }
  }
  return call.toolName;
}
