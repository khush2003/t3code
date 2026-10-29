import type { AnimaSummary } from "@t3tools/contracts";

const HOUR = 3_600_000;

/** Live animas first, then by most recent activity; the order the dashboard and detail page share. */
export function animaOrder<T extends Pick<AnimaSummary, "live" | "lastActiveAt" | "lastBreathAt">>(
  animas: ReadonlyArray<T>,
): Array<T> {
  const seen = (anima: T) => anima.lastActiveAt ?? anima.lastBreathAt ?? "";
  return animas.toSorted(
    (a, b) => Number(b.live) - Number(a.live) || seen(b).localeCompare(seen(a)),
  );
}

export const PULSE_BUCKETS = [
  { label: "Last hour", maxHours: 1 },
  { label: "Today", maxHours: 24 },
  { label: "This week", maxHours: 24 * 7 },
  { label: "This month", maxHours: 24 * 30 },
  { label: "Last 3 months", maxHours: 24 * 91 },
  { label: "Older", maxHours: Number.POSITIVE_INFINITY },
] as const;

/** Groups ids by how long ago they were last active, most recent first within each bucket. */
export function pulseBuckets<T extends { readonly at: string | null }>(
  entries: ReadonlyArray<T>,
  now: number,
): Array<Array<T>> {
  const buckets = PULSE_BUCKETS.map((): Array<T> => []);
  const ordered = entries.toSorted((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  for (const entry of ordered) {
    const at = entry.at === null ? Number.NaN : Date.parse(entry.at);
    const hours = Number.isFinite(at) ? (now - at) / HOUR : Number.POSITIVE_INFINITY;
    buckets[PULSE_BUCKETS.findIndex((bucket) => hours <= bucket.maxHours)]!.push(entry);
  }
  return buckets;
}

export const PULSE_WINDOW_HOURS = 48;
export const PULSE_TICK_HOURS = [48, 24, 12, 6, 0] as const;

/** The original 48-hour pulse: entries active in the window, with x running from 48h ago (0) to now (1). */
export function recentPulse<T extends { readonly at: string | null }>(
  entries: ReadonlyArray<T>,
  now: number,
): Array<{ readonly entry: T; readonly x: number; readonly hoursAgo: number }> {
  return entries
    .flatMap((entry) => {
      const at = entry.at === null ? Number.NaN : Date.parse(entry.at);
      const hoursAgo = (now - at) / HOUR;
      if (!Number.isFinite(hoursAgo) || hoursAgo > PULSE_WINDOW_HOURS) return [];
      const clamped = Math.max(0, hoursAgo);
      return [{ entry, x: 1 - clamped / PULSE_WINDOW_HOURS, hoursAgo: clamped }];
    })
    .toSorted((a, b) => a.hoursAgo - b.hoursAgo);
}

export interface BoardTension {
  readonly anima: string;
  readonly slug: string;
  readonly text: string;
  readonly age: number;
}

/** Reads a `# tension:` slug as a sentence, dropping age markers that leak in from commas in the text. */
export function tensionText(slug: string): string {
  return slug
    .replace(/\(\d+\)$/, "")
    .replace(/:\d+$/, "")
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s*:\s*/g, ": ")
    .trim();
}

/** Every anima's open tensions, oldest first, with slugs read as sentences. */
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
    .toSorted((a, b) => b.age - a.age || a.anima.localeCompare(b.anima));
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

/** `# user: trait=.95±.15,...`, the anima's model of the person it works with. */
export function parseUserModel(
  raw: string,
): Array<{ name: string; mean: number; sigma: number | null }> {
  return raw.split(",").flatMap((entry) => {
    const match = /^\s*([^=]+)=([\d.]+)(?:±([\d.]+))?/.exec(entry);
    if (!match) return [];
    return [
      {
        name: match[1]!.trim().replaceAll("-", " "),
        mean: Number(match[2]),
        sigma: match[3] ? Number(match[3]) : null,
      },
    ];
  });
}

const DOMAINS = [
  "systems",
  "data",
  "testing",
  "backend",
  "frontend",
  "architecture",
  "generative",
  "debugging",
] as const;

/** The CLI's colour code: hue is the work domain, saturation focus, lightness vitality. */
export function soulMeaning(hsl: string | null) {
  const parts = hsl?.split(",").map(Number);
  if (!parts || parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [h, s, l] = parts as [number, number, number];
  return {
    hue: h,
    domain: DOMAINS[Math.round((((h % 360) + 360) % 360) / 45) % 8]!,
    focus: s,
    focusLabel: s > 60 ? "focused" : s > 30 ? "moderate" : "diffuse",
    vitality: l,
    vitalityLabel: l > 60 ? "vital" : l > 40 ? "stable" : "fading",
  };
}

/** The original dashboard's match score: exact 100, prefix 80, substring by position, else word hits. */
export function matchScore(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle || !haystack) return 0;
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 80;
  const at = haystack.indexOf(needle);
  if (at >= 0) return 60 - Math.min(at, 30);
  const words = needle.split(/\s+/).filter((word) => word.length > 1);
  return words.filter((word) => haystack.includes(word)).length * 40 * (words.length > 1 ? 1 : 0);
}

export interface AnimaSearchHit {
  readonly anima: string;
  readonly kind: "anima" | "aim" | "vow" | "memo" | "tension" | "skill" | "project";
  readonly text: string;
  readonly score: number;
}

const KIND_BONUS: Record<AnimaSearchHit["kind"], number> = {
  anima: 20,
  tension: 5,
  aim: 0,
  vow: 0,
  memo: 0,
  skill: 0,
  project: -5,
};

/** Searches what the roster already knows about every anima, best matches first. */
export function searchAnimas(
  animas: ReadonlyArray<
    Pick<AnimaSummary, "name" | "aim" | "vow" | "memo" | "tensions" | "topSkills" | "homeProject">
  >,
  query: string,
  limit = 12,
): Array<AnimaSearchHit> {
  if (query.trim().length < 2) return [];
  const hits: Array<AnimaSearchHit> = [];
  const consider = (
    anima: string,
    kind: AnimaSearchHit["kind"],
    text: string | null | undefined,
  ) => {
    if (!text) return;
    const score = matchScore(text, query);
    if (score > 0) hits.push({ anima, kind, text, score: score + KIND_BONUS[kind] });
  };
  for (const anima of animas) {
    consider(anima.name, "anima", anima.name);
    consider(anima.name, "aim", anima.aim);
    consider(anima.name, "vow", anima.vow);
    consider(anima.name, "memo", anima.memo);
    consider(anima.name, "project", anima.homeProject);
    for (const tension of anima.tensions ?? [])
      consider(anima.name, "tension", tensionText(tension.slug));
    for (const skill of anima.topSkills) consider(anima.name, "skill", skill.name);
  }
  return hits.toSorted((a, b) => b.score - a.score).slice(0, limit);
}
