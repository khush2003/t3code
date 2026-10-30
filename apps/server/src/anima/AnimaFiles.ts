// @effect-diagnostics nodeBuiltinImport:off -- synchronous sha256 over many small files; no Effect API fits a pure digest
import * as NodeCrypto from "node:crypto";
import {
  ANIMA_FORMS,
  type AnimaForm,
  type AnimaAuditFinding,
  type AnimaBreath,
  type AnimaBundleFile,
  type AnimaCard,
  type AnimaCompareResult,
  type AnimaHealthAssessment,
  type AnimaHealthResult,
  type AnimaInboxMessage,
  type AnimaOpen,
  type AnimaPolicy,
  type AnimaPolicyAuditEntry,
  type AnimaSearchHit,
  type AnimaShape,
  type AnimaSummary,
  type AnimaSyncRelation,
  type AnimaTrait,
} from "@t3tools/contracts";

import { hashOf } from "./AnimaPolicyMatch.ts";

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
  /** `# project:`, the directory whose opens.json the anima works from. */
  readonly projectPath: string | null;
  readonly team: ReadonlyArray<string>;
  readonly offers: ReadonlyArray<string>;
  readonly circuit: AnimaHealthResult["circuit"];
  readonly circuitCount: number;
}

const splitList = (value: string | null) =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/** `name=.77±.15~1,other=.5` -> traits; `~n` is the negative streak, the `!` marker is dropped. */
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
    const streak = Number.parseInt(/~(\d+)/.exec(rest)?.[1] ?? "0", 10);
    traits.push({
      name,
      mean,
      sigma: Number.isFinite(sigmaRaw) ? sigmaRaw : null,
      ...(streak > 0 ? { negStreak: streak } : {}),
    });
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
  const circuit = valueOf("circuit")?.split(/\s+/)[0];
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
    projectPath: valueOf("project"),
    team: splitList(valueOf("team")),
    offers: splitList(valueOf("offers")),
    circuit: circuit === "open" || circuit === "half-open" ? circuit : "closed",
    circuitCount: Number.parseInt(valueOf("circuit-count") ?? "0", 10) || 0,
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
> {
  readonly narrativeAim: string | null;
}

export function breathFileName(index: number): string {
  return `${String(index).padStart(3, "0")}.breath`;
}

/**
 * The CLI joins `--decisions` with commas, which only round-trips for slug lists. Prose decisions
 * keep their commas, so they split on the `|` or `;` agents use between them instead.
 */
/** Old breaths list slugs separated by spaces, or prose decisions separated by semicolons. */
function legacyDecisions(text: string): ReadonlyArray<string> {
  const separator = /;/.test(text) ? /;/ : /\s+/;
  return text
    .split(separator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function splitDecisions(text: string): ReadonlyArray<string> {
  const slugs = text.split(",").map((entry) => entry.trim());
  if (!slugs.some((entry) => /\s/.test(entry))) return slugs.filter(Boolean);
  // The comma join also dropped the space after each comma inside prose.
  return text
    .split(/[|;]/)
    .map((entry) => entry.replace(/,(?=\S)/g, ", ").trim())
    .filter(Boolean);
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
  const list = (key: string, separator: string) =>
    field(key)
      .split(separator)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "" && entry !== "-");
  // breathe.ts writes "# decisions | friction | aim" on line 2; older breaths use "# decisions:".
  const narrative = lines
    .find(
      (line) => line.startsWith("# ") && !line.startsWith("# breath:") && / \| .* \| /.test(line),
    )
    ?.slice(2)
    .split(" | ");
  const part = (index: number) => nonEmpty(narrative?.[index]?.trim().replace(/^-$/, ""));
  const self = field("self")
    .split(",")
    .flatMap((entry) => {
      const [name, value] = entry.split("=");
      const mean = Number(value);
      return name?.trim() && Number.isFinite(mean)
        ? [{ name: name.trim(), mean, sigma: null }]
        : [];
    });
  return {
    index: Number.parseInt(indexRaw, 10),
    ts: pick(/ts:(\S+)/) ?? "",
    hash: nonEmpty(pick(/hash:(\S+)/)),
    parent: parent === undefined || parent === "-" ? null : parent,
    files: field("files").split(/\s+/).filter(Boolean),
    decisions:
      narrative === undefined ? legacyDecisions(field("decisions")) : splitDecisions(part(0) ?? ""),
    friction: part(1) ?? nonEmpty(field("friction")),
    narrativeAim: part(2) ?? null,
    self,
    corrections: list("corrections", ";"),
    seeking: nonEmpty(field("seeking")),
    resume: nonEmpty(field("resume")),
    open: open === "" ? [] : [open],
    closedOpens: list("closed-opens", " | "),
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
      aim: row.aim ?? detail?.narrativeAim ?? null,
      project: row.project,
      decisions: detail?.decisions ?? [],
      friction: detail?.friction ?? null,
      self: detail?.self ?? [],
      corrections: detail?.corrections ?? [],
      seeking: detail?.seeking ?? null,
      resume: detail?.resume ?? null,
      open: detail?.open ?? [],
      closedOpens: detail?.closedOpens ?? [],
      files: detail?.files ?? [],
      hash: detail?.hash ?? null,
      parent: detail?.parent ?? null,
    });
  }
  for (const detail of details) {
    if (seen.has(detail.index)) continue;
    const { narrativeAim, ...rest } = detail;
    out.push({
      ...rest,
      note: "",
      hsl: null,
      shape: null,
      drift: null,
      graph: null,
      aim: narrativeAim,
      project: null,
    });
  }
  return out.toSorted((left, right) => left.index - right.index);
}

export interface ParsedPolicy extends Omit<AnimaPolicy, "cap"> {}

/** Aggregates policy-fires.jsonl (`{h, ts}` per fire) like the CLI's `loadFireStats`. */
function parseFireLog(
  content: string,
): ReadonlyMap<string, { readonly count: number; readonly last: string }> {
  const stats = new Map<string, { count: number; last: string }>();
  for (const line of content.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const { h, ts } = JSON.parse(line) as { h?: unknown; ts?: unknown };
      if (typeof h !== "string") continue;
      stats.set(h, { count: (stats.get(h)?.count ?? 0) + 1, last: String(ts ?? "") });
    } catch {
      continue;
    }
  }
  return stats;
}

/** `rev|date|by|text`, the CLI's audit line; anything else keeps only its text. */
function parsePolicyAuditLine(line: string): AnimaPolicyAuditEntry {
  const parts = line.split("|");
  if (parts.length < 4) return { revision: null, at: null, by: null, text: line };
  const revision = Number.parseInt(parts[0]!, 10);
  return {
    revision: Number.isNaN(revision) || revision < 0 ? null : revision,
    at: nonEmpty(parts[1]),
    by: nonEmpty(parts[2]),
    text: parts.slice(3).join("|").trim(),
  };
}

export function parsePolicy(content: string, fireLog = ""): ParsedPolicy {
  let revision = 0;
  let updatedAt: string | null = null;
  let updatedBy: string | null = null;
  let section: "none" | "operational" | "pending" | "audit" = "none";
  const operational: Array<string> = [];
  const pending: Array<string> = [];
  const audit: Array<string> = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    const rev = /^# rev:\s*(\d+)/.exec(line);
    if (rev !== null) {
      revision = Number.parseInt(rev[1]!, 10);
      updatedAt = nonEmpty(/\bupdated:\s*(\S+)/.exec(line)?.[1]);
      updatedBy = nonEmpty(/\bby:\s*(\S+)/.exec(line)?.[1]);
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
  const fires = parseFireLog(fireLog);
  const numbered = (rules: ReadonlyArray<string>, withFires: boolean) =>
    rules.map((text, position) => {
      const stat = withFires ? fires.get(hashOf(text)) : undefined;
      return {
        index: position + 1,
        text,
        fires: stat?.count ?? 0,
        lastFiredAt: nonEmpty(stat?.last),
      };
    });
  return {
    revision,
    updatedAt,
    updatedBy,
    operational: numbered(operational, true),
    pending: numbered(pending, false),
    audit,
    auditEntries: audit.map(parsePolicyAuditLine),
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
        const optional = (key: string) =>
          typeof value[key] === "string" ? nonEmpty(value[key]) : null;
        out.push({
          id: String(value.id ?? ""),
          type: String(value.type ?? "info"),
          from: String(value.from ?? ""),
          ts: String(value.ts ?? ""),
          body: String(value.body ?? ""),
          to: optional("to"),
          replyTo: optional("replyTo"),
          contextId: optional("contextId"),
          status: optional("status"),
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

/** The packaged CLI stores `encodeURIComponent(JSON)` project metadata where the skill script stored a bare cwd. */
function sessionProjectPath(field: string): string | null {
  if (!field.startsWith("%7B") && !field.startsWith("{")) return nonEmpty(field);
  try {
    const value: unknown = JSON.parse(decodeURIComponent(field));
    const projectPath =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>).projectPath
        : undefined;
    return typeof projectPath === "string" ? nonEmpty(projectPath) : null;
  } catch {
    return null;
  }
}

export function parseSession(content: string, nowMs: number): ParsedSession | null {
  const [clockedIn = "", lastActive = "", ...cwd] = content.trim().split("|");
  if (lastActive === "") return null;
  const last = localTimestampMs(lastActive);
  return {
    clockedIn,
    lastActive,
    cwd: sessionProjectPath(cwd.join("|")),
    live: Number.isFinite(last) && nowMs - last <= ANIMA_SESSION_STALE_MS,
  };
}

const stringOrNull = (value: unknown) => (typeof value === "string" ? nonEmpty(value) : null);

/** Parses `<project>/opens.json`, the CLI's open-question store for that project. */
export function parseOpensFile(content: string, project: string): ReadonlyArray<AnimaOpen> {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReadonlyArray<AnimaOpen> => {
    if (typeof entry !== "object" || entry === null) return [];
    const open = entry as Record<string, unknown>;
    const id = stringOrNull(open.id);
    const question = stringOrNull(open.question);
    if (id === null || question === null) return [];
    return [
      {
        id,
        project,
        question,
        status: stringOrNull(open.status) ?? "active",
        assignee: stringOrNull(open.assigned),
        resolves: stringOrNull(open.resolves_when),
        context: stringOrNull(open.context),
        openedBy: stringOrNull(open.opened_by),
        openedAt: stringOrNull(open.opened),
        related: Array.isArray(open.related)
          ? open.related.filter((item): item is string => typeof item === "string")
          : [],
      },
    ];
  });
}

/** Reads `card.json` defensively; it is CLI-generated and has no schema version. */
export function parseCard(content: string): AnimaCard | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const card = value as Record<string, unknown>;
  const skills = Array.isArray(card.skills) ? card.skills : [];
  return {
    description: typeof card.description === "string" ? card.description : "",
    version: stringOrNull(card.version),
    generatedAt: stringOrNull(card.generatedAt),
    skills: skills.flatMap((skill) => {
      const { name, confidence } = (skill ?? {}) as Record<string, unknown>;
      return typeof name === "string" &&
        typeof confidence === "number" &&
        Number.isFinite(confidence)
        ? [{ name, confidence }]
        : [];
    }),
    interfaces: Array.isArray(card.interfaces)
      ? card.interfaces.filter((item): item is string => typeof item === "string")
      : [],
    status: stringOrNull(card.status),
  };
}

export interface ParsedAppearance {
  readonly form: AnimaForm;
  readonly accent: string;
}

const isAnimaForm = (value: unknown): value is AnimaForm =>
  ANIMA_FORMS.some((form) => form === value);

/** Reads the clinic check-in (`appearance.json`); anything malformed counts as no check-in. */
export function parseAppearance(content: string): ParsedAppearance | null {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { version, form, accent } = value as Record<string, unknown>;
  if (version !== 1 || !isAnimaForm(form)) return null;
  if (typeof accent !== "string" || !/^#[0-9a-fA-F]{6}$/.test(accent)) return null;
  return { form, accent };
}

/** First `# ` heading of a library entry, as `library list` shows it. */
export function libraryTitle(content: string): string | null {
  const heading = content.split("\n").find((line) => line.startsWith("# "));
  return heading === undefined ? null : nonEmpty(heading.slice(2));
}

const LIBRARY_PREVIEW_MAX = 120;
const LIBRARY_AUTHOR_LINE = /^(?:from|by|author):\s*(.*)$/i;
const LIBRARY_TARGET_LINE = /^(?:for|target):\s*(.*)$/i;

/** The CLI writes `From: name (date)`; the date is not part of the author. */
const libraryPerson = (value: string | undefined) =>
  nonEmpty(value?.replace(/\s*\([^)]*\)\s*$/, ""));

/**
 * Author, target and preview of a library entry. The CLI's `shelve` writes `From:` (and older
 * entries `For:`) lines under the heading; hand-written entries may use YAML front matter instead.
 */
export function libraryMetadata(content: string): {
  readonly title: string | null;
  readonly author: string | null;
  readonly target: string | null;
  readonly preview: string | null;
} {
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  const body = frontMatter === null ? content : content.slice(frontMatter[0].length);
  let title: string | null = null;
  let author: string | null = null;
  let target: string | null = null;
  for (const line of frontMatter?.[1]?.split(/\r?\n/) ?? []) {
    const unquote = (value: string | undefined) => value?.trim().replace(/^(["'])(.*)\1$/, "$2");
    title ??= nonEmpty(unquote(/^title:\s*(.*)$/i.exec(line)?.[1]));
    author ??= libraryPerson(unquote(LIBRARY_AUTHOR_LINE.exec(line)?.[1]));
    target ??= nonEmpty(unquote(LIBRARY_TARGET_LINE.exec(line)?.[1]));
  }
  let preview: string | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("---")) continue;
    const authorLine = LIBRARY_AUTHOR_LINE.exec(line);
    if (authorLine !== null) {
      author ??= libraryPerson(authorLine[1]);
      continue;
    }
    const targetLine = LIBRARY_TARGET_LINE.exec(line);
    if (targetLine !== null) {
      target ??= nonEmpty(targetLine[1]);
      continue;
    }
    preview ??= line.slice(0, LIBRARY_PREVIEW_MAX);
  }
  return { title: libraryTitle(body) ?? title, author, target, preview };
}

const PITCH_HUE: Readonly<Record<string, number>> = {
  C: 10,
  D: 45,
  E: 90,
  F: 140,
  G: 190,
  A: 240,
  B: 285,
};

/**
 * The anima's long-run colour, as the original dashboard drew it: hue is the circular mean of the
 * breaths' pitch hues weighted towards recent breaths, saturation falls as the pitches spread, and
 * lightness is the weighted mean vitality.
 */
function identityHsl(rows: ReadonlyArray<AnimaRow>): string | null {
  const pitches: Array<{ hue: number; weight: number }> = [];
  const vitals: Array<{ light: number; weight: number }> = [];
  rows.forEach((row, position) => {
    const weight = position + 1;
    const light = Number((row.hsl ?? "").split(/[.,]/)[2]);
    vitals.push({ light: light || 50, weight });
    // Free-text notes are not codec notes even when they start with a pitch letter.
    const pitch = /^([A-G])[#b]?\d?\./.exec(row.note)?.[1];
    if (pitch !== undefined) pitches.push({ hue: PITCH_HUE[pitch]!, weight });
  });
  if (pitches.length === 0) return null;
  let sin = 0;
  let cos = 0;
  let total = 0;
  for (const { hue, weight } of pitches) {
    const radians = (hue * Math.PI) / 180;
    sin += Math.sin(radians) * weight;
    cos += Math.cos(radians) * weight;
    total += weight;
  }
  let mean = (Math.atan2(sin, cos) * 180) / Math.PI;
  if (mean < 0) mean += 360;
  let variance = 0;
  for (const { hue, weight } of pitches) {
    let diff = Math.abs(hue - mean);
    if (diff > 180) diff = 360 - diff;
    variance += diff * diff * weight;
  }
  const saturation = Math.max(30, Math.min(80, 80 - Math.sqrt(variance / total) * 0.5));
  let lightSum = 0;
  let lightWeight = 0;
  for (const { light, weight } of vitals) {
    lightSum += light * weight;
    lightWeight += weight;
  }
  const lightness = lightWeight > 0 ? Math.max(40, Math.min(70, lightSum / lightWeight)) : 55;
  return `${Math.round(mean) % 360},${Math.round(saturation)},${Math.round(lightness)}`;
}

/** `# projects: name=note,...`; projects without a note are left out. */
function parseProjectNotes(value: string): Readonly<Record<string, string>> {
  const notes: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const note = pair.slice(eq + 1).trim();
    if (name !== "" && note !== "") notes[name] = note;
  }
  return notes;
}

// Health weights, thresholds and caps from the CLI's state.ts.
const HEALTH_WEIGHTS = { u: 0.3, n: 0.25, t: 0.15, d: 0.15, s: 0.15 } as const;
const HEALTH_PROACTIVE = 0.6;
const HEALTH_INTERNAL = 0.35;
const TENSION_AGE_MAX = 20;
const DRIFT_MAX = 0.3;
const SILENCE_HOURS_MAX = 48;
/** Kalman variance the CLI assumes for a trait written without `±sigma`. */
const DEFAULT_SIGMA = 0.2;

interface KalmanEntry {
  readonly sigma: number;
  readonly negStreak: number;
  readonly recognized: boolean;
}

/** `name=.5±.2~2!`: `~n` is the negative streak, `!` marks external recognition (kalman.ts). */
function parseKalmanProfile(value: string): ReadonlyArray<KalmanEntry> {
  const profile = new Map<string, KalmanEntry>();
  for (const pair of value.split(",")) {
    const trimmed = pair.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rest = trimmed.slice(eq + 1);
    const pm = rest.indexOf("±");
    if (pm === -1) {
      if (key !== "" && !Number.isNaN(Number.parseFloat(rest)))
        profile.set(key, { sigma: DEFAULT_SIGMA, negStreak: 0, recognized: false });
      continue;
    }
    const after = rest.slice(pm + 1);
    const recognized = after.endsWith("!");
    const clean = recognized ? after.slice(0, -1) : after;
    const tilde = clean.indexOf("~");
    const mu = Number.parseFloat(rest.slice(0, pm));
    const sigma = Number.parseFloat(tilde === -1 ? clean : clean.slice(0, tilde));
    const negStreak = tilde === -1 ? 0 : Number.parseInt(clean.slice(tilde + 1), 10);
    if (key === "" || Number.isNaN(mu) || Number.isNaN(sigma)) continue;
    profile.set(key, {
      sigma: Math.abs(sigma),
      negStreak: Number.isNaN(negStreak) ? 0 : negStreak,
      recognized,
    });
  }
  return [...profile.values()];
}

/** `# tension: slug:age,...`; a slug may itself contain colons, so the age is after the last one. */
export function parseTensions(value: string): ReadonlyArray<{ slug: string; age: number }> {
  const ages = new Map<string, number>();
  for (const pair of value.split(",")) {
    const colon = pair.lastIndexOf(":");
    if (colon <= 0) continue;
    const age = Number.parseInt(pair.slice(colon + 1), 10);
    if (!Number.isNaN(age)) ages.set(pair.slice(0, colon).trim(), age);
  }
  return [...ages].map(([slug, age]) => ({ slug, age }));
}

/** `# kin: name=impression.strength,...`; an unformed bond reads `name=impression:?`. */
export function parseKin(
  value: string,
): ReadonlyArray<{ name: string; label: string; strength: number | null }> {
  return value.split(",").flatMap((entry) => {
    const equals = entry.indexOf("=");
    if (equals <= 0) return [];
    const name = entry.slice(0, equals).trim();
    const rest = entry.slice(equals + 1).trim();
    const match = /^(.*?)[.:](\d+|\?)$/.exec(rest);
    return [
      {
        name,
        label: (match ? match[1]! : rest).replaceAll("-", " ").trim(),
        strength: match && match[2] !== "?" ? Number(match[2]) : null,
      },
    ];
  });
}

function parseTensionAges(value: string): ReadonlyArray<number> {
  return parseTensions(value).map((tension) => tension.age);
}

const isTimestampedRow = (parts: ReadonlyArray<string>) =>
  parts.length >= 2 && /^\d{4}-\d{2}-\d{2}T/.test(parts[1] ?? "");

/**
 * Port of the CLI's `assessHealth` (health.ts), which only prints, so T3 can show the
 * components and score every anima in `list` without a subprocess each.
 */
export function assessHealth(input: {
  readonly agentContent: string;
  /** Content of the latest breath file, for a timestamp when the last row has none. */
  readonly latestBreathFile: string;
  readonly nowMs: number;
}): AnimaHealthAssessment | null {
  const lines = input.agentContent.split("\n").filter((line) => line.trim() !== "");
  const dataLines = lines.filter((line) => !line.startsWith("#"));
  if (dataLines.length === 0) return null;
  const agent = parseAgentFile(input.agentContent);
  const header = (key: string) =>
    lines.find((line) => line.startsWith(`# ${key}: `))?.slice(key.length + 4) ?? "";

  const hsl: Array<readonly [number, number, number]> = [];
  const shapes: Array<readonly [number, number, number]> = [];
  for (const line of dataLines) {
    const parts = line.split("|");
    const offset = isTimestampedRow(parts) ? 1 : 0;
    const [h, sat, light] = (parts[1 + offset] ?? "").split(/[.,]/).map(Number);
    hsl.push([h || 0, sat || 0, light || 50]);
    const shape = parts[3 + offset];
    if (shape) {
      const [x, y, z] = shape.split("+")[0]!.split("/").map(Number);
      shapes.push([x || 0, y || 0, z || 0]);
    }
  }

  const reasons: Array<string> = [];
  const self = parseKalmanProfile(header("self"));
  const maxSigma = Math.max(0, ...self.map((trait) => trait.sigma));
  const u = Math.min(1, maxSigma / 0.5);
  if (u > 0.5) reasons.push(`uncertainty: σ=${maxSigma.toFixed(2)}`);

  const maxNegStreak = Math.max(0, ...self.map((trait) => trait.negStreak));
  const n = Math.min(1, maxNegStreak / 3);
  if (n > 0.5) reasons.push(`neg-streak: ${maxNegStreak}`);

  const maxTensionAge = Math.max(0, ...parseTensionAges(header("tension")));
  const t = Math.min(1, maxTensionAge / TENSION_AGE_MAX);
  if (t > 0.5) reasons.push(`stale-tension: age ${maxTensionAge}`);

  const lastParts = dataLines.at(-1)!.split("|");
  const lastBreathTs =
    lastParts.length > 7 && lastParts[1]!.includes("-")
      ? lastParts[1]!
      : agent.breaths > 0
        ? (/ts:(\S+)/.exec(input.latestBreathFile)?.[1] ?? "")
        : "";
  let silenceHours = 0;
  if (lastBreathTs !== "") {
    const elapsed = (input.nowMs - localTimestampMs(lastBreathTs)) / 3_600_000;
    // Clamped: a clock behind the breath would otherwise drive the score negative.
    silenceHours = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  } else if (agent.breaths === 0) {
    silenceHours = SILENCE_HOURS_MAX;
  }
  const s = Math.min(1, silenceHours / SILENCE_HOURS_MAX);
  if (s > 0.5) reasons.push(`silence: ${Math.floor(silenceHours)}h`);

  let colorDrift = 0;
  if (hsl.length >= 2) {
    const first = hsl[Math.max(0, hsl.length - 5)]!;
    const last = hsl.at(-1)!;
    colorDrift = Math.sqrt(
      ((last[0] - first[0]) / 360) ** 2 +
        ((last[1] - first[1]) / 100) ** 2 +
        ((last[2] - first[2]) / 100) ** 2,
    );
  }
  // The CLI damps drift for recently active animas: domain shifts are expected mid-work.
  const d = Math.min(1, colorDrift / DRIFT_MAX) * (silenceHours < 2 ? 0.2 : 1);
  if (d > 0.5) reasons.push(`drift: ${colorDrift.toFixed(2)}`);

  const flooredCount = self.filter(
    (trait) => trait.sigma <= 0.15 && trait.sigma >= 0.11 && !trait.recognized,
  ).length;
  const score =
    HEALTH_WEIGHTS.u * u +
    HEALTH_WEIGHTS.n * n +
    HEALTH_WEIGHTS.t * t +
    HEALTH_WEIGHTS.d * d +
    HEALTH_WEIGHTS.s * s;

  const warnings: Array<string> = [];
  const recentHsl = hsl.slice(-5);
  const recentShapes = shapes.slice(-5);
  const trend = <T extends ReadonlyArray<number>>(series: ReadonlyArray<T>, axis: number) =>
    series.length >= 2 ? series.at(-1)![axis]! - series[0]![axis]! : 0;
  const lightTrend = trend(recentHsl, 2);
  const couplingTrend = trend(recentShapes, 2);
  const breadthTrend = trend(recentShapes, 0);
  const head = hsl.at(-1)!;
  const projectCount = new Set(
    header("projects")
      .split(",")
      .flatMap((pair) => {
        const [project, note] = pair.split("=");
        return project && note ? [project.trim()] : [];
      }),
  ).size;
  if (couplingTrend > 0.3) warnings.push("coupling climbing fast");
  if (head[1] < 15 && projectCount > 1) warnings.push("very diffuse focus");
  if (head[2] < 35) warnings.push("vitality low");
  if (lightTrend < -10) warnings.push("vitality declining");
  if (breadthTrend < -0.3 && couplingTrend > 0.2) warnings.push("tunneling");
  if (flooredCount >= 3) warnings.push(`recognition deficit: ${flooredCount} traits at σ floor`);

  return {
    score,
    action: score > HEALTH_PROACTIVE ? "proactive" : score > HEALTH_INTERNAL ? "internal" : "none",
    components: { uncertainty: u, negStreak: n, staleTension: t, drift: d, silence: s },
    maxSigma,
    maxNegStreak,
    maxTensionAge,
    silenceHours,
    colorDrift,
    reasons: reasons.slice(0, 3),
    warnings,
  };
}

const AUDIT_MAX_LINE = 400;

/** Port of the CLI's per-anima `audit` checks (audit.ts), which only print. */
export function auditAnima(input: {
  readonly agentContent: string;
  /** Keyed by file name, e.g. `003.breath`. */
  readonly breathFiles: ReadonlyMap<string, string>;
  readonly hasIdentity: boolean;
}): ReadonlyArray<AnimaAuditFinding> {
  const findings: Array<AnimaAuditFinding> = [];
  const push = (level: AnimaAuditFinding["level"], message: string) =>
    findings.push({ level, message });
  const breaths = parseAgentFile(input.agentContent).breaths;
  const dataLines = input.agentContent.split("\n").filter((line) => /^\d+\|/.test(line));
  if (breaths > 0 && dataLines.length !== breaths + 1)
    push(
      "error",
      `breath count mismatch: header says ${breaths}, found ${dataLines.length} data lines (expected ${breaths + 1})`,
    );
  for (const line of dataLines) {
    const parts = line.split("|");
    const index = Number.parseInt(parts[0]!, 10);
    const offset = isTimestampedRow(parts) ? 1 : 0;
    const hslField = parts[1 + offset] ?? "";
    const shapeField = parts[3 + offset] ?? "";
    const graphField = parts[4 + offset] ?? "";
    if (hslField.split(/[.,]/).map(Number).some(Number.isNaN))
      push("error", `breath ${index}: NaN in HSL (${hslField})`);
    if (/^\d+\.\d+\.\d+$/.test(hslField)) push("info", `breath ${index}: dot-separated HSL`);
    if (shapeField && shapeField.split(/[+/]/).map(Number).some(Number.isNaN))
      push("warn", `breath ${index}: NaN in shape/drift`);
    if (line.length > AUDIT_MAX_LINE)
      push("warn", `breath ${index}: line length ${line.length} (>${AUDIT_MAX_LINE})`);
    if (graphField.includes(":") && graphField.length > 60)
      push("info", `breath ${index}: graph not compressed (${graphField.length} chars)`);
    const detail = input.breathFiles.get(breathFileName(index));
    if (detail === undefined) push("warn", `breath ${index}: missing detail file`);
    else if ((/^# decisions: (.*)$/m.exec(detail)?.[1] ?? "").trim() === "")
      push("info", `breath ${index}: empty decisions in detail file`);
  }
  if (!input.hasIdentity) push("warn", "no identity.md");
  return findings;
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
    path === "appearance.json" ||
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

function breathKey(entry: string): string {
  const hash = entry.slice(entry.indexOf(":") + 1);
  return hash === "" ? entry : hash;
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
  // A breath is the same breath under any number: merging renumbers, the hash stays.
  const localKeys = new Set(local.chain.map(breathKey));
  const incomingKeys = new Set(incoming.chain.map(breathKey));
  const localOnlyBreaths = [...localKeys].filter((key) => !incomingKeys.has(key)).length;
  const incomingOnlyBreaths = [...incomingKeys].filter((key) => !localKeys.has(key)).length;
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
  readonly appearance: ParsedAppearance | null;
  readonly digest: string;
  readonly health: AnimaHealthAssessment | null;
}

export function buildSummary(input: SummaryInput): AnimaSummary {
  const { agent } = input;
  const lastRow = agent.rows.at(-1);
  const projectNotes = parseProjectNotes(
    agent.header.find((line) => line.key === "projects")?.value ?? "",
  );
  // Row 0 of a new anima is a seed placeholder, not a measured breath.
  const breathed = agent.breaths > 0;
  return {
    name: input.name,
    id: agent.id,
    role: agent.role,
    born: agent.born,
    parent: agent.parent,
    accent: input.appearance?.accent ?? agent.accent,
    form: input.appearance?.form ?? null,
    breathCount: agent.breaths,
    enabled: agent.enabled,
    live: input.session?.live ?? false,
    // The CLI deletes stale session files, so the last breath is the durable fallback.
    lastActiveAt: input.session?.lastActive ?? (breathed ? (lastRow?.ts ?? null) : null),
    lastBreathAt: breathed ? (lastRow?.ts ?? null) : null,
    aim: lastRow?.aim ?? null,
    hsl: breathed ? (lastRow?.hsl ?? null) : null,
    shape: breathed ? (lastRow?.shape ?? null) : null,
    memo: agent.memo,
    vow: agent.vow,
    voice: parseIdentityVoice(input.identity),
    projects: agent.projects,
    team: agent.team,
    tensions: parseTensions(
      agent.header.find((line) => line.key === "tension")?.value ?? "",
    ).toSorted((a, b) => b.age - a.age),
    kin: parseKin(agent.header.find((line) => line.key === "kin")?.value ?? ""),
    homeProject: agent.projectPath
      ? (agent.projectPath.split("/").findLast(Boolean) ?? null)
      : null,
    topSkills: agent.skills.toSorted((left, right) => right.mean - left.mean).slice(0, 5),
    inboxCount: input.inbox.length,
    policyCount: input.policy.operational.length,
    health: input.health?.score ?? null,
    healthAction: input.health?.action ?? null,
    healthReasons: input.health?.reasons ?? [],
    healthWarnings: input.health?.warnings ?? [],
    identityHsl: breathed ? identityHsl(agent.rows) : null,
    ...(Object.keys(projectNotes).length > 0 ? { projectNotes } : {}),
    digest: input.digest,
  };
}

const SNIPPET_RADIUS = 60;

export interface ScoredSearchHit {
  readonly hit: AnimaSearchHit;
  /** Higher sorts first; mirrors the original dashboard's ranking. */
  readonly score: number;
}

/** Case-insensitive substring score: exact beats prefix beats an early match beats a late one. */
function matchScore(text: string, needle: string): number {
  const lower = text.toLowerCase();
  if (lower === needle) return 100;
  const at = lower.indexOf(needle);
  if (at === 0) return 80;
  return at > 0 ? 60 - Math.min(at, 30) : 0;
}

/** Text around the first match on one line, with `...` where it was cut. */
function snippetAround(text: string, needle: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(needle);
  if (at < 0) return flat.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(flat.length, at + needle.length + SNIPPET_RADIUS);
  return `${start > 0 ? "..." : ""}${flat.slice(start, end)}${end < flat.length ? "..." : ""}`;
}

/** The CLI appends `--flag value` options to some aims; they are not part of the aim. */
const cleanAim = (aim: string) =>
  aim
    .replace(/\s*--\w+\s+"[^"]*"/g, "")
    .replace(/\s*--\w+\s+\S+/g, "")
    .trim();

const unslug = (value: string) => value.replace(/[-_]/g, " ");

export interface SearchableAnima {
  readonly name: string;
  readonly agentContent: string;
  readonly identity: string;
  /** Keyed by file name, e.g. `003.breath`. */
  readonly breathFiles: ReadonlyMap<string, string>;
}

/**
 * Port of the original dashboard's deep search over one anima: header fields, every aim it held,
 * decisions and open questions from its breaths, the rest of each breath, and identity sections.
 */
export function searchAnima(anima: SearchableAnima, query: string): ReadonlyArray<ScoredSearchHit> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const agent = parseAgentFile(anima.agentContent);
  const out: Array<ScoredSearchHit> = [];
  const push = (
    score: number,
    hit: Omit<AnimaSearchHit, "anima" | "breath" | "status"> &
      Partial<Pick<AnimaSearchHit, "breath" | "status">>,
  ) =>
    out.push({
      score,
      hit: { anima: anima.name, breath: null, status: null, ...hit },
    });

  const nameScore = matchScore(anima.name, needle);
  if (nameScore > 0)
    push(nameScore + 20, {
      type: "anima",
      title: anima.name,
      snippet: `${agent.role} · ${agent.breaths} breaths · born ${agent.born}`,
    });
  for (const [type, value] of [
    ["vow", agent.vow],
    ["memo", agent.memo],
  ] as const) {
    const score = value === null ? 0 : matchScore(value, needle);
    if (score > 0)
      push(score, {
        type,
        title: `${anima.name} ${type}`,
        snippet: snippetAround(value!, needle),
      });
  }
  for (const { slug, age } of parseTensions(
    agent.header.find((line) => line.key === "tension")?.value ?? "",
  )) {
    const score = matchScore(slug, needle) || matchScore(unslug(slug), needle);
    if (score > 0)
      push(score + 5, {
        type: "tension",
        title: unslug(slug),
        snippet: `Open tension, ${age} ${age === 1 ? "breath" : "breaths"} old`,
      });
  }
  for (const skill of agent.skills) {
    const score = matchScore(skill.name, needle) || matchScore(unslug(skill.name), needle);
    if (score > 0)
      push(score, {
        type: "skill",
        title: unslug(skill.name),
        snippet: `${anima.name} · ${skill.mean.toFixed(2)}`,
      });
  }

  const newestFirst = agent.rows.toReversed();
  const seenAims = new Set<string>();
  for (const row of newestFirst) {
    const aim = row.aim === null ? "" : cleanAim(row.aim);
    const key = aim.toLowerCase();
    if (aim === "" || seenAims.has(key)) continue;
    seenAims.add(key);
    const score = matchScore(aim, needle);
    if (score > 0)
      push(score, {
        type: "aim",
        title: aim,
        snippet: snippetAround(aim, needle),
        breath: row.index,
      });
  }

  const seenDecisions = new Set<string>();
  const decision = (text: string, status: "done" | "open", breath: number) => {
    const key = `${status}:${text.toLowerCase()}`;
    if (seenDecisions.has(key)) return false;
    const score = matchScore(text, needle) || matchScore(unslug(text), needle);
    if (score === 0) return false;
    seenDecisions.add(key);
    push(score, {
      type: "decision",
      title: text.length > 120 ? `${text.slice(0, 117)}...` : text,
      snippet: snippetAround(text, needle),
      breath,
      status,
    });
    return true;
  };
  const details = [...anima.breathFiles]
    .flatMap(([fileName, content]) => {
      const parsed = parseBreathFile(content, fileName);
      return parsed === null ? [] : [{ parsed, content }];
    })
    .toSorted((left, right) => right.parsed.index - left.parsed.index);
  for (const { parsed, content } of details) {
    let matched = false;
    for (const text of parsed.decisions) matched = decision(text, "done", parsed.index) || matched;
    for (const text of parsed.open) matched = decision(text, "open", parsed.index) || matched;
    // The breath header line carries only ids and hashes.
    const rest = content
      .split("\n")
      .filter((line) => !line.startsWith("# breath:"))
      .join("\n");
    const score = matchScore(rest, needle);
    if (!matched && score > 0)
      push(score - 5, {
        type: "breath",
        title: `breath ${parsed.index}${parsed.ts === "" ? "" : ` · ${parsed.ts.slice(0, 10)}`}`,
        snippet: snippetAround(rest, needle),
        breath: parsed.index,
      });
  }
  // Graph labels (`slug:D`, `slug:?`) record decisions for rows that predate breath files.
  for (const row of newestFirst) {
    for (const entry of (row.graph ?? "").split(",")) {
      const [label = "", marker] = entry.split(":");
      if (marker !== "D" && marker !== "?") continue;
      if (label.trim() !== "") decision(label.trim(), marker === "D" ? "done" : "open", row.index);
    }
  }

  for (const section of anima.identity.split(/^(?=## )/m)) {
    const heading = /^##\s+(.+)$/m.exec(section)?.[1]?.trim();
    const score = matchScore(section, needle);
    if (score > 0)
      push(score - 10, {
        type: "identity",
        title: heading === undefined ? `${anima.name} identity` : `${anima.name}: ${heading}`,
        snippet: snippetAround(section.replace(/^#.*$/gm, ""), needle),
      });
  }
  return out;
}

export function searchLibraryEntry(
  slug: string,
  content: string,
  query: string,
): ScoredSearchHit | null {
  const needle = query.trim().toLowerCase();
  const score = needle === "" ? 0 : Math.max(matchScore(slug, needle), matchScore(content, needle));
  if (score === 0) return null;
  return {
    score: score - 15,
    hit: {
      type: "library",
      anima: null,
      title: libraryTitle(content) ?? unslug(slug),
      snippet: snippetAround(content.toLowerCase().includes(needle) ? content : slug, needle),
      breath: null,
      status: null,
      slug,
    },
  };
}

/** Highest score first; equal scores keep their input order. */
export function rankSearchHits(
  hits: ReadonlyArray<ScoredSearchHit>,
  limit: number,
): ReadonlyArray<AnimaSearchHit> {
  return hits
    .toSorted((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((entry) => entry.hit);
}
