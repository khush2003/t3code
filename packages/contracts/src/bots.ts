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
});
export type BotStartInput = typeof BotStartInput.Type;

export const BotStartResult = Schema.Struct({ threadId: ThreadId, created: Schema.Boolean });
export type BotStartResult = typeof BotStartResult.Type;

export const BotSummary = Schema.Struct({
  name: BotName,
  purpose: Schema.String,
  threadId: Schema.NullOr(ThreadId),
  openItems: Schema.Number,
});
export type BotSummary = typeof BotSummary.Type;

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
});
export type BotBoardThread = typeof BotBoardThread.Type;

export const BotBoardItem = Schema.Struct({
  id: BotWorkItemId,
  title: Schema.String,
  detail: Schema.String,
  nextStep: Schema.String,
  state: BotWorkItemState,
  updatedAt: Schema.String,
  threads: Schema.Array(BotBoardThread),
});
export type BotBoardItem = typeof BotBoardItem.Type;

export const BotBoardInput = Schema.Struct({
  name: BotName,
  includeClosed: Schema.optional(Schema.Boolean),
});
export type BotBoardInput = typeof BotBoardInput.Type;

export const BotBoard = Schema.Struct({
  name: BotName,
  purpose: Schema.String,
  items: Schema.Array(BotBoardItem),
});
export type BotBoard = typeof BotBoard.Type;

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
