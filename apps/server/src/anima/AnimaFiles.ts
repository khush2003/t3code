// @effect-diagnostics nodeBuiltinImport:off -- synchronous sha256 over many small files; no Effect API fits a pure digest
import * as NodeCrypto from "node:crypto";
import type {
  AnimaBreath,
  AnimaBundleFile,
  AnimaCompareResult,
  AnimaInboxMessage,
  AnimaOpen,
  AnimaPolicy,
  AnimaShape,
  AnimaSummary,
  AnimaSyncRelation,
  AnimaTrait,
} from "@t3tools/contracts";

/** The CLI treats a session heartbeat older than this as stale. */
const ANIMA_SESSION_STALE_MS = 90 * 60 * 1000;
/** Operational rule cap enforced by the anima CLI. */
export const ANIMA_POLICY_CAP = 40;

export interface AnimaHeaderLine {
  readonly key: string;
  readonly value: string;
}

export interface AnimaRow {
  readonly index: number;
  readonly ts: string | null;
  readonly hsl: string | null;
  readonly note: string;
  readonly shape: AnimaShape | null;
  readonly drift: AnimaShape | null;
  readonly graph: string | null;
  readonly aim: string | null;
  readonly project: string | null;
}

export interface ParsedAgentFile {
  readonly header: ReadonlyArray<AnimaHeaderLine>;
  readonly rows: ReadonlyArray<AnimaRow>;
  readonly id: string;
  readonly name: string;
  readonly born: string;
  readonly breaths: number;
  readonly accent: string | null;
  readonly parent: string | null;
  readonly role: string;
  readonly enabled: boolean;
  readonly memo: string | null;
  readonly vow: string | null;
  readonly projects: ReadonlyArray<string>;
  readonly traits: ReadonlyArray<AnimaTrait>;
  readonly skills: ReadonlyArray<AnimaTrait>;
}

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/** `name=.77±.15~1,other=.5` -> traits; the `~streak` and `!` markers are dropped. */
function parseTraits(value: string): ReadonlyArray<AnimaTrait> {
  const traits: Array<AnimaTrait> = [];
  for (const pair of value.split(",")) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const rest = trimmed.slice(eq + 1);
    const pm = rest.indexOf("±");
    const mean = Number.parseFloat(pm === -1 ? rest : rest.slice(0, pm));
    if (!Number.isFinite(mean)) continue;
    const sigmaRaw = pm === -1 ? Number.NaN : Number.parseFloat(rest.slice(pm + 1));
    traits.push({ name, mean, sigma: Number.isFinite(sigmaRaw) ? sigmaRaw : null });
  }
  return traits;
}

function parseShape(value: string | undefined): AnimaShape | null {
  const parts = (value ?? "").split("/").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return { breadth: parts[0]!, depth: parts[1]!, coupling: parts[2]! };
}

/** `0.1/0.2/0.3+-0.1/0/0.1` -> shape and drift; drift is absent on the first breath. */
function parseShapeAndDrift(value: string | undefined): {
  readonly shape: AnimaShape | null;
  readonly drift: AnimaShape | null;
} {
  const [shape, drift] = (value ?? "").split("+");
  return { shape: parseShape(shape), drift: parseShape(drift) };
}

function parseRow(line: string): AnimaRow | null {
  const match = /^(\d+)\|/.exec(line);
  if (match === null) return null;
  const parts = line.split("|");
  const timestamped = parts.length >= 2 && /^\d{4}-\d{2}-\d{2}T/.test(parts[1] ?? "");
  // Rows are `n|ts|hsl|note|shape|graph|aim|project`; pre-timestamp rows omit `ts`.
  const offset = timestamped ? 1 : 0;
  const { shape, drift } = parseShapeAndDrift(parts[3 + offset]);
  return {
    index: Number.parseInt(match[1]!, 10),
    ts: timestamped ? (parts[1] ?? null) : null,
    hsl: nonEmpty(parts[1 + offset]),
    note: parts[2 + offset] ?? "",
    shape,
    drift,
    graph: nonEmpty(parts[4 + offset]),
    aim: nonEmpty(parts[5 + offset]),
    project: nonEmpty(parts[6 + offset]),
  };
}

export function parseAgentFile(content: string): ParsedAgentFile {
  const header: Array<AnimaHeaderLine> = [];
  const rows: Array<AnimaRow> = [];
  for (const line of content.split("\n")) {
    if (line.startsWith("#")) {
      const match = /^#\s*([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
      if (match !== null) header.push({ key: match[1]!, value: match[2]!.trimEnd() });
      continue;
    }
    const row = parseRow(line);
    if (row !== null) rows.push(row);
  }
  const identityLine = header.find((entry) => entry.key === "id");
  const identity = `id:${identityLine?.value ?? ""}`;
  const pick = (re: RegExp) => re.exec(identity)?.[1] ?? "";
  const valueOf = (key: string) => nonEmpty(header.find((entry) => entry.key === key)?.value);
  const projectsRaw = valueOf("projects") ?? "";
  const parent = valueOf("parent");
  return {
    header,
    rows,
    id: pick(/\bid:(\S+)/),
    name: pick(/\bname:(\S+)/),
    born: pick(/\bborn:(\S+)/),
    breaths: Number.parseInt(pick(/\bbreaths:(\d+)/) || "0", 10),
    accent: pick(/\baccent:(#\S+)/) || null,
    parent: parent === null || parent === "-" ? null : parent,
    role: valueOf("role")?.split(/\s+/)[0] ?? "agent",
    enabled: valueOf("active")?.split(/\s+/)[0] !== "false",
    memo: valueOf("memo"),
    vow: valueOf("vow"),
    projects: projectsRaw
      .split(",")
      .map((entry) => entry.split("=")[0]!.trim())
      .filter((entry) => entry !== ""),
    traits: parseTraits(valueOf("self") ?? ""),
    skills: parseTraits(valueOf("skills") ?? ""),
  };
}

/** First paragraph under `## voice` in identity.md. */
export function parseIdentityVoice(identity: string): string | null {
  const lines = identity.split("\n");
  const start = lines.findIndex((line) => /^##\s+voice\s*$/i.test(line.trim()));
  if (start === -1) return null;
  const paragraph: Array<string> = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim() === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  return nonEmpty(paragraph.join(" "));
}

/** Removes a leading `---` YAML frontmatter block, as output-style files carry. */
export function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  return (match === null ? content : content.slice(match[0].length)).trim();
}

const CAPSULE_FIELD_MAX = 220;
const cutField = (value: string) =>
  value.length > CAPSULE_FIELD_MAX ? `${value.slice(0, CAPSULE_FIELD_MAX).trimEnd()}…` : value;

/** Compact identity refresh, mirroring the anima CLI's hook.ts voice capsule. */
export function buildIdentityCapsule(name: string, agentContent: string, identity: string): string {
  const agent = parseAgentFile(agentContent);
  const field = (key: string) =>
    nonEmpty(agent.header.find((entry) => entry.key === key)?.value) ?? "";
  const aim = [...agent.rows].reverse().find((row) => row.aim !== null)?.aim ?? "";
  const section = identity.split(/^## refusals\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const refusals = section
    .split("\n")
    .flatMap((line) => {
      const match = /^- (.+)$/.exec(line);
      return match === null ? [] : [cutField(match[1]!)];
    })
    .slice(0, 3);
  const lines = [
    `Anima identity refresh: you are ${name} (${agent.role}, ${agent.breaths} breaths)`,
  ];
  const push = (label: string, value: string) => {
    if (value !== "") lines.push(`${label}: ${cutField(value)}`);
  };
  push("Vow", field("vow"));
  push("Voice", field("style"));
  push("Biases", field("biases"));
  for (const refusal of refusals) lines.push(`Refusal: ${refusal}`);
  push("Memo", field("memo"));
  push("Aim", aim);
  lines.push(
    `Speak and decide as ${name}, with this voice, these biases and refusals, not as a generic assistant.`,
  );
  return lines.join("\n");
}

export interface ParsedBreathFile extends Omit<
  AnimaBreath,
  "note" | "hsl" | "shape" | "drift" | "graph" | "aim" | "project"
> {}

export function breathFileName(index: number): string {
  return `${String(index).padStart(3, "0")}.breath`;
}

export function parseBreathFile(content: string, fileName: string): ParsedBreathFile | null {
  const fromName = /^(\d+)\.breath$/.exec(fileName);
  const lines = content.split("\n");
  const first = lines.find((line) => line.startsWith("# breath:")) ?? "";
  const pick = (re: RegExp) => re.exec(first)?.[1];
  const indexRaw = pick(/breath:(\d+)/) ?? fromName?.[1];
  if (indexRaw === undefined) return null;
  const field = (key: string) => {
    const line = lines.find((entry) => entry.startsWith(`# ${key}:`));
    return line === undefined ? "" : line.slice(key.length + 3).trim();
  };
  const parent = pick(/parent:(\S+)/);
  const open = field("open");
  return {
    index: Number.parseInt(indexRaw, 10),
    ts: pick(/ts:(\S+)/) ?? "",
    hash: nonEmpty(pick(/hash:(\S+)/)),
    parent: parent === undefined || parent === "-" ? null : parent,
    files: field("files").split(/\s+/).filter(Boolean),
    decisions: field("decisions").split(/\s+/).filter(Boolean),
    open: open === "" ? [] : [open],
  };
}

/** Joins detail files and the agent.anima rows into the breath list the UI shows. */
export function mergeBreaths(
  rows: ReadonlyArray<AnimaRow>,
  details: ReadonlyArray<ParsedBreathFile>,
): ReadonlyArray<AnimaBreath> {
  const byIndex = new Map(details.map((detail) => [detail.index, detail]));
  const seen = new Set<number>();
  const out: Array<AnimaBreath> = [];
  for (const row of rows) {
    seen.add(row.index);
    const detail = byIndex.get(row.index);
    out.push({
      index: row.index,
      ts: row.ts ?? detail?.ts ?? "",
      note: row.note,
      hsl: row.hsl,
      shape: row.shape,
      drift: row.drift,
      graph: row.graph,
      aim: row.aim,
      project: row.project,
      decisions: detail?.decisions ?? [],
      open: detail?.open ?? [],
      files: detail?.files ?? [],
      hash: detail?.hash ?? null,
      parent: detail?.parent ?? null,
    });
  }
  for (const detail of details) {
    if (seen.has(detail.index)) continue;
    out.push({
      ...detail,
      note: "",
      hsl: null,
      shape: null,
      drift: null,
      graph: null,
      aim: null,
      project: null,
    });
  }
  return out.toSorted((left, right) => left.index - right.index);
}

export interface ParsedPolicy extends Omit<AnimaPolicy, "cap"> {}

export function parsePolicy(content: string): ParsedPolicy {
  let revision = 0;
  let section: "none" | "operational" | "pending" | "audit" = "none";
  const operational: Array<string> = [];
  const pending: Array<string> = [];
  const audit: Array<string> = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    const rev = /^# rev:\s*(\d+)/.exec(line);
    if (rev !== null) {
      revision = Number.parseInt(rev[1]!, 10);
      continue;
    }
    if (line === "## Operational") section = "operational";
    else if (line === "## Pending") section = "pending";
    else if (line === "## Audit") section = "audit";
    else if (line === "" || line.startsWith("#")) continue;
    else if (section === "operational") operational.push(line);
    else if (section === "pending") pending.push(line);
    else if (section === "audit") audit.push(line);
  }
  const numbered = (rules: ReadonlyArray<string>) =>
    rules.map((text, position) => ({ index: position + 1, text }));
  return {
    revision,
    operational: numbered(operational),
    pending: numbered(pending),
    audit,
  };
}

export function parseInbox(content: string): ReadonlyArray<AnimaInboxMessage> {
  const out: Array<AnimaInboxMessage> = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    try {
      if (line.startsWith("{")) {
        const value = JSON.parse(line) as Record<string, unknown>;
        out.push({
          id: String(value.id ?? ""),
          type: String(value.type ?? "info"),
          from: String(value.from ?? ""),
          ts: String(value.ts ?? ""),
          body: String(value.body ?? ""),
        });
        continue;
      }
    } catch {
      continue;
    }
    // Legacy `ts|from|type|body`.
    const [ts = "", from = "", type = "info", ...body] = line.split("|");
    out.push({ id: `${ts}:${from}`, type, from, ts, body: body.join("|") });
  }
  return out;
}

export interface ParsedSession {
  readonly clockedIn: string;
  readonly lastActive: string;
  readonly cwd: string | null;
  readonly live: boolean;
}

/** The CLI writes local wall-clock timestamps without an offset, so they parse as local time. */
export function localTimestampMs(value: string): number {
  // @effect-diagnostics-next-line globalDate:off
  return new Date(value).getTime();
}

export function parseSession(content: string, nowMs: number): ParsedSession | null {
  const [clockedIn = "", lastActive = "", ...cwd] = content.trim().split("|");
  if (lastActive === "") return null;
  const last = localTimestampMs(lastActive);
  return {
    clockedIn,
    lastActive,
    cwd: nonEmpty(cwd.join("|")),
    live: Number.isFinite(last) && nowMs - last <= ANIMA_SESSION_STALE_MS,
  };
}

/** Parses `opens list` output: `name (path):` blocks followed by `  open-001 [assignee] [status]: question`. */
export function parseOpensListOutput(output: string): ReadonlyArray<AnimaOpen> {
  const opens: Array<AnimaOpen> = [];
  let project = "";
  for (const line of output.split("\n")) {
    const block = /^(\S.*?)\s+\((.+)\):\s*$/.exec(line);
    if (block !== null) {
      project = block[2]!;
      continue;
    }
    const item = /^\s+(open-\d+)\s+\[([^\]]*)\](?:\s+\[([^\]]+)\])?:\s*(.*)$/.exec(line);
    if (item === null) continue;
    opens.push({
      id: item[1]!,
      project,
      question: item[4]!,
      status: item[3] ?? "active",
      assignee: nonEmpty(item[2]),
    });
  }
  return opens;
}

/** Never let a bundle path leave the anima directory. */
export function isSafeRelativePath(path: string): boolean {
  if (path === "" || path.includes("\0") || path.includes("\\")) return false;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

const VOLATILE_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)session$/,
  /(^|\/)inbox$/,
  /\.pre-repair/,
  /\.popos-/,
  /(^|\/)card\.json$/,
];

function isVolatilePath(path: string): boolean {
  return VOLATILE_PATTERNS.some((pattern) => pattern.test(path));
}

/** Files a bundle may carry; import and merge-apply reject everything else. */
export function isBundlePath(path: string): boolean {
  if (!isSafeRelativePath(path) || isVolatilePath(path)) return false;
  return (
    path === "agent.anima" ||
    path === "identity.md" ||
    path === "policy.md" ||
    path === "constitution.json" ||
    /^breaths\/[^/]+\.breath$/.test(path) ||
    /^skills\/.+\.md$/.test(path)
  );
}

/** The files the digest covers: everything that defines identity, not the skill library. */
function isDigestPath(path: string): boolean {
  return isBundlePath(path) && !path.startsWith("skills/");
}

export function digestFiles(files: ReadonlyArray<AnimaBundleFile>): string {
  const hash = NodeCrypto.createHash("sha256");
  const sorted = files
    .filter((file) => isDigestPath(file.path))
    .toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  for (const file of sorted) {
    hash.update(`${file.path.length}:${file.path}\n${Buffer.byteLength(file.content)}:`);
    hash.update(file.content);
    hash.update("\n");
  }
  return hash.digest("hex");
}

/** `index:hash` per breath, ordered; breaths with no hash contribute an empty hash. */
export function breathChain(files: ReadonlyArray<AnimaBundleFile>): ReadonlyArray<string> {
  const entries: Array<{ index: number; entry: string }> = [];
  for (const file of files) {
    const match = /^breaths\/([^/]+\.breath)$/.exec(file.path);
    if (match === null) continue;
    const parsed = parseBreathFile(file.content, match[1]!);
    if (parsed === null) continue;
    entries.push({ index: parsed.index, entry: `${parsed.index}:${parsed.hash ?? ""}` });
  }
  return entries.toSorted((left, right) => left.index - right.index).map((item) => item.entry);
}

export interface ComparableAnima {
  readonly id: string;
  readonly digest: string;
  readonly chain: ReadonlyArray<string>;
  readonly files: ReadonlyArray<AnimaBundleFile>;
}

export function relationBetween(
  local: ComparableAnima | null,
  incoming: ComparableAnima,
): {
  readonly relation: AnimaSyncRelation;
  readonly commonBreath: number;
  readonly localOnlyBreaths: number;
  readonly incomingOnlyBreaths: number;
} {
  if (local === null) {
    return {
      relation: "missing",
      commonBreath: -1,
      localOnlyBreaths: 0,
      incomingOnlyBreaths: incoming.chain.length,
    };
  }
  let common = 0;
  while (
    common < local.chain.length &&
    common < incoming.chain.length &&
    local.chain[common] === incoming.chain[common]
  ) {
    common += 1;
  }
  const commonBreath = common === 0 ? -1 : Number.parseInt(local.chain[common - 1]!, 10);
  const localOnlyBreaths = local.chain.length - common;
  const incomingOnlyBreaths = incoming.chain.length - common;
  const base = { commonBreath, localOnlyBreaths, incomingOnlyBreaths };
  if (local.id !== incoming.id) return { relation: "unrelated", ...base };
  if (local.digest === incoming.digest) return { relation: "identical", ...base };
  if (localOnlyBreaths === 0 && incomingOnlyBreaths > 0)
    return { relation: "incoming-ahead", ...base };
  if (incomingOnlyBreaths === 0 && localOnlyBreaths > 0)
    return { relation: "local-ahead", ...base };
  // Equal chains with different content (policy, traits, identity edited on both sides) carry no
  // ancestry, so neither side can be declared ahead.
  return { relation: "diverged", ...base };
}

function changedPaths(
  local: ReadonlyArray<AnimaBundleFile>,
  incoming: ReadonlyArray<AnimaBundleFile>,
): ReadonlyArray<string> {
  const localByPath = new Map(local.filter((f) => isBundlePath(f.path)).map((f) => [f.path, f]));
  const incomingByPath = new Map(
    incoming.filter((f) => isBundlePath(f.path)).map((f) => [f.path, f]),
  );
  const changed = new Set<string>();
  for (const [path, file] of incomingByPath) {
    if (localByPath.get(path)?.content !== file.content) changed.add(path);
  }
  for (const path of localByPath.keys()) if (!incomingByPath.has(path)) changed.add(path);
  return [...changed].toSorted();
}

export function compareAnimas(
  local: ComparableAnima | null,
  incoming: ComparableAnima,
): Omit<AnimaCompareResult, "local"> {
  return {
    ...relationBetween(local, incoming),
    changedFiles: changedPaths(local?.files ?? [], incoming.files),
  };
}

/** Returns a human-readable problem, or null when the tree is a coherent anima. */
export function validateAnimaTree(
  files: ReadonlyArray<AnimaBundleFile>,
  expected: { readonly name: string; readonly id?: string | undefined },
): string | null {
  const escaping = files.find((file) => !isBundlePath(file.path));
  if (escaping !== undefined) return `File '${escaping.path}' is not allowed in an anima.`;
  const agent = files.find((file) => file.path === "agent.anima");
  if (agent === undefined) return "agent.anima is missing.";
  const parsed = parseAgentFile(agent.content);
  if (parsed.id === "") return "agent.anima has no id line.";
  if (expected.id !== undefined && parsed.id !== expected.id)
    return "agent.anima id does not match the anima being replaced.";
  if (parsed.name !== "" && parsed.name !== expected.name)
    return "agent.anima name does not match the requested name.";
  const breathFiles = files.flatMap((file) => {
    const match = /^breaths\/([^/]+\.breath)$/.exec(file.path);
    const parsedBreath = match === null ? null : parseBreathFile(file.content, match[1]!);
    return parsedBreath === null ? [] : [parsedBreath.index];
  });
  const highest = breathFiles.length === 0 ? 0 : Math.max(...breathFiles);
  if (new Set(breathFiles).size !== breathFiles.length) return "Duplicate breath indexes.";
  if (parsed.breaths !== highest)
    return `agent.anima declares ${parsed.breaths} breaths but the latest breath file is ${highest}.`;
  const lastRow = parsed.rows.at(-1);
  if (lastRow !== undefined && lastRow.index !== highest)
    return "The last agent.anima row does not match the latest breath file.";
  return null;
}

export interface SummaryInput {
  readonly name: string;
  readonly agent: ParsedAgentFile;
  readonly identity: string;
  readonly policy: ParsedPolicy;
  readonly inbox: ReadonlyArray<AnimaInboxMessage>;
  readonly session: ParsedSession | null;
  readonly digest: string;
}

export function buildSummary(input: SummaryInput): AnimaSummary {
  const { agent } = input;
  const lastRow = agent.rows.at(-1);
  // Row 0 of a new anima is a seed placeholder, not a measured breath.
  const breathed = agent.breaths > 0;
  return {
    name: input.name,
    id: agent.id,
    role: agent.role,
    born: agent.born,
    parent: agent.parent,
    accent: agent.accent,
    breathCount: agent.breaths,
    enabled: agent.enabled,
    live: input.session?.live ?? false,
    lastActiveAt: input.session?.lastActive ?? null,
    lastBreathAt: breathed ? (lastRow?.ts ?? null) : null,
    aim: lastRow?.aim ?? null,
    hsl: breathed ? (lastRow?.hsl ?? null) : null,
    shape: breathed ? (lastRow?.shape ?? null) : null,
    memo: agent.memo,
    vow: agent.vow,
    voice: parseIdentityVoice(input.identity),
    projects: agent.projects,
    topSkills: agent.skills.toSorted((left, right) => right.mean - left.mean).slice(0, 5),
    inboxCount: input.inbox.length,
    policyCount: input.policy.operational.length,
    digest: input.digest,
  };
}
