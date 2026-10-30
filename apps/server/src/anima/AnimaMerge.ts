import type { AnimaBundleFile, AnimaMergeConflict } from "@t3tools/contracts";

import { ANIMA_POLICY_CAP, breathFileName, parseBreathFile } from "./AnimaFiles.ts";

/**
 * Three-way merge of two copies of one anima against their last synced state. Breaths match by
 * hash, never by number, so both lineages survive; voice changed on both sides becomes a conflict.
 */
export interface AnimaMergeOutcome {
  readonly files: ReadonlyArray<AnimaBundleFile>;
  readonly conflicts: ReadonlyArray<AnimaMergeConflict>;
}

type FileMap = ReadonlyMap<string, string>;

const AGENT = "agent.anima";
const BREATH_PATH = /^breaths\/[^/]+\.breath$/;
const ROW = /^(\d+)\|/;
const TRAIT_KEYS = new Set(["user", "self", "skills"]);
const LIST_KEYS = new Set(["projects", "team", "kin", "tension"]);
/** Hand-written voice: changed on both sides, a person decides. Every other key is CLI state. */
const VOICE_KEYS = new Set(["vow", "style", "biases", "samples", "role", "policy"]);
const CONFLICT_FILES = new Set(["identity.md", "constitution.json", "style.md"]);

interface Breath {
  readonly key: string;
  readonly index: number;
  readonly ts: string;
  readonly path: string | null;
  readonly file: string | null;
  readonly row: string | null;
}

interface Header {
  readonly versionLine: string;
  readonly idLine: string;
  readonly entries: ReadonlyArray<readonly [string, string]>;
}

function toMap(files: ReadonlyArray<AnimaBundleFile>): FileMap {
  return new Map(files.map((file) => [file.path, file.content]));
}

function splitAgent(content: string): { header: Header; rows: Map<number, string> } {
  const rows = new Map<number, string>();
  const entries: Array<readonly [string, string]> = [];
  let versionLine = "# anima v1";
  let idLine = "";
  for (const line of content.split("\n")) {
    const row = ROW.exec(line);
    if (row) {
      rows.set(Number.parseInt(row[1]!, 10), line);
    } else if (line.startsWith("# anima ")) {
      versionLine = line;
    } else if (line.startsWith("# id:")) {
      idLine = line;
    } else {
      const match = /^# ([\w-]+):\s?(.*)$/.exec(line);
      if (match) entries.push([match[1]!, match[2]!]);
    }
  }
  return { header: { versionLine, idLine, entries }, rows };
}

/** Hashes on more than one breath of a side, such as a hand-written `hash:unavailable`. */
function repeatedHashes(files: FileMap): Set<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const [path, content] of files) {
    if (!BREATH_PATH.test(path)) continue;
    const hash = parseBreathFile(content, path.slice("breaths/".length))?.hash;
    if (!hash) continue;
    if (seen.has(hash)) repeated.add(hash);
    seen.add(hash);
  }
  return repeated;
}

function breathsOf(
  files: FileMap,
  rows: ReadonlyMap<number, string>,
  placeholders: ReadonlySet<string>,
): Array<Breath> {
  const byIndex = new Map<
    number,
    { path: string | null; file: string | null; hash: string | null; ts: string }
  >();
  for (const [path, content] of files) {
    if (!BREATH_PATH.test(path)) continue;
    const parsed = parseBreathFile(content, path.slice("breaths/".length));
    if (parsed === null) continue;
    byIndex.set(parsed.index, { path, file: content, hash: parsed.hash, ts: parsed.ts });
  }
  for (const index of rows.keys()) {
    if (!byIndex.has(index)) byIndex.set(index, { path: null, file: null, hash: null, ts: "" });
  }
  return [...byIndex]
    .map(([index, entry]) => {
      const row = rows.get(index) ?? null;
      const ts = entry.ts || (row?.split("|")[1] ?? "");
      const key =
        entry.hash && !placeholders.has(entry.hash)
          ? `h:${entry.hash}`
          : `c:${ts}|${entry.file?.replace(/^.*\n/, "") ?? row?.replace(ROW, "") ?? String(index)}`;
      return { key, index, ts, path: entry.path, file: entry.file, row };
    })
    .sort((left, right) => left.index - right.index);
}

function renumberFile(content: string, index: number): string {
  return content.replace(/^# breath:\d+(.*)$/m, (_, rest: string) => {
    const parent = index === 0 ? "-" : String(index - 1);
    return `# breath:${index}${rest.replace(/parent:\S+/, `parent:${parent}`)}`;
  });
}

function mergeBreathLists(local: Array<Breath>, incoming: Array<Breath>): Array<Breath> {
  let shared = 0;
  while (
    shared < local.length &&
    shared < incoming.length &&
    local[shared]!.key === incoming[shared]!.key
  ) {
    shared += 1;
  }
  const prefix = local.slice(0, shared);
  const seen = new Set(prefix.map((breath) => breath.key));
  const rest: Array<Breath> = [];
  for (const breath of [...local.slice(shared), ...incoming.slice(shared)]) {
    if (seen.has(breath.key)) continue;
    seen.add(breath.key);
    rest.push(breath);
  }
  // Time first, then the hash, so merging the same two lineages anywhere gives the same order.
  rest.sort((left, right) =>
    left.ts === right.ts ? (left.key < right.key ? -1 : 1) : left.ts < right.ts ? -1 : 1,
  );
  const start =
    prefix.length > 0
      ? prefix.at(-1)!.index + 1
      : Math.min(local[0]?.index ?? 0, incoming[0]?.index ?? 0);
  return [
    ...prefix,
    ...rest.map((breath, offset) => {
      const index = start + offset;
      return {
        ...breath,
        index,
        path: breath.file === null ? null : `breaths/${breathFileName(index)}`,
        file: breath.file === null ? null : renumberFile(breath.file, index),
        row: breath.row?.replace(ROW, `${index}|`) ?? null,
      };
    }),
  ];
}

function itemName(item: string): string {
  return item.split(/[=:(]/, 1)[0]!.trim();
}

function items(value: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of (value ?? "").split(",")) {
    const item = raw.trim();
    if (item !== "") out.set(itemName(item), item);
  }
  return out;
}

function sigmaOf(item: string): number {
  const sigma = Number.parseFloat(/±([\d.]+)/.exec(item)?.[1] ?? "");
  return Number.isFinite(sigma) ? sigma : Number.POSITIVE_INFINITY;
}

/** Per item, three-way: one side's change wins, removals stick; a two-sided change uses `pick`. */
function mergeItems(
  base: string | undefined,
  local: string | undefined,
  incoming: string | undefined,
  pick: (local: string, incoming: string) => string,
): string {
  const b = items(base);
  const l = items(local);
  const i = items(incoming);
  const out: Array<string> = [];
  for (const name of new Set([...l.keys(), ...i.keys()])) {
    const lv = l.get(name);
    const iv = i.get(name);
    const bv = b.get(name);
    if (lv === undefined) {
      if (bv === undefined || iv !== bv) out.push(iv!);
    } else if (iv === undefined) {
      if (bv === undefined || lv !== bv) out.push(lv);
    } else if (lv === iv || iv === bv) {
      out.push(lv);
    } else if (lv === bv) {
      out.push(iv);
    } else {
      out.push(pick(lv, iv));
    }
  }
  return out.join(",");
}

/** Three-way line merge of policy.md: rules added on either side are kept, removals stick. */
function mergePolicy(
  base: string | undefined,
  local: string,
  incoming: string,
  incomingNewer: boolean,
): { readonly content: string; readonly demoted: number } {
  const lines = (text: string | undefined) => (text ?? "").split("\n");
  const baseSet = new Set(lines(base).map((line) => line.trim()));
  const localSet = new Set(lines(local).map((line) => line.trim()));
  const incomingSet = new Set(lines(incoming).map((line) => line.trim()));
  const kept = (line: string) => {
    const trimmed = line.trim();
    if (trimmed === "") return true;
    // A line one side has and the other dropped since the base was removed on purpose.
    return !(baseSet.has(trimmed) && (!localSet.has(trimmed) || !incomingSet.has(trimmed)));
  };
  const revOf = (text: string) => Number.parseInt(/^# rev: (\d+)/m.exec(text)?.[1] ?? "0", 10);
  const rev = Math.max(revOf(local), revOf(incoming)) + 1;
  const sections = new Map<string, Array<string>>();
  const order: Array<string> = [];
  // Across sections: a merge files rules over the cap under Pending, the other side may not.
  const seen = new Set<string>();
  for (const [source, text] of [
    ["local", local],
    ["incoming", incoming],
  ] as const) {
    let section = "";
    for (const line of lines(text)) {
      if (line.startsWith("## ")) section = line.trim();
      if (!sections.has(section)) {
        sections.set(section, []);
        order.push(section);
      }
      const bucket = sections.get(section)!;
      if (section === "" && line.startsWith("# rev:")) continue;
      if (line.startsWith("## ")) continue;
      if (!kept(line)) continue;
      const trimmed = line.trim();
      if (trimmed !== "" && seen.has(trimmed)) continue;
      seen.add(trimmed);
      if (trimmed === "" && source === "incoming") continue;
      bucket.push(line);
    }
  }
  const operational = sections.get("## Operational");
  let demoted = 0;
  if (operational) {
    const rules = operational.filter((line) => line.trim() !== "");
    if (rules.length > ANIMA_POLICY_CAP) {
      const surplus = rules.slice(ANIMA_POLICY_CAP);
      demoted = surplus.length;
      sections.set("## Operational", [...rules.slice(0, ANIMA_POLICY_CAP), ""]);
      if (!sections.has("## Pending")) {
        sections.set("## Pending", []);
        order.push("## Pending");
      }
      sections.get("## Pending")!.unshift(...surplus);
    }
  }
  const updated = /^# rev: \d+(.*)$/m.exec(incomingNewer ? incoming : local)?.[1] ?? "";
  const out: Array<string> = [];
  for (const section of order) {
    const body = sections.get(section)!;
    if (section === "") {
      const titleAt = body.findIndex((line) => line.startsWith("# "));
      out.push(
        ...body.slice(0, titleAt + 1),
        `# rev: ${rev}${updated}`,
        ...body.slice(titleAt + 1),
      );
    } else {
      out.push(section, ...body);
    }
  }
  return { content: out.join("\n"), demoted };
}

/** Notes and logs only grow in practice: keep the longer when one extends the other, else both. */
function mergeNotes(local: string, incoming: string): string {
  if (incoming.startsWith(local)) return incoming;
  if (local.startsWith(incoming)) return local;
  const seen = new Set(local.split("\n").map((line) => line.trim()));
  const added = incoming.split("\n").filter((line) => line.trim() !== "" && !seen.has(line.trim()));
  return added.length === 0 ? local : `${local.replace(/\n*$/, "")}\n${added.join("\n")}\n`;
}

/** goals.json themes by id: every theme from both sides, the newer side's copy when both have it. */
function mergeGoals(local: string, incoming: string, incomingNewer: boolean): string | null {
  try {
    const left = JSON.parse(local) as { themes?: Array<{ id?: unknown }> };
    const right = JSON.parse(incoming) as { themes?: Array<{ id?: unknown }> };
    if (!Array.isArray(left.themes) || !Array.isArray(right.themes)) return null;
    const [older, newer] = incomingNewer ? [left, right] : [right, left];
    const themes = new Map<unknown, { id?: unknown }>();
    for (const theme of [...older.themes!, ...newer.themes!]) themes.set(theme.id, theme);
    return `${JSON.stringify({ ...older, ...newer, themes: [...themes.values()] }, null, 2)}\n`;
  } catch {
    return null;
  }
}

export function mergeAnimaFiles(input: {
  readonly local: ReadonlyArray<AnimaBundleFile>;
  readonly incoming: ReadonlyArray<AnimaBundleFile>;
  readonly base: ReadonlyArray<AnimaBundleFile> | null;
}): AnimaMergeOutcome {
  const local = toMap(input.local);
  const incoming = toMap(input.incoming);
  const base = input.base === null ? null : toMap(input.base);
  const localAgent = splitAgent(local.get(AGENT) ?? "");
  const incomingAgent = splitAgent(incoming.get(AGENT) ?? "");
  const baseAgent = base === null ? null : splitAgent(base.get(AGENT) ?? "");

  const placeholders = new Set([...repeatedHashes(local), ...repeatedHashes(incoming)]);
  const localBreaths = breathsOf(local, localAgent.rows, placeholders);
  const incomingBreaths = breathsOf(incoming, incomingAgent.rows, placeholders);
  const breaths = mergeBreathLists(localBreaths, incomingBreaths);
  const lastTs = (list: Array<Breath>) =>
    list.reduce((latest, breath) => (breath.ts > latest ? breath.ts : latest), "");
  const incomingNewer = lastTs(incomingBreaths) > lastTs(localBreaths);
  const newer = (l: string, i: string) => (incomingNewer ? i : l);
  const conflicts: Array<AnimaMergeConflict> = [];

  const localHeader = new Map(localAgent.header.entries);
  const incomingHeader = new Map(incomingAgent.header.entries);
  const baseHeader = new Map(baseAgent?.header.entries ?? []);
  const keys = [
    ...new Set([
      ...localAgent.header.entries.map(([key]) => key),
      ...incomingAgent.header.entries.map(([key]) => key),
    ]),
  ];
  const headerLines: Array<string> = [];
  for (const key of keys) {
    const l = localHeader.get(key);
    const i = incomingHeader.get(key);
    const b = baseAgent === null ? undefined : baseHeader.get(key);
    const known = baseAgent !== null;
    let value: string | undefined;
    if (l === i) value = l;
    else if (l === undefined) value = known && b === i ? undefined : i;
    else if (i === undefined) value = known && b === l ? undefined : l;
    else if (known && b === l) value = i;
    else if (known && b === i) value = l;
    else if (TRAIT_KEYS.has(key))
      value = mergeItems(b, l, i, (lv, iv) =>
        sigmaOf(iv) < sigmaOf(lv) || (sigmaOf(iv) === sigmaOf(lv) && incomingNewer) ? iv : lv,
      );
    else if (LIST_KEYS.has(key)) value = mergeItems(b, l, i, newer);
    else if (VOICE_KEYS.has(key)) {
      value = newer(l, i);
      conflicts.push({ path: AGENT, key, local: l, incoming: i, draft: value });
    } else value = newer(l, i);
    if (value !== undefined) headerLines.push(`# ${key}: ${value}`.trimEnd());
  }

  const last = breaths.at(-1)?.index ?? 0;
  const accentSource = incomingNewer ? incomingAgent.header.idLine : localAgent.header.idLine;
  const accent = /accent:(\S+)/.exec(accentSource)?.[1];
  const idLine = (localAgent.header.idLine || incomingAgent.header.idLine)
    .replace(/breaths:\d+/, `breaths:${last}`)
    .replace(/accent:\S+/, accent ? `accent:${accent}` : "$&");
  const agent = [
    localAgent.header.versionLine,
    idLine,
    ...headerLines,
    ...breaths.flatMap((breath) => (breath.row === null ? [] : [breath.row])),
  ].join("\n");

  const files: Array<AnimaBundleFile> = [{ path: AGENT, content: `${agent}\n` }];
  for (const breath of breaths) {
    if (breath.path !== null && breath.file !== null)
      files.push({ path: breath.path, content: breath.file });
  }
  const paths = [...new Set([...local.keys(), ...incoming.keys()])]
    .filter((path) => path !== AGENT && !BREATH_PATH.test(path))
    .sort();
  for (const path of paths) {
    const l = local.get(path);
    const i = incoming.get(path);
    const b = base?.get(path);
    let content: string | undefined;
    if (l === i) content = l;
    else if (l === undefined) content = base !== null && b === i ? undefined : i;
    else if (i === undefined) content = base !== null && b === l ? undefined : l;
    else if (base !== null && b === l) content = i;
    else if (base !== null && b === i) content = l;
    else if (path === "policy.md") {
      const policy = mergePolicy(b, l, i, incomingNewer);
      content = policy.content;
      // Over the cap, the draft parks the surplus in Pending, which is inactive: a person picks.
      if (policy.demoted > 0)
        conflicts.push({ path, key: null, local: l, incoming: i, draft: content });
    } else if (path === "goals.json") content = mergeGoals(l, i, incomingNewer) ?? newer(l, i);
    else if (!CONFLICT_FILES.has(path) && /\.(md|log|txt)$/.test(path)) content = mergeNotes(l, i);
    else {
      content = newer(l, i);
      if (CONFLICT_FILES.has(path))
        conflicts.push({ path, key: null, local: l, incoming: i, draft: content });
    }
    if (content !== undefined) files.push({ path, content });
  }
  return { files, conflicts };
}
