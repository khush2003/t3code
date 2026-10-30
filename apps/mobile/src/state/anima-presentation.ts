import type {
  AnimaBreath,
  AnimaDetail,
  AnimaLibraryEntry,
  AnimaName,
  AnimaRecordInput,
  AnimaSearchHit,
  AnimaSummary,
  AnimaTrait,
} from "@t3tools/contracts";

/** Accents come from files on the server's disk, so only colour syntaxes React Native parses reach a style. */
const SAFE_ACCENT = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([0-9.,%\s]+\))$/i;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The latest breath's `H,S,L` is the anima's current colour; the identity accent is the fallback. */
export function animaColor(anima: Pick<AnimaSummary, "hsl" | "accent">): string | null {
  const parts = anima.hsl?.split(",").map((part) => Number.parseFloat(part)) ?? [];
  const [hue, saturation, lightness] = parts;
  if (
    hue !== undefined &&
    saturation !== undefined &&
    lightness !== undefined &&
    Number.isFinite(hue) &&
    Number.isFinite(saturation) &&
    Number.isFinite(lightness)
  ) {
    // Lightness is clamped like web so near-black and near-white breaths stay visible on both themes.
    return `hsl(${Math.round(((hue % 360) + 360) % 360)}, ${clamp(saturation, 0, 100)}%, ${clamp(lightness, 18, 92)}%)`;
  }
  const accent = anima.accent?.trim() ?? "";
  return SAFE_ACCENT.test(accent) ? accent : null;
}

/** The CLI's score rises with need, so it is inverted to read as health. */
export function animaHealthLabel(health: number | null): string | null {
  return health === null || !Number.isFinite(health)
    ? null
    : `${Math.round((1 - clamp(health, 0, 1)) * 100)}% healthy`;
}

export const ANIMA_BREATH_POLL_INTERVAL_MS = 4_000;
const ANIMA_BREATH_TIMEOUT_MS = 180_000;

export type AnimaBreathStatus =
  | { readonly kind: "requesting" }
  | {
      readonly kind: "breathing";
      readonly queued: boolean;
      readonly breathCountBefore: number;
      readonly startedAt: number;
    }
  | { readonly kind: "recorded"; readonly breathCount: number }
  | { readonly kind: "timeout" }
  | { readonly kind: "failed"; readonly message: string };

/** A breath has landed once the summary's count passes the count read when it was requested. */
export function advanceAnimaBreath(
  status: Extract<AnimaBreathStatus, { kind: "breathing" }>,
  breathCount: number | null,
  now: number,
): AnimaBreathStatus {
  if (breathCount !== null && breathCount > status.breathCountBefore) {
    return { kind: "recorded", breathCount };
  }
  return now - status.startedAt >= ANIMA_BREATH_TIMEOUT_MS ? { kind: "timeout" } : status;
}

export function animaBreathStatusLabel(status: AnimaBreathStatus | null): string | null {
  switch (status?.kind) {
    case undefined:
      return null;
    case "requesting":
      return "Requesting a breath…";
    case "breathing":
      return status.queued ? "Queued. Breathes when this turn finishes" : "Breathing…";
    case "recorded":
      return `Breath ${status.breathCount} recorded`;
    case "timeout":
      return "No breath was recorded yet; check the thread";
    case "failed":
      return status.message;
  }
}

type AnimaHealthBucket = "unknown" | "steady" | "watch" | "tend";

/** The CLI tends internally above 0.35 and proactively above 0.6. */
export function animaHealthBucket(score: number | null | undefined): AnimaHealthBucket {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unknown";
  if (score > 0.6) return "tend";
  if (score > 0.35) return "watch";
  return "steady";
}

/** Inverted so a fuller ring reads as healthier. */
export function animaWellness(score: number | null | undefined): number | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return Math.round((1 - clamp(score, 0, 1)) * 100);
}

export function animaNeedsTending(anima: Pick<AnimaSummary, "health">): boolean {
  const bucket = animaHealthBucket(anima.health);
  return bucket === "watch" || bucket === "tend";
}

export function animaHealthNotes(
  anima: Pick<AnimaSummary, "healthWarnings" | "healthReasons">,
): ReadonlyArray<string> {
  return [...(anima.healthWarnings ?? []), ...(anima.healthReasons ?? [])];
}

export function animaPoolTotals(animas: ReadonlyArray<AnimaSummary>) {
  let breaths = 0;
  let live = 0;
  let tending = 0;
  let unread = 0;
  for (const anima of animas) {
    breaths += anima.breathCount;
    if (anima.live) live += 1;
    if (animaNeedsTending(anima)) tending += 1;
    unread += anima.inboxCount;
  }
  return { animas: animas.length, breaths, live, tending, unread };
}

const byNeed = (a: Pick<AnimaSummary, "health">, b: Pick<AnimaSummary, "health">) =>
  (b.health ?? -1) - (a.health ?? -1);

/** Enabled animas the CLI would tend, or that carry warnings, most in need first. */
export function animaAlerts<T extends AnimaSummary>(animas: ReadonlyArray<T>): Array<T> {
  return animas
    .filter(
      (anima) =>
        anima.enabled && (animaNeedsTending(anima) || (anima.healthWarnings?.length ?? 0) > 0),
    )
    .sort(byNeed);
}

export function animasByNeed<T extends AnimaSummary>(animas: ReadonlyArray<T>): Array<T> {
  return [...animas].sort(byNeed);
}

/** Reads a `# tension:` slug as a sentence, dropping age markers that leak in from commas. */
export function tensionText(slug: string): string {
  return slug
    .replace(/\(\d+\)$/, "")
    .replace(/:\d+$/, "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s*:\s*/g, ": ")
    .trim();
}

interface BoardTension {
  readonly anima: AnimaName;
  readonly slug: string;
  readonly text: string;
  readonly age: number;
}

/** Every anima's open tensions, oldest first. */
export function tensionBoard(
  animas: ReadonlyArray<Pick<AnimaSummary, "name" | "tensions">>,
): Array<BoardTension> {
  return animas
    .flatMap((anima) =>
      (anima.tensions ?? []).map((tension) => ({
        anima: anima.name,
        slug: tension.slug,
        age: tension.age,
        text: tensionText(tension.slug),
      })),
    )
    .sort((a, b) => b.age - a.age || a.anima.localeCompare(b.anima));
}

const HOUR_MS = 3_600_000;
const ANIMA_PULSE_WINDOW_HOURS = 48;

export function animaLastSeen(anima: Pick<AnimaSummary, "lastActiveAt" | "lastBreathAt">) {
  return anima.lastActiveAt ?? anima.lastBreathAt;
}

/** Animas active in the last 48 hours, most recent first; `x` runs from 48h ago (0) to now (1). */
export function animaPulse<T extends Pick<AnimaSummary, "lastActiveAt" | "lastBreathAt">>(
  animas: ReadonlyArray<T>,
  now: number,
): Array<{ readonly anima: T; readonly x: number; readonly hoursAgo: number }> {
  return animas
    .flatMap((anima) => {
      const seen = animaLastSeen(anima);
      const hoursAgo = (now - (seen === null ? Number.NaN : Date.parse(seen))) / HOUR_MS;
      if (!Number.isFinite(hoursAgo) || hoursAgo > ANIMA_PULSE_WINDOW_HOURS) return [];
      const clamped = Math.max(0, hoursAgo);
      return [{ anima, x: 1 - clamped / ANIMA_PULSE_WINDOW_HOURS, hoursAgo: clamped }];
    })
    .sort((a, b) => a.hoursAgo - b.hoursAgo);
}

/** An older T3 server rejects requests it does not know as a defect carrying this text. */
export function isUnsupportedAnimaRequest(error: unknown): boolean {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /Unknown request tag: \S+/.test(text);
}

type SearchType = AnimaSearchHit["type"];

const ANIMA_SEARCH_GROUPS: ReadonlyArray<{
  readonly type: SearchType;
  readonly label: string;
}> = [
  { type: "anima", label: "Animas" },
  { type: "aim", label: "Aims" },
  { type: "tension", label: "Tensions" },
  { type: "decision", label: "Decisions and open questions" },
  { type: "breath", label: "Breaths" },
  { type: "vow", label: "Vows" },
  { type: "memo", label: "Memos" },
  { type: "skill", label: "Skills" },
  { type: "identity", label: "Identity" },
  { type: "library", label: "Library" },
];

function matchScore(text: string, needle: string): number {
  const haystack = text.toLowerCase();
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 80;
  const at = haystack.indexOf(needle);
  return at >= 0 ? 60 - Math.min(at, 30) : 0;
}

export const ANIMA_SEARCH_MIN_LENGTH = 2;

/**
 * What the roster already knows about each anima, in the server's hit shape, so results read the
 * same while the server answers and on servers without `anima.search`.
 */
export function searchAnimasLocally(
  animas: ReadonlyArray<
    Pick<AnimaSummary, "name" | "aim" | "vow" | "memo" | "tensions" | "topSkills">
  >,
  query: string,
  limit = 24,
): Array<AnimaSearchHit> {
  const needle = query.trim().toLowerCase();
  if (needle.length < ANIMA_SEARCH_MIN_LENGTH) return [];
  const hits: Array<{ hit: AnimaSearchHit; score: number }> = [];
  const consider = (
    anima: AnimaSummary["name"],
    type: SearchType,
    text: string | null | undefined,
  ) => {
    if (!text) return;
    const score = matchScore(text, needle);
    if (score === 0) return;
    hits.push({
      score: score + (type === "anima" ? 20 : 0),
      hit: {
        type,
        anima,
        title: anima,
        snippet: type === "anima" ? "" : text,
        breath: null,
        status: null,
      },
    });
  };
  for (const anima of animas) {
    consider(anima.name, "anima", anima.name);
    consider(anima.name, "aim", anima.aim);
    consider(anima.name, "vow", anima.vow);
    consider(anima.name, "memo", anima.memo);
    for (const tension of anima.tensions ?? [])
      consider(anima.name, "tension", tensionText(tension.slug));
    for (const skill of anima.topSkills) consider(anima.name, "skill", skill.name);
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.hit);
}

export function groupAnimaSearchHits(hits: ReadonlyArray<AnimaSearchHit>) {
  return ANIMA_SEARCH_GROUPS.flatMap((group) => {
    const items = hits.filter((hit) => hit.type === group.type);
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

type AnimaSearchTarget =
  | {
      readonly kind: "anima";
      readonly name: AnimaName;
      readonly tab?: "breaths" | "identity";
      readonly breath?: number;
    }
  | { readonly kind: "library"; readonly slug: string };

export function animaSearchTarget(hit: AnimaSearchHit): AnimaSearchTarget | null {
  if (hit.type === "library") return hit.slug ? { kind: "library", slug: hit.slug } : null;
  if (hit.anima === null) return null;
  if (hit.breath !== null) {
    return { kind: "anima", name: hit.anima, tab: "breaths", breath: hit.breath };
  }
  if (hit.type === "identity") return { kind: "anima", name: hit.anima, tab: "identity" };
  return { kind: "anima", name: hit.anima };
}

/** Newest first, grouped by local calendar day. */
export function breathsByDay<T extends { readonly index: number; readonly ts: string }>(
  breaths: ReadonlyArray<T>,
  now: number,
): Array<{ readonly key: string; readonly label: string; readonly breaths: Array<T> }> {
  const dayKey = (time: number) => {
    const date = new Date(time);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  };
  const today = dayKey(now);
  const yesterday = dayKey(now - 86_400_000);
  const format = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const groups: Array<{ key: string; label: string; breaths: Array<T> }> = [];
  for (const breath of [...breaths].sort((a, b) => b.index - a.index)) {
    const time = Date.parse(breath.ts);
    const key = Number.isFinite(time) ? dayKey(time) : "undated";
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.breaths.push(breath);
      continue;
    }
    groups.push({
      key,
      label:
        key === "undated"
          ? "Undated"
          : key === today
            ? "Today"
            : key === yesterday
              ? "Yesterday"
              : format.format(time),
      breaths: [breath],
    });
  }
  return groups;
}

/** Early breaths store an encoded musical note instead of prose; those are not worth showing. */
export function breathNoteText(note: string): string | null {
  const trimmed = note.trim();
  if (trimmed === "") return null;
  return /\s/.test(trimmed) || trimmed.length > 12 ? trimmed : null;
}

export function animaHeaderValue(detail: Pick<AnimaDetail, "header">, key: string): string | null {
  const value = detail.header.find((entry) => entry.key === key)?.value.trim();
  return value ? value : null;
}

/** `# samples:` reads `[tag] text,[tag] text`; commas inside a sample stay with it. */
export function parseVoiceSamples(raw: string): Array<{ tag: string; text: string }> {
  const marks = [...raw.matchAll(/\[(\w+)\]\s*/g)];
  return marks.map((mark, index) => ({
    tag: mark[1]!,
    text: raw
      .slice(mark.index + mark[0].length, marks[index + 1]?.index ?? raw.length)
      .trim()
      .replace(/,$/, ""),
  }));
}

function noteQuality(raw: string | undefined): "M" | "m" | "d" | "7" {
  const value = raw?.toLowerCase() ?? "";
  if (raw === "m" || /^(min|minor|aeolian|dorian|phrygian)/.test(value)) return "m";
  if (/^(d|dim|diminished|locrian)$/.test(value)) return "d";
  if (/^(7|dom|seventh|mixolydian)/.test(value)) return "7";
  return "M";
}

/**
 * The codec fields of a hand-recorded breath, continued from the latest breath so recording one
 * (for example to resolve a tension) does not move the anima's colour, note or shape.
 */
export function continuedBreathCodec(
  detail: Pick<AnimaDetail, "breaths" | "summary">,
): Pick<AnimaRecordInput, "name" | "hsl" | "note" | "shape"> {
  let head: AnimaBreath | null = null;
  for (const breath of detail.breaths)
    if (head === null || breath.index > head.index) head = breath;
  const hslParts = (head?.hsl ?? detail.summary.hsl ?? "")
    .split(",")
    .slice(0, 3)
    .map((part) => Number.parseFloat(part));
  const [h, s, l] = hslParts.length === 3 && hslParts.every(Number.isFinite) ? hslParts : [];
  const hue = h === undefined ? 225 : Math.round(((h % 360) + 360) % 360);
  const focus = s === undefined ? 60 : Math.round(clamp(s, 0, 100));
  const vitality = l === undefined ? 55 : Math.round(clamp(l, 0, 100));
  const parts = head?.note.trim().split(".") ?? [];
  const pitch =
    parts.length >= 4 && parts.length <= 7 ? /^([A-Ga-g])[#b]?\d?$/.exec(parts[0]!) : null;
  const velocityRaw = pitch ? Number.parseInt(parts[2] ?? "", 10) : Number.NaN;
  const velocity = Number.isFinite(velocityRaw) ? clamp(velocityRaw, 1, 127) : 60;
  const shape = head?.shape ?? detail.summary.shape;
  const unit = (value: number | undefined) =>
    (Math.round(clamp(Number.isFinite(value) ? value! : 0.5, 0, 1) * 100) / 100).toString();
  return {
    name: detail.summary.name,
    hsl: `${hue}.${focus}.${vitality}`,
    note: `${pitch ? pitch[1]!.toUpperCase() : "D"}4.${pitch ? noteQuality(parts[1]) : "M"}.${velocity}.1.2.100`,
    shape: `${unit(shape?.breadth)}/${unit(shape?.depth)}/${unit(shape?.coupling)}`,
  };
}

export function traitPercent(trait: Pick<AnimaTrait, "mean">): number {
  return Math.round(clamp(Number.isFinite(trait.mean) ? trait.mean : 0, 0, 1) * 100);
}

export function filterLibraryEntries<T extends AnimaLibraryEntry>(
  entries: ReadonlyArray<T>,
  query: string,
): Array<T> {
  const needle = query.trim().toLowerCase();
  return entries
    .filter(
      (entry) =>
        needle === "" ||
        [
          entry.slug,
          entry.title ?? "",
          entry.author ?? "",
          entry.target ?? "",
          entry.preview ?? "",
        ].some((field) => field.toLowerCase().includes(needle)),
    )
    .sort((l, r) => {
      const lm = l.modifiedAt ?? "";
      const rm = r.modifiedAt ?? "";
      return lm === rm ? l.slug.localeCompare(r.slug) : lm < rm ? 1 : -1;
    });
}

/** React keys for entries that may repeat verbatim: the text plus its occurrence count. */
export function keyedByText<T>(
  items: ReadonlyArray<T>,
  textOf: (item: T) => string,
): Array<{ readonly key: string; readonly item: T }> {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const text = textOf(item);
    const count = (seen.get(text) ?? 0) + 1;
    seen.set(text, count);
    return { key: `${count}:${text}`, item };
  });
}
