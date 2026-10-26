import type { AtlasTone } from "./atlasTaskListLogic";

// Full class names per tone so Tailwind can see them. Colours come from the
// scoped Atlas tokens in index.css.
export const TONE_DOT: Record<AtlasTone, string> = {
  attention: "bg-atlas-attention",
  waiting: "bg-atlas-waiting",
  running: "bg-atlas-running",
  ready: "bg-atlas-ready",
  done: "bg-atlas-done",
  blocked: "bg-atlas-blocked",
};

export const TONE_SOFT: Record<AtlasTone, string> = {
  attention: "bg-atlas-attention/12",
  waiting: "bg-atlas-waiting/18",
  running: "bg-atlas-running/12",
  ready: "bg-atlas-ready/12",
  done: "bg-atlas-done/14",
  blocked: "bg-atlas-blocked/14",
};

export const TONE_RING: Record<AtlasTone, string> = {
  attention: "ring-atlas-attention/32",
  waiting: "ring-atlas-waiting/45",
  running: "ring-atlas-running/32",
  ready: "ring-atlas-ready/32",
  done: "ring-atlas-done/32",
  blocked: "ring-atlas-blocked/32",
};
