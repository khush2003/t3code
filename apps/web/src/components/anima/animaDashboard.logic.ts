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

/** `# kin: name=label.strength,...`; strength is missing for kin like `ion=sibling:?`. */
export function parseKin(
  raw: string,
): Array<{ name: string; label: string; strength: number | null }> {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.includes("="))
    .map((entry) => {
      const [name, rest = ""] = entry.split("=") as [string, string?];
      const match = /^(.*?)[.:](\d+|\?)$/.exec(rest);
      const strength = match && match[2] !== "?" ? Number(match[2]) : null;
      return {
        name: name.trim(),
        label: (match ? match[1]! : rest).replaceAll("-", " ").trim(),
        strength,
      };
    });
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
