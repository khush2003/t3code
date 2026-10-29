import { EnvironmentId } from "@t3tools/contracts";
import type {
  AnimaAuditFinding,
  AnimaBreath,
  AnimaDetail,
  AnimaInboxAction,
  AnimaInboxMessage,
  AnimaLibraryEntry,
  AnimaOpen,
  AnimaPolicyRule,
  AnimaSummary,
  AnimaTrait,
} from "@t3tools/contracts";

export const ANIMA_TABS = [
  "overview",
  "health",
  "identity",
  "breaths",
  "inbox",
  "opens",
  "policy",
  "activity",
  "threads",
  "sync",
] as const;
export type AnimaTab = (typeof ANIMA_TABS)[number];

export const ANIMA_TAB_LABELS: Readonly<Record<AnimaTab, string>> = {
  overview: "Overview",
  health: "Health",
  identity: "Identity",
  breaths: "Breaths",
  inbox: "Inbox",
  opens: "Opens",
  policy: "Policy",
  activity: "Activity",
  threads: "Threads",
  sync: "Sync",
};

export function isAnimaTab(value: unknown): value is AnimaTab {
  return typeof value === "string" && (ANIMA_TABS as ReadonlyArray<string>).includes(value);
}

/** The world is the landing view, so it never appears in the URL. */
export type AnimaHomeView = "world" | "roster" | "library";

export function validateAnimaSearch(raw: Record<string, unknown>): {
  readonly environmentId?: EnvironmentId;
  readonly anima?: string;
  readonly tab?: AnimaTab;
  readonly view?: "roster" | "library";
  readonly entry?: string;
} {
  return {
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.anima === "string" && raw.anima.trim() ? { anima: raw.anima.trim() } : {}),
    ...(isAnimaTab(raw.tab) && raw.tab !== "overview" ? { tab: raw.tab } : {}),
    ...(raw.view === "library" || raw.view === "roster" ? { view: raw.view } : {}),
    ...(raw.view === "library" && typeof raw.entry === "string" && isLibrarySlugValid(raw.entry)
      ? { entry: raw.entry }
      : {}),
  };
}

export function isLibrarySlugValid(slug: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(slug);
}

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|(hsla?|rgba?)\([0-9a-z\s.,%/-]+\))$/i;

/** Accent values come from files on the server's disk, so only plain color syntaxes reach a style attribute. */
export function safeAnimaAccent(accent: string | null): string | null {
  const value = accent?.trim() ?? "";
  return SAFE_COLOR.test(value) ? value : null;
}

export type AnimaHealthBucket = "unknown" | "steady" | "watch" | "tend";

export const ANIMA_HEALTH_LABELS: Readonly<Record<AnimaHealthBucket, string>> = {
  unknown: "No reading",
  steady: "Steady",
  watch: "Watch",
  tend: "Needs tending",
};

/** The CLI score rises with need: it tends internally above 0.35 and proactively above 0.6. */
export function animaHealthBucket(score: number | null | undefined): AnimaHealthBucket {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unknown";
  if (score > 0.6) return "tend";
  if (score > 0.35) return "watch";
  return "steady";
}

/** Inverted so a fuller ring reads as healthier. */
export function animaWellness(score: number | null | undefined): number | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return Math.round((1 - Math.min(1, Math.max(0, score))) * 100);
}

export function animaNeedsAttention(anima: Pick<AnimaSummary, "health">): boolean {
  const bucket = animaHealthBucket(anima.health);
  return bucket === "watch" || bucket === "tend";
}

export type AnimaSortMode = "activity" | "health" | "name";

export const ANIMA_SORT_LABELS: Readonly<Record<AnimaSortMode, string>> = {
  activity: "Recent activity",
  health: "Most in need",
  name: "Name",
};

export function sortAnimas(
  animas: ReadonlyArray<AnimaSummary>,
  mode: AnimaSortMode = "activity",
): ReadonlyArray<AnimaSummary> {
  const byActivity = (left: AnimaSummary, right: AnimaSummary) => {
    if (left.live !== right.live) return left.live ? -1 : 1;
    const l = left.lastActiveAt ?? "";
    const r = right.lastActiveAt ?? "";
    if (l !== r) return l < r ? 1 : -1;
    return left.name.localeCompare(right.name);
  };
  if (mode === "name") return animas.toSorted((l, r) => l.name.localeCompare(r.name));
  if (mode === "activity") return animas.toSorted(byActivity);
  return animas.toSorted((left, right) => {
    const l = left.health ?? -1;
    const r = right.health ?? -1;
    return l === r ? byActivity(left, right) : r - l;
  });
}

export function filterAnimas(
  animas: ReadonlyArray<AnimaSummary>,
  query: string,
  attentionOnly = false,
): ReadonlyArray<AnimaSummary> {
  const needle = query.trim().toLowerCase();
  if (needle === "" && !attentionOnly) return animas;
  return animas.filter(
    (anima) =>
      (!attentionOnly || animaNeedsAttention(anima)) &&
      (needle === "" ||
        [anima.name, anima.role, anima.aim ?? "", anima.voice ?? "", ...anima.projects].some(
          (field) => field.toLowerCase().includes(needle),
        )),
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

export type AnimaMessageType = Extract<AnimaInboxAction, { type: "send" }>["messageType"];

export const ANIMA_MESSAGE_TYPES: ReadonlyArray<AnimaMessageType> = [
  "directive",
  "query",
  "feedback",
  "blocker",
  "consult",
  "info",
];

const SETTLED_MESSAGE_STATUSES = new Set(["done", "read", "closed", "resolved", "answered"]);

export function isInboxMessageSettled(message: Pick<AnimaInboxMessage, "status">): boolean {
  return SETTLED_MESSAGE_STATUSES.has(message.status?.trim().toLowerCase() ?? "");
}

/** Mirrors the contract's reply id pattern; legacy pipe-format ids cannot be answered. */
export function isReplyableMessageId(id: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,79}$/.test(id);
}

export interface AnimaInboxThread {
  readonly key: string;
  /** Oldest first. */
  readonly messages: ReadonlyArray<AnimaInboxMessage>;
  readonly latestTs: string;
  readonly unsettled: number;
  /** The root answers a message that is not in this inbox. */
  readonly answers: string | null;
}

/**
 * Groups by `replyTo` chains inside this inbox, oldest first so a parent is placed before its
 * replies. A root whose parent lives in another inbox joins the earliest root sharing its
 * `contextId`. Threads come back newest activity first.
 */
export function threadInbox(
  messages: ReadonlyArray<AnimaInboxMessage>,
): ReadonlyArray<AnimaInboxThread> {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const ordered = messages.toSorted((l, r) => (l.ts < r.ts ? -1 : l.ts > r.ts ? 1 : 0));
  const threadOf = new Map<string, string>();
  const contextRoots = new Map<string, string>();
  const groups = new Map<string, AnimaInboxMessage[]>();
  for (const message of ordered) {
    const parentKey = message.replyTo ? threadOf.get(message.replyTo) : undefined;
    let key = parentKey ?? message.id;
    if (parentKey === undefined && message.contextId) {
      const existing = contextRoots.get(message.contextId);
      if (existing === undefined) contextRoots.set(message.contextId, message.id);
      else key = existing;
    }
    threadOf.set(message.id, key);
    const group = groups.get(key);
    if (group) group.push(message);
    else groups.set(key, [message]);
  }
  return [...groups.entries()]
    .map(([key, group]): AnimaInboxThread => {
      const first = group[0]!;
      return {
        key,
        messages: group,
        latestTs: group.at(-1)!.ts,
        unsettled: group.filter((message) => !isInboxMessageSettled(message)).length,
        answers: first.replyTo && !byId.has(first.replyTo) ? first.replyTo : null,
      };
    })
    .toSorted((l, r) => (l.latestTs < r.latestTs ? 1 : l.latestTs > r.latestTs ? -1 : 0));
}

export type AnimaPolicySort = "order" | "fires";

export interface AnimaPolicyFireRow {
  readonly rule: AnimaPolicyRule;
  /** Fires relative to the most-fired rule, 0..1. */
  readonly share: number;
  readonly neverFired: boolean;
}

export function policyFireRows(
  rules: ReadonlyArray<AnimaPolicyRule>,
  sort: AnimaPolicySort,
): ReadonlyArray<AnimaPolicyFireRow> {
  const max = rules.reduce((top, rule) => Math.max(top, rule.fires), 0);
  const rows = rules.map((rule) => ({
    rule,
    share: max === 0 ? 0 : rule.fires / max,
    neverFired: rule.fires === 0,
  }));
  return sort === "order"
    ? rows
    : rows.toSorted((l, r) => r.rule.fires - l.rule.fires || l.rule.index - r.rule.index);
}

const AUDIT_LEVELS = ["error", "warn", "info"] as const;

export function groupAuditFindings(findings: ReadonlyArray<AnimaAuditFinding>) {
  return AUDIT_LEVELS.map((level) => ({
    level,
    findings: findings.filter((finding) => finding.level === level),
  })).filter((group) => group.findings.length > 0);
}

export const ANIMA_OPEN_STATUSES = ["active", "watching", "blocked"] as const;
type AnimaOpenStatus = (typeof ANIMA_OPEN_STATUSES)[number];

export function isAnimaOpenStatus(value: unknown): value is AnimaOpenStatus {
  return (
    typeof value === "string" && (ANIMA_OPEN_STATUSES as ReadonlyArray<string>).includes(value)
  );
}

const OPEN_STATUS_ORDER: Readonly<Record<string, number>> = { blocked: 0, active: 1, watching: 2 };

/** Blocked first; closed ones are split out so the board shows live questions. */
export function groupOpens(opens: ReadonlyArray<AnimaOpen>): {
  readonly live: ReadonlyArray<AnimaOpen>;
  readonly closed: ReadonlyArray<AnimaOpen>;
} {
  const isClosed = (open: AnimaOpen) => open.status.toLowerCase() === "closed";
  return {
    live: opens
      .filter((open) => !isClosed(open))
      .toSorted(
        (l, r) =>
          (OPEN_STATUS_ORDER[l.status.toLowerCase()] ?? 3) -
            (OPEN_STATUS_ORDER[r.status.toLowerCase()] ?? 3) || l.id.localeCompare(r.id),
      ),
    closed: opens.filter(isClosed),
  };
}

export function filterLibrary(
  entries: ReadonlyArray<AnimaLibraryEntry>,
  query: string,
): ReadonlyArray<AnimaLibraryEntry> {
  const needle = query.trim().toLowerCase();
  return entries
    .filter(
      (entry) =>
        needle === "" ||
        entry.slug.toLowerCase().includes(needle) ||
        (entry.title?.toLowerCase().includes(needle) ?? false),
    )
    .toSorted((l, r) => {
      const lm = l.modifiedAt ?? "";
      const rm = r.modifiedAt ?? "";
      return lm === rm ? l.slug.localeCompare(r.slug) : lm < rm ? 1 : -1;
    });
}
