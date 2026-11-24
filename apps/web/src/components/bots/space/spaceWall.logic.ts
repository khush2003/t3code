import type {
  BotBoardFile,
  BotBoardItem,
  BotBoardThread,
  OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import { filePreviewKind } from "@t3tools/shared/filePreview";

/** One thing a screen can hold up about a task: something it handed over, its work, its result. */
export type WallPiece =
  /** Two pictures of the same thing, before a change and after it, to look at together. */
  | {
      readonly kind: "pair";
      readonly id: string;
      readonly title: string;
      readonly before: BotBoardFile;
      readonly after: BotBoardFile;
    }
  | { readonly kind: "file"; readonly id: string; readonly file: BotBoardFile }
  | { readonly kind: "activity"; readonly id: "activity" }
  | { readonly kind: "result"; readonly id: "result"; readonly text: string };

export const isBotPicture = (file: BotBoardFile) =>
  file.attachmentId !== null &&
  filePreviewKind({ name: file.name ?? file.title, mimeType: file.mimeType ?? "" }) === "image";

const SIDE = /\b(before|after)\b/i;
/** What a title is about, without which side of the change it shows or the note in brackets. */
const subject = (title: string) =>
  title
    .replace(/\([^)]*\)?/g, "")
    .replace(SIDE, "")
    .replace(/[\s,;:·-]+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Pictures titled as the before and the after of one thing, put together; every other file
 * stays by itself. The order of `files` is kept, a pair standing where its first half was.
 */
export function pairPictures(files: ReadonlyArray<BotBoardFile>): ReadonlyArray<WallPiece> {
  const sides = new Map<string, { before?: BotBoardFile; after?: BotBoardFile }>();
  for (const file of files) {
    const side = isBotPicture(file) ? SIDE.exec(file.title)?.[1]?.toLowerCase() : undefined;
    if (side !== "before" && side !== "after") continue;
    const key = subject(file.title);
    const pair = sides.get(key) ?? {};
    // A second picture of the same side is not a pair's half; the first one keeps the place.
    pair[side] ??= file;
    sides.set(key, pair);
  }
  const pieces: WallPiece[] = [];
  const paired = new Set<string>();
  for (const file of files) {
    if (paired.has(file.id)) continue;
    const pair = isBotPicture(file) ? sides.get(subject(file.title)) : undefined;
    if (
      pair?.before !== undefined &&
      pair.after !== undefined &&
      (pair.before === file || pair.after === file)
    ) {
      paired.add(pair.before.id).add(pair.after.id);
      const title = file.title
        .replace(/\([^)]*\)?/g, "")
        .replace(SIDE, "")
        .replace(/[\s,;:·-]+$/g, "")
        .replace(/,\s*,/g, ",")
        .replace(/\s+/g, " ")
        .trim();
      pieces.push({
        kind: "pair",
        id: `pair:${pair.before.id}`,
        title,
        before: pair.before,
        after: pair.after,
      });
    } else pieces.push({ kind: "file", id: file.id, file });
  }
  return pieces;
}

/**
 * Everything to look at about a task, the most telling first: pictures, then the other files
 * it handed over, then its result once it ended, then its work as it goes.
 */
export function taskPieces(
  thread: Pick<BotBoardThread, "status" | "result"> | null,
  files: ReadonlyArray<BotBoardFile>,
  watchable: boolean,
): ReadonlyArray<WallPiece> {
  const newest = files.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const handed = pairPictures([
    ...newest.filter(isBotPicture),
    ...newest.filter((file) => !isBotPicture(file)),
  ]);
  const result = thread?.status === "working" ? null : (thread?.result?.trim() ?? "");
  return [
    ...handed,
    ...(result ? [{ kind: "result" as const, id: "result" as const, text: result }] : []),
    ...(watchable ? [{ kind: "activity" as const, id: "activity" as const }] : []),
  ];
}

/** What a screen opens on: a task still at work shows its work unless it has pictures to show. */
export function firstPiece(
  pieces: ReadonlyArray<WallPiece>,
  working: boolean,
): WallPiece | undefined {
  const picture = pieces.find(
    (piece) => piece.kind === "pair" || (piece.kind === "file" && isBotPicture(piece.file)),
  );
  return (
    picture ??
    (working ? pieces.find((piece) => piece.kind === "activity") : undefined) ??
    pieces[0]
  );
}

/** What a task was asked to do: the message that started it. */
export function taskBrief(items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>): string {
  for (const { item } of items) if (item.type === "user_message") return item.text.trim();
  return "";
}

/** A task's own plan, when it keeps one: its latest list of steps and how each stands. */
export function taskPlan(items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>) {
  for (const { item } of items.toReversed()) if (item.type === "todo_list") return item.steps;
  return [];
}

const isLive = (thread: BotBoardThread) =>
  thread.status === "working" || thread.status === "needs-input";

/** One open item as an overview holds it: what moves now, and the newest things to look at. */
interface BoardRow {
  readonly item: BotBoardItem;
  /** Tasks at work or waiting, one per title: a task started again is the same work. */
  readonly live: ReadonlyArray<BotBoardThread>;
  /** How many of its tasks have ended. */
  readonly ended: number;
  /** Its pictures, newest first. */
  readonly pictures: ReadonlyArray<BotBoardFile>;
  /** How many other files it holds. */
  readonly others: number;
}

/**
 * A bot's open work at a glance: what waits on the person first, then what is being worked on,
 * then the rest. Ended tasks are counted, not listed.
 */
export function boardRows(items: ReadonlyArray<BotBoardItem>): ReadonlyArray<BoardRow> {
  const rows = items
    .filter((item) => item.state === "open")
    .map((item): BoardRow => {
      const live = new Map<string, BotBoardThread>();
      for (const thread of item.threads) {
        if (!isLive(thread)) continue;
        const kept = live.get(thread.title);
        // The one waiting on the person stands for the others of its name.
        if (kept === undefined || (thread.status === "needs-input" && kept.status === "working"))
          live.set(thread.title, thread);
      }
      const pictures = item.files
        .filter(isBotPicture)
        .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        item,
        live: [...live.values()],
        ended: item.threads.filter((thread) => !isLive(thread)).length,
        pictures,
        others: item.files.length - pictures.length,
      };
    });
  const rank = (row: BoardRow) =>
    row.item.waitingOnYou || row.live.some((thread) => thread.status === "needs-input")
      ? 0
      : row.live.length > 0
        ? 1
        : 2;
  return rows.toSorted((a, b) => rank(a) - rank(b));
}

/** A picture a bot's task handed over, with whose it is and the work it belongs to. */
export interface RecentPicture {
  readonly bot: string;
  readonly item: string;
  readonly file: BotBoardFile;
}

/**
 * The newest pictures across the bots, one per task so that one busy task does not fill the
 * wall, newest first. An after is preferred to its before: it shows where things stand.
 */
export function recentPictures(
  boards: ReadonlyArray<{ readonly bot: string; readonly items: ReadonlyArray<BotBoardItem> }>,
  limit: number,
): ReadonlyArray<RecentPicture> {
  const newest = new Map<string, RecentPicture>();
  for (const board of boards)
    for (const item of board.items)
      for (const file of item.files) {
        if (!isBotPicture(file)) continue;
        const key = file.threadId ?? file.id;
        const kept = newest.get(key);
        const isBefore = (of: BotBoardFile) => SIDE.exec(of.title)?.[1]?.toLowerCase() === "before";
        if (
          kept === undefined ||
          (isBefore(kept.file) && !isBefore(file)) ||
          (isBefore(kept.file) === isBefore(file) && file.createdAt > kept.file.createdAt)
        )
          newest.set(key, { bot: board.bot, item: item.title, file });
      }
  return [...newest.values()]
    .toSorted((a, b) => b.file.createdAt.localeCompare(a.file.createdAt))
    .slice(0, limit);
}
