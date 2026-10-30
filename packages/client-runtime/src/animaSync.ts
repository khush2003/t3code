import type {
  AnimaBundle,
  AnimaCompareResult,
  AnimaMergeConflict,
  AnimaMergeStartResult,
  AnimaMutationResult,
  AnimaName,
  AnimaSummary,
  AnimaSyncRelation,
  EnvironmentId,
  ModelSelection,
  ProjectId,
} from "@t3tools/contracts";

export type AnimaQuickState = "only-here" | "only-there" | "identical" | "different" | "unrelated";

/** Cheap pre-check from list summaries alone, before any bundle is exported. */
export function quickAnimaState(
  here: Pick<AnimaSummary, "id" | "digest"> | null,
  there: Pick<AnimaSummary, "id" | "digest"> | null,
): AnimaQuickState {
  if (here === null && there === null) return "identical";
  if (there === null) return "only-here";
  if (here === null) return "only-there";
  if (here.id !== there.id) return "unrelated";
  return here.digest === there.digest ? "identical" : "different";
}

export type AnimaPairSyncResult =
  | { readonly status: "in-sync" }
  | { readonly status: "synced" }
  | { readonly status: "conflicts"; readonly conflicts: ReadonlyArray<AnimaMergeConflict> }
  | { readonly status: "unrelated" };

/**
 * Brings both machines to one merged anima: the first merges the second's copy in, then the second
 * takes the result. Never overwrites a side; stops at conflicts a person must decide. `present`
 * says which side has the anima, from the list both clients already read.
 */
export async function syncAnimaPair(
  input: {
    readonly name: AnimaName;
    readonly first: EnvironmentId;
    readonly second: EnvironmentId;
    readonly present: { readonly first: boolean; readonly second: boolean };
  },
  ports: AnimaSyncPorts,
): Promise<AnimaPairSyncResult> {
  const { name, first, second, present } = input;
  if (!present.first && !present.second) return { status: "in-sync" };
  if (!present.first || !present.second) {
    const [from, to] = present.first ? [first, second] : [second, first];
    await ports.importBundle(to, { bundle: await ports.exportBundle(from, name), mode: "create" });
    return { status: "synced" };
  }
  const [firstBundle, secondBundle] = await Promise.all([
    ports.exportBundle(first, name),
    ports.exportBundle(second, name),
  ]);
  const compare = await ports.compare(first, secondBundle);
  if (compare.relation === "unrelated") return { status: "unrelated" };
  if (compare.conflicts && compare.conflicts.length > 0)
    return { status: "conflicts", conflicts: compare.conflicts };
  // Identical copies still record the shared state, the base for the next three-way merge.
  await ports.importBundle(first, { bundle: secondBundle, mode: "merge" });
  const merged =
    firstBundle.digest === secondBundle.digest
      ? firstBundle
      : await ports.exportBundle(first, name);
  // The merge already holds everything the second machine had, so it only has to catch up.
  await ports.importBundle(second, {
    bundle: merged,
    mode: merged.digest === secondBundle.digest ? "merge" : "fast-forward",
  });
  return { status: compare.relation === "identical" ? "in-sync" : "synced" };
}

export function animaSyncRelationLabel(relation: AnimaSyncRelation): string {
  switch (relation) {
    case "missing":
      return "Not on the other side";
    case "identical":
      return "Identical";
    case "incoming-ahead":
      return "Incoming is ahead";
    case "local-ahead":
      return "Destination is ahead";
    case "diverged":
      return "Diverged";
    case "unrelated":
      return "Different anima with the same name";
  }
}

/** Environment-addressed calls the sync flow needs; each rejects with an Error on failure. */
export interface AnimaSyncPorts {
  readonly exportBundle: (environmentId: EnvironmentId, name: AnimaName) => Promise<AnimaBundle>;
  readonly compare: (
    environmentId: EnvironmentId,
    bundle: AnimaBundle,
  ) => Promise<AnimaCompareResult>;
  readonly importBundle: (
    environmentId: EnvironmentId,
    input: {
      readonly bundle: AnimaBundle;
      readonly mode: "create" | "replace" | "fast-forward" | "merge";
    },
  ) => Promise<AnimaMutationResult>;
  readonly mergeStart: (
    environmentId: EnvironmentId,
    input: {
      readonly bundle: AnimaBundle;
      readonly projectId?: ProjectId;
      readonly modelSelection?: ModelSelection;
      readonly localLabel?: string;
      readonly incomingLabel?: string;
    },
  ) => Promise<AnimaMergeStartResult>;
}

export interface AnimaBreathRow {
  readonly index: number;
  readonly at: string | null;
  readonly hsl: string | null;
  readonly aim: string | null;
}

export interface AnimaHeaderChange {
  readonly key: string;
  readonly source: string | null;
  readonly destination: string | null;
}

export type AnimaDiffLine =
  | { readonly kind: "same" | "add" | "remove"; readonly text: string }
  | { readonly kind: "gap"; readonly count: number };

export interface AnimaFileChange {
  readonly path: string;
  readonly status: "only-source" | "only-destination" | "changed";
  readonly added: number;
  readonly removed: number;
  /** Destination to source, with unchanged runs collapsed; null when too large to diff. */
  readonly lines: ReadonlyArray<AnimaDiffLine> | null;
}

export interface AnimaBundleDiff {
  readonly sharedBreaths: number;
  readonly sourceOnly: ReadonlyArray<AnimaBreathRow>;
  readonly destinationOnly: ReadonlyArray<AnimaBreathRow>;
  readonly header: ReadonlyArray<AnimaHeaderChange>;
  readonly files: ReadonlyArray<AnimaFileChange>;
}

const ANIMA_FILE = "agent.anima";
const BREATH_PATH = /^breaths\/[^/]+\.breath$/;
const DIFF_CONTEXT = 2;
const DIFF_CELL_LIMIT = 4_000_000;

function animaHeader(content: string | undefined): Map<string, string> {
  const header = new Map<string, string>();
  for (const line of content?.split("\n") ?? []) {
    const match = /^# ([\w-]+):\s?(.*)$/.exec(line);
    if (match) header.set(match[1]!, match[2]!.trim());
  }
  return header;
}

function breathRows(content: string | undefined): Map<number, AnimaBreathRow> {
  const rows = new Map<number, AnimaBreathRow>();
  for (const line of content?.split("\n") ?? []) {
    if (!/^\d+\|/.test(line)) continue;
    const fields = line.split("|");
    const index = Number.parseInt(fields[0]!, 10);
    rows.set(index, {
      index,
      at: fields[1] || null,
      hsl: fields[2] || null,
      aim: fields[6]?.trim() || null,
    });
  }
  return rows;
}

/** `# breath:N ts:...` then `# <summary>`: the breath file's own account, for rows with no aim. */
function breathSummaries(files: ReadonlyMap<string, string>): Map<number, AnimaBreathRow> {
  const summaries = new Map<number, AnimaBreathRow>();
  for (const [path, content] of files) {
    if (!BREATH_PATH.test(path)) continue;
    const [first = "", second = ""] = content.split("\n", 2);
    const head = /^# breath:(\d+)(?:.*\bts:(\S+))?/.exec(first);
    if (!head) continue;
    const summary = /^# (?!\w+:)(.+)$/.exec(second)?.[1]?.split(" | ")[0]?.trim();
    const index = Number.parseInt(head[1]!, 10);
    summaries.set(index, { index, at: head[2] ?? null, hsl: null, aim: summary || null });
  }
  return summaries;
}

function lineDiff(before: ReadonlyArray<string>, after: ReadonlyArray<string>) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  const left = before.slice(start, before.length - end);
  const right = after.slice(start, after.length - end);
  if (left.length * right.length > DIFF_CELL_LIMIT) return null;
  // Longest common subsequence table, filled from the end so the walk below reads forward.
  const width = right.length + 1;
  const table = new Uint32Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        left[i] === right[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const middle: Array<{ kind: "same" | "add" | "remove"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      middle.push({ kind: "same", text: left[i]! });
      i += 1;
      j += 1;
    } else if (
      i < left.length &&
      (j >= right.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)
    ) {
      middle.push({ kind: "remove", text: left[i]! });
      i += 1;
    } else {
      middle.push({ kind: "add", text: right[j]! });
      j += 1;
    }
  }
  return [
    ...before.slice(0, start).map((text) => ({ kind: "same" as const, text })),
    ...middle,
    ...before.slice(before.length - end).map((text) => ({ kind: "same" as const, text })),
  ];
}

function collapse(
  lines: ReadonlyArray<{ kind: "same" | "add" | "remove"; text: string }>,
): ReadonlyArray<AnimaDiffLine> {
  const near = lines.map((line) => line.kind !== "same");
  const keep = lines.map((_, index) =>
    near
      .slice(Math.max(0, index - DIFF_CONTEXT), index + DIFF_CONTEXT + 1)
      .some((changed) => changed),
  );
  const out: Array<AnimaDiffLine> = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (!keep[index]) {
      skipped += 1;
      return;
    }
    if (skipped > 0) out.push({ kind: "gap", count: skipped });
    skipped = 0;
    out.push(line);
  });
  if (skipped > 0) out.push({ kind: "gap", count: skipped });
  return out;
}

function fileChange(
  path: string,
  source: string | undefined,
  destination: string | undefined,
): AnimaFileChange {
  const diff = lineDiff(destination?.split("\n") ?? [], source?.split("\n") ?? []);
  return {
    path,
    status:
      destination === undefined
        ? "only-source"
        : source === undefined
          ? "only-destination"
          : "changed",
    added: diff?.filter((line) => line.kind === "add").length ?? 0,
    removed: diff?.filter((line) => line.kind === "remove").length ?? 0,
    lines: diff === null ? null : collapse(diff),
  };
}

/**
 * What differs between two exports of an anima: breaths each side lacks, `agent.anima` header
 * fields, and line diffs of every other file. Breath files and `agent.anima` rows are reported as
 * breaths rather than as file changes.
 */
export function diffAnimaBundles(
  source: AnimaBundle,
  destination: AnimaBundle | null,
): AnimaBundleDiff {
  const sourceFiles = new Map(source.files.map((file) => [file.path, file.content]));
  const destinationFiles = new Map(destination?.files.map((file) => [file.path, file.content]));
  const sourceChain = new Set(source.breathChain);
  const destinationChain = new Set(destination?.breathChain ?? []);
  const rowsOf = (
    chain: ReadonlyArray<string>,
    other: Set<string>,
    files: ReadonlyMap<string, string>,
  ) => {
    const rows = breathRows(files.get(ANIMA_FILE));
    const summaries = breathSummaries(files);
    return chain
      .filter((entry) => !other.has(entry))
      .map((entry) => {
        const index = Number.parseInt(entry, 10);
        const row = rows.get(index);
        const summary = summaries.get(index);
        return {
          index,
          at: row?.at ?? summary?.at ?? null,
          hsl: row?.hsl ?? null,
          aim: row?.aim ?? summary?.aim ?? null,
        };
      })
      .reverse();
  };
  const sourceHeader = animaHeader(sourceFiles.get(ANIMA_FILE));
  const destinationHeader = animaHeader(destinationFiles.get(ANIMA_FILE));
  const header = [...new Set([...sourceHeader.keys(), ...destinationHeader.keys()])]
    .filter((key) => sourceHeader.get(key) !== destinationHeader.get(key))
    .map((key) => ({
      key,
      source: sourceHeader.get(key) ?? null,
      destination: destinationHeader.get(key) ?? null,
    }));
  const files = [...new Set([...sourceFiles.keys(), ...destinationFiles.keys()])]
    .filter(
      (path) =>
        path !== ANIMA_FILE &&
        !BREATH_PATH.test(path) &&
        sourceFiles.get(path) !== destinationFiles.get(path),
    )
    .sort()
    .map((path) => fileChange(path, sourceFiles.get(path), destinationFiles.get(path)));
  return {
    sharedBreaths: source.breathChain.filter((entry) => destinationChain.has(entry)).length,
    sourceOnly: rowsOf(source.breathChain, destinationChain, sourceFiles),
    destinationOnly: destination
      ? rowsOf(destination.breathChain, sourceChain, destinationFiles)
      : [],
    header,
    files,
  };
}
