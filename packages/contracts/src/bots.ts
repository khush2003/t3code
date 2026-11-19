import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Lowercase so `bot:<name>` thread ids and mentions read the same everywhere. */
export const BotName = TrimmedNonEmptyString.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/));
export type BotName = typeof BotName.Type;

const BotPurpose = Schema.String.check(Schema.isMaxLength(500));
/** What the bot is for and how its person wants work done; it reads this every turn. */
export const BotCharter = Schema.String.check(Schema.isMaxLength(8_000));

export const BotWorkItemId = TrimmedNonEmptyString.pipe(Schema.brand("BotWorkItemId"));
export type BotWorkItemId = typeof BotWorkItemId.Type;

/** What the bot intends: open until it decides the work is done or no longer wanted. */
export const BotWorkItemState = Schema.Literals(["open", "done", "dropped"]);
export type BotWorkItemState = typeof BotWorkItemState.Type;

/** Read from the thread itself, never from what the bot believes about it. */
export const BotThreadStatus = Schema.Literals([
  "working",
  "needs-input",
  "completed",
  "failed",
  "stopped",
  "idle",
  "unknown",
]);
export type BotThreadStatus = typeof BotThreadStatus.Type;

export const BotStartInput = Schema.Struct({
  name: BotName,
  purpose: Schema.optional(BotPurpose),
  /** It reads every other bot's board and is the one to talk to about all of them. */
  oversees: Schema.optional(Schema.Boolean),
});
export type BotStartInput = typeof BotStartInput.Type;

export const BotStartResult = Schema.Struct({ threadId: ThreadId, created: Schema.Boolean });
export type BotStartResult = typeof BotStartResult.Type;

/** A thread opened beside a bot's main chat to keep one piece of work apart. */
export const BotThread = Schema.Struct({
  threadId: ThreadId,
  title: Schema.String,
  /** The message of the bot's main chat it was opened from. */
  anchorMessageId: Schema.NullOr(Schema.String),
  /** Messages in the thread, and when the last one came. */
  replies: Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  lastReplyAt: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type BotThread = typeof BotThread.Type;

export const BotSummary = Schema.Struct({
  name: BotName,
  purpose: Schema.String,
  /** The bot's main chat. */
  threadId: Schema.NullOr(ThreadId),
  openItems: Schema.Number,
  oversees: Schema.Boolean,
  /** Its threads that are neither settled nor deleted, oldest first. */
  threads: Schema.Array(BotThread).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type BotSummary = typeof BotSummary.Type;

export const BotThreadStartInput = Schema.Struct({
  /** Any conversation of the bot. */
  threadId: ThreadId,
  title: Schema.optional(Schema.String.check(Schema.isMaxLength(120))),
  anchorMessageId: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
});
export type BotThreadStartInput = typeof BotThreadStartInput.Type;
export const BotThreadStartResult = Schema.Struct({ threadId: ThreadId });
export type BotThreadStartResult = typeof BotThreadStartResult.Type;

export const BotListResult = Schema.Struct({ bots: Schema.Array(BotSummary) });
export type BotListResult = typeof BotListResult.Type;

export const BotBoardThread = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  title: Schema.String,
  /** The project, or the linked machine, the thread runs in. */
  where: Schema.String,
  status: BotThreadStatus,
  /** When `status` was last read; older than now for a machine that is not reachable. */
  asOf: Schema.String,
  /** The thread's last reply when it finished, trimmed. */
  result: Schema.NullOr(Schema.String),
  /** When the task began, and when it ended if it has. */
  startedAt: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  endedAt: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type BotBoardThread = typeof BotBoardThread.Type;

/** Something a task handed over: a file kept as an attachment, or a link. */
export const BotBoardFile = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  name: Schema.NullOr(Schema.String),
  mimeType: Schema.NullOr(Schema.String),
  sizeBytes: Schema.Number,
  /** The kept copy; null for a link, a file too large to copy, or one whose copy was evicted. */
  attachmentId: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
  sourcePath: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  /** The task that handed it over. */
  threadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type BotBoardFile = typeof BotBoardFile.Type;

export const BotBoardItem = Schema.Struct({
  id: BotWorkItemId,
  title: Schema.String,
  detail: Schema.String,
  nextStep: Schema.String,
  state: BotWorkItemState,
  /** The bot says it cannot go on until its person does something. */
  waitingOnYou: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  updatedAt: Schema.String,
  threads: Schema.Array(BotBoardThread),
  files: Schema.Array(BotBoardFile),
});
export type BotBoardItem = typeof BotBoardItem.Type;

export const BotBoardInput = Schema.Struct({
  /** The bot's own thread. */
  threadId: ThreadId,
  includeClosed: Schema.optional(Schema.Boolean),
});
export type BotBoardInput = typeof BotBoardInput.Type;

export const BotBoard = Schema.Struct({
  name: BotName,
  purpose: Schema.String,
  items: Schema.Array(BotBoardItem),
  /** Running tasks the bot started that sit on no item. */
  unfiled: Schema.Array(BotBoardThread),
});
export type BotBoard = typeof BotBoard.Type;

/** Something a bot keeps for later, with the message and passage it rests on. */
export const BotNote = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  createdAt: Schema.String,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: Schema.String,
  quote: Schema.String,
  /** The title of the thread it comes from; absent for the bot's own conversation. */
  source: Schema.NullOr(Schema.String),
  outdatedAt: Schema.NullOr(Schema.String),
  outdatedReason: Schema.NullOr(Schema.String),
  replacedBy: Schema.NullOr(Schema.String),
});
export type BotNote = typeof BotNote.Type;

/** One background pass over what a bot had not read yet. */
export const BotReflectionPass = Schema.Struct({
  at: Schema.String,
  messages: Schema.Number,
  added: Schema.Number,
  retired: Schema.Number,
  /** Notes the pass proposed that had no passage in the message they named. */
  rejected: Schema.Number,
  error: Schema.NullOr(Schema.String),
});
export type BotReflectionPass = typeof BotReflectionPass.Type;

export const BotMemoryInput = Schema.Struct({ threadId: ThreadId });
export type BotMemoryInput = typeof BotMemoryInput.Type;

export const BotMemory = Schema.Struct({
  name: BotName,
  charter: Schema.String,
  /** Charters it had before, newest first. */
  charterHistory: Schema.Array(
    Schema.Struct({ replacedAt: Schema.String, charter: Schema.String }),
  ),
  /** Current notes first, then retired ones, each newest first. */
  notes: Schema.Array(BotNote),
  passes: Schema.Array(BotReflectionPass),
  /** Copied messages no pass has read yet. */
  unread: Schema.Number,
});
export type BotMemory = typeof BotMemory.Type;

export const BotNoteRetireInput = Schema.Struct({
  threadId: ThreadId,
  id: Schema.String,
  reason: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(500)),
});
export type BotNoteRetireInput = typeof BotNoteRetireInput.Type;

export const BotCharterSetInput = Schema.Struct({ threadId: ThreadId, charter: BotCharter });
export type BotCharterSetInput = typeof BotCharterSetInput.Type;

export class BotError extends Schema.TaggedError<BotError>()("BotError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Bot ${this.operation} failed.`;
  }
}

export class BotRejectedError extends Schema.TaggedError<BotRejectedError>()("BotRejectedError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}
