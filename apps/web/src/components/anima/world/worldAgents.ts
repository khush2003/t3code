import type { AnimaSummary } from "@t3tools/contracts";

import { FORM_ORDER, type CreatureLook, type CreatureMode } from "./clay";
import type { WorldAgent } from "./LanternYard";

const HEX = /^#[0-9a-f]{6}$/i;
const RECENT_MS = 90 * 60_000;
const ASLEEP_MS = 14 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

function hashOf(value: string) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

/** A chosen form wins; otherwise the name picks one so an anima always looks the same. */
export function formIndex(anima: Pick<AnimaSummary, "name" | "form">): number {
  const chosen = anima.form ? FORM_ORDER.indexOf(anima.form) : -1;
  return chosen >= 0 ? chosen : hashOf(anima.name) % FORM_ORDER.length;
}

/** Hex for WebGL; three.js cannot parse the OKLCH the rest of the UI uses. */
export function worldAccent(anima: Pick<AnimaSummary, "accent" | "hsl">): string {
  if (anima.accent && HEX.test(anima.accent)) return anima.accent;
  const parts = anima.hsl?.split(",").map(Number) ?? [];
  if (parts.length >= 3 && parts.every(Number.isFinite)) {
    return `hsl(${Math.round(parts[0]!)}, ${Math.min(100, Math.max(25, parts[1]!))}%, ${Math.min(70, Math.max(35, parts[2]!))}%)`;
  }
  return "#bfae82";
}

export function creatureMode(
  anima: Pick<AnimaSummary, "live" | "enabled" | "lastActiveAt" | "lastBreathAt">,
  now: number,
): CreatureMode {
  if (anima.live) return "running";
  const last = Date.parse(anima.lastActiveAt ?? anima.lastBreathAt ?? "");
  if (!anima.enabled || !Number.isFinite(last) || now - last > ASLEEP_MS) return "asleep";
  return now - last < RECENT_MS ? "recent" : "idle";
}

export function creatureLook(
  anima: Pick<AnimaSummary, "accent" | "hsl" | "role" | "born">,
  now: number,
): CreatureLook {
  const born = Date.parse(anima.born);
  const days = Number.isFinite(born) ? Math.floor((now - born) / DAY_MS) : null;
  return {
    accent: worldAccent(anima),
    role: anima.role === "architect" || anima.role === "lead" ? anima.role : "agent",
    stage: days === null ? "unknown" : days < 30 ? "new" : days < 180 ? "settled" : "weathered",
  };
}

const MODE_STATUS: Readonly<Record<CreatureMode, string>> = {
  running: "Live",
  recent: "Just now",
  idle: "Resting",
  asleep: "Asleep",
};

export const MODE_DESCRIPTIONS: Readonly<Record<CreatureMode, string>> = {
  running: "At its desk in a live session",
  recent: "Active within the last 90 minutes",
  idle: "Strolling between towns",
  asleep: "Asleep: inactive for two weeks or paused",
};

/** Crews live with their lead; others in their home project's town, the commons, or the hollow when asleep. */
export function toWorldAgents(animas: ReadonlyArray<AnimaSummary>, now: number): Array<WorldAgent> {
  const leadOf = new Map<string, string>();
  for (const anima of animas) {
    for (const member of anima.team ?? []) {
      if (member !== anima.name && !leadOf.has(member)) leadOf.set(member, anima.name);
    }
  }
  return animas.map((anima) => {
    const mode = creatureMode(anima, now);
    const lead = (anima.team?.length ?? 0) > 0 ? anima.name : leadOf.get(anima.name);
    const home = anima.homeProject?.trim() || anima.projects[0]?.trim();
    const [districtId, districtName] = lead
      ? [`crew:${lead}`, `${lead}${lead.endsWith("s") ? "'" : "'s"} crew`]
      : home
        ? [`project:${home}`, home]
        : mode === "asleep"
          ? ["hollow", "Quiet Hollow"]
          : ["commons", "Commons"];
    return {
      id: anima.name,
      formIndex: formIndex(anima),
      look: creatureLook(anima, now),
      mode,
      districtId,
      districtName,
      label: anima.name,
      status: MODE_STATUS[mode],
    };
  });
}
