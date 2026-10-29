import type { AnimaName, EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";

const STORAGE_KEY = "t3code:anima-stay-synced:v1";

const StaySyncLink = Schema.Struct({
  name: Schema.String,
  first: Schema.String,
  second: Schema.String,
  /** Set when a conflict needs a person; writes stop until a check finds none. */
  paused: Schema.NullOr(Schema.Struct({ conflicts: Schema.Array(Schema.String) })),
});
export type StaySyncLink = typeof StaySyncLink.Type;
const decodeLinks = Schema.decodeUnknownSync(Schema.Array(StaySyncLink));

export type StaySyncStatus =
  | { readonly state: "syncing" }
  | { readonly state: "synced"; readonly at: number }
  | { readonly state: "waiting" }
  | { readonly state: "error"; readonly message: string };

export function staySyncKey(name: string, a: EnvironmentId, b: EnvironmentId): string {
  return [name, ...[a, b].toSorted()].join("|");
}

// Accessing localStorage itself can throw SecurityError before get/set.
function resolveStorage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {}
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => void memory.set(key, value),
  };
}
const storage = resolveStorage();

function readLinks(): Record<string, StaySyncLink> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const links = raw ? decodeLinks(JSON.parse(raw)) : [];
    return Object.fromEntries(
      links.map((link) => [
        staySyncKey(link.name, link.first as EnvironmentId, link.second as EnvironmentId),
        link,
      ]),
    );
  } catch {
    return {};
  }
}

interface StaySyncState {
  readonly links: Record<string, StaySyncLink>;
  readonly statuses: Record<string, StaySyncStatus>;
  readonly setEnabled: (
    name: AnimaName,
    first: EnvironmentId,
    second: EnvironmentId,
    enabled: boolean,
  ) => void;
  readonly setPaused: (key: string, conflicts: ReadonlyArray<string> | null) => void;
  readonly setStatus: (key: string, status: StaySyncStatus) => void;
}

function persist(links: Record<string, StaySyncLink>) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(Object.values(links)));
  } catch (error) {
    console.error("[ANIMA] Could not save the stay-synced animas.", error);
  }
}

export const useAnimaStaySyncStore = create<StaySyncState>((set, get) => ({
  links: readLinks(),
  statuses: {},
  setEnabled: (name, first, second, enabled) => {
    const key = staySyncKey(name, first, second);
    const links = { ...get().links };
    if (enabled) links[key] = { name, first, second, paused: null };
    else delete links[key];
    persist(links);
    set({ links });
  },
  setPaused: (key, conflicts) => {
    const link = get().links[key];
    if (!link) return;
    const links = { ...get().links, [key]: { ...link, paused: conflicts ? { conflicts } : null } };
    persist(links);
    set({ links });
  },
  setStatus: (key, status) => set({ statuses: { ...get().statuses, [key]: status } }),
}));
