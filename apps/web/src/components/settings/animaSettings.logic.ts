import { EnvironmentId } from "@t3tools/contracts";
import type {
  AnimaBreath,
  AnimaDetail,
  AnimaInboxMessage,
  AnimaOpen,
  AnimaSummary,
  AnimaTrait,
} from "@t3tools/contracts";

export const ANIMA_TABS = [
  "overview",
  "identity",
  "breaths",
  "policy",
  "activity",
  "threads",
  "sync",
] as const;
export type AnimaTab = (typeof ANIMA_TABS)[number];

export const ANIMA_TAB_LABELS: Readonly<Record<AnimaTab, string>> = {
  overview: "Overview",
  identity: "Identity",
  breaths: "Breaths",
  policy: "Policy",
  activity: "Activity",
  threads: "Threads",
  sync: "Sync",
};

export function isAnimaTab(value: unknown): value is AnimaTab {
  return typeof value === "string" && (ANIMA_TABS as ReadonlyArray<string>).includes(value);
}

export function validateAnimaSearch(raw: Record<string, unknown>) {
  return {
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.anima === "string" && raw.anima.trim() ? { anima: raw.anima.trim() } : {}),
    ...(isAnimaTab(raw.tab) && raw.tab !== "overview" ? { tab: raw.tab } : {}),
  };
}

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([0-9a-z\s.,%/-]+\))$/i;

/** Accent values come from files on the server's disk, so only plain color syntaxes reach a style attribute. */
export function safeAnimaAccent(accent: string | null): string | null {
  const value = accent?.trim() ?? "";
  return SAFE_COLOR.test(value) ? value : null;
}

export function sortAnimas(animas: ReadonlyArray<AnimaSummary>): ReadonlyArray<AnimaSummary> {
  return animas.toSorted((left, right) => {
    if (left.live !== right.live) return left.live ? -1 : 1;
    const l = left.lastActiveAt ?? "";
    const r = right.lastActiveAt ?? "";
    if (l !== r) return l < r ? 1 : -1;
    return left.name.localeCompare(right.name);
  });
}

export function filterAnimas(
  animas: ReadonlyArray<AnimaSummary>,
  query: string,
): ReadonlyArray<AnimaSummary> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return animas;
  return animas.filter((anima) =>
    [anima.name, anima.role, anima.aim ?? "", anima.voice ?? "", ...anima.projects].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

export function traitPercent(trait: Pick<AnimaTrait, "mean">): number {
  return Math.round(Math.min(1, Math.max(0, trait.mean)) * 100);
}

export type AnimaFeedItem =
  | {
      readonly kind: "breath";
      readonly ts: string;
      readonly key: string;
      readonly breath: AnimaBreath;
    }
  | {
      readonly kind: "message";
      readonly ts: string;
      readonly key: string;
      readonly message: AnimaInboxMessage;
    };

/** Newest first. Opens carry no timestamp, so they are returned separately and shown pinned. */
export function buildAnimaFeed(
  detail: Pick<AnimaDetail, "breaths" | "inbox" | "opens">,
  limit = 60,
): { readonly pinned: ReadonlyArray<AnimaOpen>; readonly items: ReadonlyArray<AnimaFeedItem> } {
  const items: AnimaFeedItem[] = [
    ...detail.breaths.map((breath): AnimaFeedItem => ({
      kind: "breath",
      ts: breath.ts,
      key: `breath:${breath.index}`,
      breath,
    })),
    ...detail.inbox.map((message): AnimaFeedItem => ({
      kind: "message",
      ts: message.ts,
      key: `message:${message.id}`,
      message,
    })),
  ];
  items.sort((left, right) => (left.ts < right.ts ? 1 : left.ts > right.ts ? -1 : 0));
  return {
    pinned: detail.opens.filter((open) => open.status.toLowerCase() !== "closed"),
    items: items.slice(0, limit),
  };
}

/** Early breaths store an encoded musical note instead of prose; those are not worth rendering as text. */
export function breathNoteText(note: string): string | null {
  const trimmed = note.trim();
  if (trimmed === "") return null;
  return /\s/.test(trimmed) || trimmed.length > 12 ? trimmed : null;
}

export function isAnimaNameValid(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}

export function mergeStatusLabel(state: "running" | "ready" | "applied" | "failed"): string {
  switch (state) {
    case "running":
      return "The merge agent is working";
    case "ready":
      return "Merged result is ready to apply";
    case "applied":
      return "Merged result applied";
    case "failed":
      return "The merge failed";
  }
}

/** Stable React keys for lines that may repeat verbatim. */
export function keyedLines(
  lines: ReadonlyArray<string>,
): ReadonlyArray<{ key: string; line: string }> {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const count = (seen.get(line) ?? 0) + 1;
    seen.set(line, count);
    return { key: `${count}:${line}`, line };
  });
}
