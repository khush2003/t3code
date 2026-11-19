import type { BotBoardFile, BotBoardItem, BotBoardThread } from "@t3tools/contracts";

/** Where a work item sits on the board. Read from its state and its tasks, never dragged. */
export type BotItemColumn = "needs-you" | "running" | "quiet" | "done";

export const BOT_ITEM_COLUMNS: ReadonlyArray<{
  readonly id: BotItemColumn;
  readonly label: string;
}> = [
  { id: "needs-you", label: "Needs you" },
  { id: "running", label: "Running" },
  { id: "quiet", label: "Quiet" },
  { id: "done", label: "Done" },
];

export function botItemColumn(item: BotBoardItem): BotItemColumn {
  if (item.state !== "open") return "done";
  if (item.waitingOnYou || item.threads.some((thread) => thread.status === "needs-input"))
    return "needs-you";
  return item.threads.some((thread) => thread.status === "working") ? "running" : "quiet";
}

/** Each column's items, the most recently changed first. */
export function groupBotItems(
  items: ReadonlyArray<BotBoardItem>,
): Record<BotItemColumn, ReadonlyArray<BotBoardItem>> {
  const groups: Record<BotItemColumn, Array<BotBoardItem>> = {
    "needs-you": [],
    running: [],
    quiet: [],
    done: [],
  };
  for (const item of items.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
    groups[botItemColumn(item)].push(item);
  return groups;
}

const TASK_ORDER: Record<BotBoardThread["status"], number> = {
  "needs-input": 0,
  working: 1,
  failed: 2,
  completed: 3,
  stopped: 3,
  idle: 3,
  unknown: 3,
};

/** What needs the person first, then what is running, then the rest by when it last moved. */
export function sortBotTasks(
  threads: ReadonlyArray<BotBoardThread>,
): ReadonlyArray<BotBoardThread> {
  const moved = (thread: BotBoardThread) => thread.endedAt ?? thread.startedAt ?? "";
  return threads.toSorted(
    (a, b) => TASK_ORDER[a.status] - TASK_ORDER[b.status] || moved(b).localeCompare(moved(a)),
  );
}

export function countBotTasks(threads: ReadonlyArray<BotBoardThread>) {
  return {
    total: threads.length,
    running: threads.filter((thread) => thread.status === "working").length,
    needsYou: threads.filter((thread) => thread.status === "needs-input").length,
  };
}

/** How long a finished task ran, when both ends are known. */
export function botTaskRunMs(thread: BotBoardThread): number | null {
  if (thread.startedAt === null || thread.endedAt === null) return null;
  const ms = Date.parse(thread.endedAt) - Date.parse(thread.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

const isBotImage = (file: BotBoardFile) =>
  file.attachmentId !== null && file.mimeType?.startsWith("image/") === true;

/** A bot's files split into pictures to show and the rest to list, newest first. */
export function splitBotFiles(files: ReadonlyArray<BotBoardFile>) {
  const newest = files.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    images: newest.filter(isBotImage),
    others: newest.filter((file) => !isBotImage(file)),
  };
}

/** "HTML", "MD", "Link": what a file is, short enough for a row. */
export function botFileKind(file: BotBoardFile): string {
  if (file.url !== null) return "Link";
  const extension = file.name?.includes(".") ? file.name.split(".").at(-1) : undefined;
  return (extension ?? file.mimeType?.split("/").at(-1) ?? "File").toUpperCase();
}
