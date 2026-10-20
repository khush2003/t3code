import type { AtlasArtifact, AtlasTask, AtlasTaskExecution } from "@t3tools/contracts";
import {
  WORKSPACE_BROWSER_PREVIEW_EXTENSIONS,
  WORKSPACE_IMAGE_PREVIEW_EXTENSIONS,
} from "@t3tools/shared/filePreview";
import { isAbsolutePath, workspaceRelativeFilePath } from "@t3tools/shared/path";

import { canDecideOnTask, canExecuteTask, taskIsRunning } from "./atlasLogic";

// ── Status pill ─────────────────────────────────────────────────────────────

export type AtlasPillTone = "neutral" | "info" | "warning" | "success" | "error";

export interface AtlasTaskPill {
  readonly label: string;
  readonly tone: AtlasPillTone;
}

/** The task's state in the words a reviewer uses, not the stored status. */
export function taskStatusPill(task: AtlasTask): AtlasTaskPill {
  if (task.agentReview?.status === "running") return { label: "Agent reviewing", tone: "info" };
  if (taskIsRunning(task)) return { label: "Agent working", tone: "info" };
  switch (task.status) {
    case "failed":
      return { label: "Run failed", tone: "error" };
    case "needs_review":
      return { label: "Needs your review", tone: "warning" };
    case "changes_requested":
      return { label: "Changes requested", tone: "warning" };
    case "approved":
      return { label: "Approved", tone: "success" };
    case "running":
    case "proposed":
      break;
  }
  if (task.blockedBy.length > 0) return { label: "Blocked", tone: "neutral" };
  return canExecuteTask(task)
    ? { label: "Ready to run", tone: "neutral" }
    : { label: "Not started", tone: "neutral" };
}

export type AtlasTaskPrimaryAction = "review" | "approve" | "run" | "rerun";

/**
 * The single action a card offers. Reviewing opens the task's deliverables;
 * a reviewer's approval shortcuts straight to the approve dialog.
 */
export function taskPrimaryAction(task: AtlasTask): AtlasTaskPrimaryAction | null {
  if (task.status === "needs_review" && canDecideOnTask(task)) {
    return task.agentReview?.outcome === "approved" ? "approve" : "review";
  }
  if (canExecuteTask(task)) return task.execution ? "rerun" : "run";
  return null;
}

// ── Artifacts ───────────────────────────────────────────────────────────────

export type AtlasArtifactViewer = "markdown" | "image" | "html" | "text" | "link" | "unavailable";

const extensionOf = (path: string): string => {
  const name = path.split(/[?#]/, 1)[0]!.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(WORKSPACE_IMAGE_PREVIEW_EXTENSIONS);
const BROWSER_EXTENSIONS: ReadonlySet<string> = new Set(WORKSPACE_BROWSER_PREVIEW_EXTENSIONS);
const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".mdx", ".markdown"]);

export function isHttpUrl(value: string | undefined): value is string {
  if (value === undefined) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * How an artifact can be shown. The file extension wins over the reported
 * kind because it decides what the viewer can actually render; an agent that
 * labels a screenshot "document" still gets an image view.
 */
export function artifactViewer(artifact: AtlasArtifact): AtlasArtifactViewer {
  const path = artifact.path?.trim();
  if (artifact.kind === "link" || !path) {
    return isHttpUrl(artifact.url) ? "link" : "unavailable";
  }
  const extension = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (BROWSER_EXTENSIONS.has(extension)) return "html";
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  return "text";
}

export type AtlasArtifactGroup = "doc" | "image" | "page" | "link" | "file";

export function artifactGroup(artifact: AtlasArtifact): AtlasArtifactGroup {
  switch (artifactViewer(artifact)) {
    case "image":
      return "image";
    case "html":
      return "page";
    case "link":
      return "link";
    case "markdown":
      return "doc";
    case "text":
    case "unavailable":
      return artifact.kind === "document" ? "doc" : "file";
  }
}

const GROUP_ORDER: ReadonlyArray<AtlasArtifactGroup> = ["doc", "image", "page", "link", "file"];
const GROUP_NOUN: Record<AtlasArtifactGroup, readonly [string, string]> = {
  doc: ["doc", "docs"],
  image: ["image", "images"],
  page: ["page", "pages"],
  link: ["link", "links"],
  file: ["file", "files"],
};

export interface AtlasArtifactGroupCount {
  readonly group: AtlasArtifactGroup;
  readonly count: number;
  readonly label: string;
}

/** Counts per group in a fixed order, e.g. "2 docs" then "1 image". */
export function summarizeArtifacts(
  artifacts: ReadonlyArray<AtlasArtifact>,
): ReadonlyArray<AtlasArtifactGroupCount> {
  const counts = new Map<AtlasArtifactGroup, number>();
  for (const artifact of artifacts) {
    const group = artifactGroup(artifact);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return GROUP_ORDER.flatMap((group) => {
    const count = counts.get(group) ?? 0;
    if (count === 0) return [];
    const [one, many] = GROUP_NOUN[group];
    return [{ group, count, label: `${count} ${count === 1 ? one : many}` }];
  });
}

export type AtlasDeliverableEntry =
  | { readonly key: "summary"; readonly kind: "summary"; readonly title: string }
  | { readonly key: "changes"; readonly kind: "changes"; readonly title: string }
  | {
      readonly key: string;
      readonly kind: "artifact";
      readonly title: string;
      readonly artifact: AtlasArtifact;
      readonly viewer: AtlasArtifactViewer;
    };

/**
 * Everything a reviewer can open for a run: the agent's summary, each
 * reported artifact, and the thread's code changes. Summary and code changes
 * are always present so a run that reported nothing is still reviewable.
 */
export function deliverableEntries(
  execution: AtlasTaskExecution | null,
): ReadonlyArray<AtlasDeliverableEntry> {
  if (execution === null) return [];
  return [
    { key: "summary", kind: "summary", title: "Agent summary" },
    ...execution.artifacts.map((artifact, index) => ({
      key: `artifact:${index}:${artifact.path ?? artifact.url ?? artifact.title}`,
      kind: "artifact" as const,
      title: artifact.title,
      artifact,
      viewer: artifactViewer(artifact),
    })),
    { key: "changes", kind: "changes", title: "Code changes" },
  ];
}

/** The entry a reviewer lands on: the first reported artifact, else the summary. */
export function defaultDeliverableKey(
  entries: ReadonlyArray<AtlasDeliverableEntry>,
): string | null {
  return (entries.find((entry) => entry.kind === "artifact") ?? entries[0])?.key ?? null;
}

/** Highest checkpoint turn, which bounds the whole-thread diff. */
export function latestCheckpointTurnCount(
  summaries: ReadonlyArray<{ readonly checkpointTurnCount: number }>,
): number | null {
  let latest: number | null = null;
  for (const summary of summaries) {
    if (latest === null || summary.checkpointTurnCount > latest) {
      latest = summary.checkpointTurnCount;
    }
  }
  return latest;
}

/**
 * Artifact paths are meant to be workspace-relative, but agents sometimes
 * report absolute ones. A path outside the workspace is passed through so the
 * file read reports it rather than this silently dropping it.
 */
export function artifactRelativePath(path: string, cwd: string): string {
  const trimmed = path.trim();
  if (isAbsolutePath(trimmed)) return workspaceRelativeFilePath(trimmed, cwd) ?? trimmed;
  return trimmed.replace(/^(?:\.\/)+/, "");
}
