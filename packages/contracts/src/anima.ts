import * as Schema from "effect/Schema";
import { NonNegativeInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Directory-safe anima name; also the CLI `--agent` argument, so no separators or leading dashes. */
export const AnimaName = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
);
export type AnimaName = typeof AnimaName.Type;

export const AnimaRole = Schema.String;

export const AnimaTrait = Schema.Struct({
  name: Schema.String,
  /** Kalman estimate in 0..1. */
  mean: Schema.Number,
  sigma: Schema.NullOr(Schema.Number),
});
export type AnimaTrait = typeof AnimaTrait.Type;

/** Breadth / depth / coupling in 0..1, the "body" coordinates of a breath. */
export const AnimaShape = Schema.Struct({
  breadth: Schema.Number,
  depth: Schema.Number,
  coupling: Schema.Number,
});
export type AnimaShape = typeof AnimaShape.Type;

export const AnimaSummary = Schema.Struct({
  name: AnimaName,
  id: Schema.String,
  role: AnimaRole,
  born: Schema.String,
  parent: Schema.NullOr(Schema.String),
  accent: Schema.NullOr(Schema.String),
  breathCount: NonNegativeInt,
  /** `# active: false` excludes the anima from automation; unset means active. */
  enabled: Schema.Boolean,
  /** A session heartbeat newer than the staleness window. */
  live: Schema.Boolean,
  lastActiveAt: Schema.NullOr(Schema.String),
  lastBreathAt: Schema.NullOr(Schema.String),
  aim: Schema.NullOr(Schema.String),
  memo: Schema.NullOr(Schema.String),
  vow: Schema.NullOr(Schema.String),
  /** `H,S,L` of the latest breath; the anima's current colour. */
  hsl: Schema.NullOr(Schema.String),
  /** Body coordinates of the latest breath. */
  shape: Schema.NullOr(AnimaShape),
  /** First paragraph of the identity voice section. */
  voice: Schema.NullOr(Schema.String),
  projects: Schema.Array(Schema.String),
  topSkills: Schema.Array(AnimaTrait),
  inboxCount: NonNegativeInt,
  policyCount: NonNegativeInt,
  /** Stable digest of state + breaths + policy + identity; equal digests mean identical animas. */
  digest: Schema.String,
});
export type AnimaSummary = typeof AnimaSummary.Type;

export const AnimaBreath = Schema.Struct({
  index: NonNegativeInt,
  ts: Schema.String,
  /** Free-text note, or an encoded musical note for early breaths. */
  note: Schema.String,
  hsl: Schema.NullOr(Schema.String),
  shape: Schema.NullOr(AnimaShape),
  /** Change in shape since the previous breath. */
  drift: Schema.NullOr(AnimaShape),
  graph: Schema.NullOr(Schema.String),
  aim: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.String),
  decisions: Schema.Array(Schema.String),
  open: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  hash: Schema.NullOr(Schema.String),
  parent: Schema.NullOr(Schema.String),
});
export type AnimaBreath = typeof AnimaBreath.Type;

export const AnimaPolicyRule = Schema.Struct({
  index: NonNegativeInt,
  text: Schema.String,
});
export type AnimaPolicyRule = typeof AnimaPolicyRule.Type;

export const AnimaPolicy = Schema.Struct({
  revision: NonNegativeInt,
  operational: Schema.Array(AnimaPolicyRule),
  pending: Schema.Array(AnimaPolicyRule),
  audit: Schema.Array(Schema.String),
  /** Operational rule cap enforced by the CLI. */
  cap: NonNegativeInt,
});
export type AnimaPolicy = typeof AnimaPolicy.Type;

export const AnimaInboxMessage = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  from: Schema.String,
  ts: Schema.String,
  body: Schema.String,
});
export type AnimaInboxMessage = typeof AnimaInboxMessage.Type;

export const AnimaOpen = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  question: Schema.String,
  status: Schema.String,
  assignee: Schema.NullOr(Schema.String),
});
export type AnimaOpen = typeof AnimaOpen.Type;

export const AnimaDetail = Schema.Struct({
  summary: AnimaSummary,
  identity: Schema.String,
  /** Raw `# key: value` header lines that have no dedicated field (kin, tension, biases, ...). */
  header: Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.String })),
  traits: Schema.Array(AnimaTrait),
  skills: Schema.Array(AnimaTrait),
  policy: AnimaPolicy,
  breaths: Schema.Array(AnimaBreath),
  inbox: Schema.Array(AnimaInboxMessage),
  opens: Schema.Array(AnimaOpen),
  /** Threads on this environment that run with this anima. */
  threadIds: Schema.Array(ThreadId),
});
export type AnimaDetail = typeof AnimaDetail.Type;

export const AnimaListInput = Schema.Struct({});
export const AnimaListResult = Schema.Struct({
  animas: Schema.Array(AnimaSummary),
  /** False when the anima CLI is not installed on this environment. */
  cliAvailable: Schema.Boolean,
  rootPath: Schema.String,
});
export type AnimaListResult = typeof AnimaListResult.Type;

export const AnimaGetInput = Schema.Struct({
  name: AnimaName,
  /** 0 means every breath; defaults to the most recent 100. */
  breathLimit: Schema.optional(NonNegativeInt),
});
export type AnimaGetInput = typeof AnimaGetInput.Type;

export const AnimaCreateInput = Schema.Struct({
  name: AnimaName,
  /** Child of an existing anima (inherits identity), or scanned from a project directory. */
  parent: Schema.optional(AnimaName),
  fromProjectPath: Schema.optional(TrimmedNonEmptyString),
  role: Schema.optional(Schema.Literals(["agent", "lead", "architect"])),
});
export type AnimaCreateInput = typeof AnimaCreateInput.Type;

export const AnimaAttachInput = Schema.Struct({
  name: AnimaName,
  projectId: ProjectId,
});
export type AnimaAttachInput = typeof AnimaAttachInput.Type;

export const AnimaSetEnabledInput = Schema.Struct({
  name: AnimaName,
  enabled: Schema.Boolean,
});

export const AnimaPolicyAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("add"),
    rule: TrimmedNonEmptyString,
    direct: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("update"),
    index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    rule: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("remove"),
    index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  Schema.Struct({ type: Schema.Literal("apply") }),
]);
export type AnimaPolicyAction = typeof AnimaPolicyAction.Type;

export const AnimaPolicyInput = Schema.Struct({
  name: AnimaName,
  action: AnimaPolicyAction,
});
export type AnimaPolicyInput = typeof AnimaPolicyInput.Type;

/** Sends a breathe request into a running thread; the agent performs the breath. */
export const AnimaBreatheInput = Schema.Struct({
  threadId: ThreadId,
});
export type AnimaBreatheInput = typeof AnimaBreatheInput.Type;

export const AnimaBreatheResult = Schema.Struct({
  name: AnimaName,
  threadId: ThreadId,
  /** Breath count before the request; the breath is done once the summary's count exceeds it. */
  breathCountBefore: NonNegativeInt,
  /** True when the thread was mid-turn, so the request waits behind the current work. */
  queued: Schema.Boolean,
});

export const AnimaWakePreviewInput = Schema.Struct({ name: AnimaName });
export const AnimaWakePreviewResult = Schema.Struct({ payload: Schema.String });

export const AnimaMutationResult = Schema.Struct({
  /** CLI output, trimmed; shown as the toast detail. */
  output: Schema.String,
  summary: Schema.NullOr(AnimaSummary),
});
export type AnimaMutationResult = typeof AnimaMutationResult.Type;

export const ANIMA_BUNDLE_VERSION = 1;

/** One file inside a bundle; paths are relative to the anima directory and always UTF-8 text. */
export const AnimaBundleFile = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
});
export type AnimaBundleFile = typeof AnimaBundleFile.Type;

export const AnimaBundle = Schema.Struct({
  version: Schema.Literal(ANIMA_BUNDLE_VERSION),
  name: AnimaName,
  id: Schema.String,
  digest: Schema.String,
  exportedAt: Schema.String,
  /** Hash chain `index:hash` of the breaths, used to decide ancestry. */
  breathChain: Schema.Array(Schema.String),
  files: Schema.Array(AnimaBundleFile),
});
export type AnimaBundle = typeof AnimaBundle.Type;

export const AnimaExportInput = Schema.Struct({ name: AnimaName });

export const AnimaSyncRelation = Schema.Literals([
  /** Destination has no anima with this name. */
  "missing",
  "identical",
  /** Incoming bundle extends the local breath chain. */
  "incoming-ahead",
  /** Local chain extends the incoming bundle. */
  "local-ahead",
  /** Both sides have breaths the other lacks. */
  "diverged",
  /** Same name, different anima id. */
  "unrelated",
]);
export type AnimaSyncRelation = typeof AnimaSyncRelation.Type;

export const AnimaCompareInput = Schema.Struct({ bundle: AnimaBundle });
export const AnimaCompareResult = Schema.Struct({
  relation: AnimaSyncRelation,
  local: Schema.NullOr(AnimaSummary),
  /** Index of the last breath both sides share, or -1. */
  commonBreath: Schema.Int,
  localOnlyBreaths: NonNegativeInt,
  incomingOnlyBreaths: NonNegativeInt,
  changedFiles: Schema.Array(Schema.String),
});
export type AnimaCompareResult = typeof AnimaCompareResult.Type;

export const AnimaImportInput = Schema.Struct({
  bundle: AnimaBundle,
  /** `create` fails if present; `replace` overwrites after taking a backup; `fast-forward` only when incoming is ahead. */
  mode: Schema.Literals(["create", "replace", "fast-forward"]),
});
export type AnimaImportInput = typeof AnimaImportInput.Type;

export const AnimaMergeStartInput = Schema.Struct({
  bundle: AnimaBundle,
  projectId: ProjectId,
});
export type AnimaMergeStartInput = typeof AnimaMergeStartInput.Type;

export const AnimaMergeStartResult = Schema.Struct({
  mergeId: Schema.String,
  threadId: ThreadId,
  stagingPath: Schema.String,
});
export type AnimaMergeStartResult = typeof AnimaMergeStartResult.Type;

export const AnimaMergeApplyInput = Schema.Struct({ mergeId: Schema.String });
export const AnimaMergeStatusInput = Schema.Struct({ mergeId: Schema.String });
export const AnimaMergeStatusResult = Schema.Struct({
  mergeId: Schema.String,
  name: AnimaName,
  threadId: Schema.NullOr(ThreadId),
  /** `ready` once the merge agent wrote a complete `merged/` tree. */
  state: Schema.Literals(["running", "ready", "applied", "failed"]),
  note: Schema.NullOr(Schema.String),
});
export type AnimaMergeStatusResult = typeof AnimaMergeStatusResult.Type;

export class AnimaError extends Schema.TaggedError<AnimaError>()("AnimaError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Anima ${this.operation} failed.`;
  }
}

/** The anima CLI refused the request (policy cap reached, duplicate name, ...); `reason` is its first stderr line. */
export class AnimaCommandRejectedError extends Schema.TaggedError<AnimaCommandRejectedError>()(
  "AnimaCommandRejectedError",
  {
    operation: Schema.String,
    reason: Schema.String.check(Schema.isMaxLength(300)),
  },
) {
  override get message(): string {
    return this.reason;
  }
}

export class AnimaNotFoundError extends Schema.TaggedError<AnimaNotFoundError>()(
  "AnimaNotFoundError",
  { name: Schema.String },
) {
  override get message(): string {
    return `Anima '${this.name}' does not exist.`;
  }
}
