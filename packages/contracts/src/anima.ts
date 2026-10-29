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
  /** Consecutive negative updates (`~n`); absent when zero. */
  negStreak: Schema.optional(NonNegativeInt),
});
export type AnimaTrait = typeof AnimaTrait.Type;

/** Breadth / depth / coupling in 0..1, the "body" coordinates of a breath. */
export const AnimaShape = Schema.Struct({
  breadth: Schema.Number,
  depth: Schema.Number,
  coupling: Schema.Number,
});
export type AnimaShape = typeof AnimaShape.Type;

/** Creature forms an anima can choose through `anima clinic check-in`. */
export const ANIMA_FORMS = ["fox", "owl", "axolotl", "frog", "moth", "raccoon"] as const;
export const AnimaForm = Schema.Literals(ANIMA_FORMS);
export type AnimaForm = typeof AnimaForm.Type;

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
  /** Members, when this anima leads a team. */
  team: Schema.optional(Schema.Array(Schema.String)),
  /** Unresolved tensions from the `# tension:` header; age counts breaths since it opened. */
  tensions: Schema.optional(
    Schema.Array(Schema.Struct({ slug: Schema.String, age: Schema.Number })),
  ),
  /** Bonds from the `# kin:` header; strength is null while the bond is unformed. */
  kin: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        label: Schema.String,
        strength: Schema.NullOr(Schema.Number),
      }),
    ),
  ),
  /** Directory name of the `# project:` home, if the anima has one. */
  homeProject: Schema.optional(Schema.NullOr(Schema.String)),
  topSkills: Schema.Array(AnimaTrait),
  inboxCount: NonNegativeInt,
  policyCount: NonNegativeInt,
  /** CLI health score in 0..1, higher means more in need of tending; null before the first row. */
  health: Schema.NullOr(Schema.Number),
  /** Stable digest of state + breaths + policy + identity; equal digests mean identical animas. */
  digest: Schema.String,
  /** Self-chosen creature form from `appearance.json`; null until the anima checks in. */
  form: Schema.optional(Schema.NullOr(AnimaForm)),
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
  friction: Schema.NullOr(Schema.String),
  /** Raw `--self` scores of this breath, before the Kalman merge; sigma is always null. */
  self: Schema.Array(AnimaTrait),
  /** "the user's words|principle" entries. */
  corrections: Schema.Array(Schema.String),
  seeking: Schema.NullOr(Schema.String),
  resume: Schema.NullOr(Schema.String),
  open: Schema.Array(Schema.String),
  closedOpens: Schema.Array(Schema.String),
  files: Schema.Array(Schema.String),
  hash: Schema.NullOr(Schema.String),
  parent: Schema.NullOr(Schema.String),
});
export type AnimaBreath = typeof AnimaBreath.Type;

export const AnimaPolicyRule = Schema.Struct({
  index: NonNegativeInt,
  text: Schema.String,
  /** Runtime hook fires recorded in policy-fires.jsonl; always 0 for pending rules. */
  fires: NonNegativeInt,
  lastFiredAt: Schema.NullOr(Schema.String),
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
  to: Schema.optional(Schema.NullOr(Schema.String)),
  /** Message id this one answers. */
  replyTo: Schema.optional(Schema.NullOr(Schema.String)),
  contextId: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
});
export type AnimaInboxMessage = typeof AnimaInboxMessage.Type;

export const AnimaOpen = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  question: Schema.String,
  status: Schema.String,
  assignee: Schema.NullOr(Schema.String),
  /** What closes the question. */
  resolves: Schema.optional(Schema.NullOr(Schema.String)),
  context: Schema.optional(Schema.NullOr(Schema.String)),
  openedBy: Schema.optional(Schema.NullOr(Schema.String)),
  /** `YYYY-MM-DD`. */
  openedAt: Schema.optional(Schema.NullOr(Schema.String)),
  related: Schema.optional(Schema.Array(Schema.String)),
});
export type AnimaOpen = typeof AnimaOpen.Type;

/** The CLI-generated `card.json`, read as-is; it can lag the anima until the CLI regenerates it. */
export const AnimaCard = Schema.Struct({
  description: Schema.String,
  version: Schema.NullOr(Schema.String),
  generatedAt: Schema.NullOr(Schema.String),
  skills: Schema.Array(Schema.Struct({ name: Schema.String, confidence: Schema.Number })),
  interfaces: Schema.Array(Schema.String),
  status: Schema.NullOr(Schema.String),
});
export type AnimaCard = typeof AnimaCard.Type;

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
  /** Opens in the anima's `# project:` directory; empty when it has none. */
  opens: Schema.Array(AnimaOpen),
  projectPath: Schema.NullOr(Schema.String),
  card: Schema.NullOr(AnimaCard),
  /** Skills this anima offers to others for consults. */
  offers: Schema.Array(Schema.String),
  /** Members, when this anima leads a team. */
  team: Schema.Array(Schema.String),
  /** The lead whose team includes this anima. */
  lead: Schema.NullOr(Schema.String),
  /** Threads on this environment that run with this anima. */
  threadIds: Schema.Array(ThreadId),
});
export type AnimaDetail = typeof AnimaDetail.Type;

export const AnimaPolicyFire = Schema.Struct({
  /** Operational rule text that matched. */
  rule: Schema.String,
  /** What triggered it, e.g. `Bash: git push --force`. */
  trigger: Schema.String,
  ts: Schema.String,
});
export type AnimaPolicyFire = typeof AnimaPolicyFire.Type;

/** What T3's server-side anima runtime knows about one thread since its anima woke. */
export const AnimaThreadRuntimeStatus = Schema.Struct({
  threadId: ThreadId,
  name: AnimaName,
  /** Tool calls observed since the wake. */
  toolEvents: NonNegativeInt,
  /** Breath count recorded at the wake; null when the thread has not woken yet. */
  breathsAtWake: Schema.NullOr(NonNegativeInt),
  breathCount: NonNegativeInt,
  /** Enough work happened without a breath that the anima should breathe. */
  breathDue: Schema.Boolean,
  /** Same tool failing repeatedly; null when no loop is suspected. */
  loop: Schema.NullOr(Schema.Struct({ tool: Schema.String, failures: NonNegativeInt })),
  /** Policy rules fired in this thread, newest first. */
  fires: Schema.Array(AnimaPolicyFire),
  lastHeartbeatAt: Schema.NullOr(Schema.String),
});
export type AnimaThreadRuntimeStatus = typeof AnimaThreadRuntimeStatus.Type;

export const AnimaThreadStatusInput = Schema.Struct({ threadId: ThreadId });

export const AnimaListInput = Schema.Struct({});
export const AnimaListResult = Schema.Struct({
  animas: Schema.Array(AnimaSummary),
  /** False when the anima CLI is not installed on this environment. */
  cliAvailable: Schema.Boolean,
  rootPath: Schema.String,
  /** `anima version` of the CLI in use; null for the legacy skill script, which has no version command. */
  cliVersion: Schema.optional(Schema.NullOr(Schema.String)),
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

export const AnimaClinicInput = Schema.Struct({
  name: AnimaName,
  form: AnimaForm,
  /** `#rrggbb`; omitted keeps the anima's current accent. */
  accent: Schema.optional(Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/))),
});
export type AnimaClinicInput = typeof AnimaClinicInput.Type;

/** A breath recorded by hand through `anima breathe`, in the CLI's own codec. */
export const AnimaRecordInput = Schema.Struct({
  name: AnimaName,
  /** `hue.focus.vitality`, e.g. `225.60.55`. */
  hsl: Schema.String.check(Schema.isPattern(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/)),
  /** `pitch.mode.velocity.duration.tension.tempo`, e.g. `D4.M.60.1.2.100`. */
  note: Schema.String.check(Schema.isPattern(/^[A-G][#b]?\d?\.[Mmd7](\.\d+){2,4}$/)),
  /** `breadth/depth/coupling`, each 0..1. */
  shape: Schema.String.check(Schema.isPattern(/^[01](\.\d+)?\/[01](\.\d+)?\/[01](\.\d+)?$/)),
  aim: Schema.optional(TrimmedNonEmptyString),
  memo: Schema.optional(TrimmedNonEmptyString),
  /** Tensions to open or reinforce. */
  tensions: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  /** Tensions this breath resolves; the CLI closes a tension named among the decisions. */
  resolves: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type AnimaRecordInput = typeof AnimaRecordInput.Type;

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

export const AnimaMessageType = Schema.Literals([
  "directive",
  "feedback",
  "blocker",
  "query",
  "info",
  "consult",
]);

const AnimaMessageBody = TrimmedNonEmptyString.check(Schema.isMaxLength(16_000));

export const AnimaInboxSendAction = Schema.Struct({
  type: Schema.Literal("send"),
  messageType: AnimaMessageType,
  body: AnimaMessageBody,
  /** Recorded sender; defaults to `user`. */
  from: Schema.optional(AnimaName),
});

/** Answers a message in this anima's inbox; the reply goes to its sender, from this anima. */
const AnimaMessageId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,79}$/),
);

export const AnimaInboxReplyAction = Schema.Struct({
  type: Schema.Literal("reply"),
  messageId: AnimaMessageId,
  body: AnimaMessageBody,
});

/** Removes exactly these messages from the inbox once they are handled. */
export const AnimaInboxAckAction = Schema.Struct({
  type: Schema.Literal("ack"),
  messageIds: Schema.NonEmptyArray(AnimaMessageId),
});

export const AnimaInboxAction = Schema.Union([
  AnimaInboxSendAction,
  AnimaInboxReplyAction,
  AnimaInboxAckAction,
  /** Drops messages that arrived before the last breath or session start; later ones stay. */
  Schema.Struct({ type: Schema.Literal("clear") }),
]);
export type AnimaInboxAction = typeof AnimaInboxAction.Type;

/** `name` is the inbox's owner: the recipient of a send, the replier of a reply. */
export const AnimaInboxInput = Schema.Struct({
  name: AnimaName,
  action: AnimaInboxAction,
});
export type AnimaInboxInput = typeof AnimaInboxInput.Type;

const AnimaOpenId = TrimmedNonEmptyString.check(Schema.isPattern(/^open-\d{1,6}$/));
const AnimaOpenText = TrimmedNonEmptyString.check(Schema.isMaxLength(2_000));

export const AnimaOpensAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("add"),
    question: AnimaOpenText,
    resolves: AnimaOpenText,
    /** Defaults to the anima that opens it. */
    assignee: Schema.optional(AnimaName),
    context: Schema.optional(AnimaOpenText),
  }),
  Schema.Struct({ type: Schema.Literal("close"), id: AnimaOpenId }),
  Schema.Struct({ type: Schema.Literal("assign"), id: AnimaOpenId, assignee: AnimaName }),
  Schema.Struct({
    type: Schema.Literal("update"),
    id: AnimaOpenId,
    status: Schema.optional(Schema.Literals(["active", "watching", "blocked"])),
    context: Schema.optional(AnimaOpenText),
    resolves: Schema.optional(AnimaOpenText),
  }),
]);
export type AnimaOpensAction = typeof AnimaOpensAction.Type;

/** Acts on the opens of `name`'s `# project:` directory, as `name`. */
export const AnimaOpensInput = Schema.Struct({
  name: AnimaName,
  action: AnimaOpensAction,
});
export type AnimaOpensInput = typeof AnimaOpensInput.Type;

export const AnimaHealthInput = Schema.Struct({ name: AnimaName });

/** Mirrors the CLI's `assessHealth`; each component is 0..1 and the score is their weighted sum. */
export const AnimaHealthAssessment = Schema.Struct({
  score: Schema.Number,
  /** `internal` above 0.35, `proactive` above 0.6: how urgently the CLI would tend this anima. */
  action: Schema.Literals(["none", "internal", "proactive"]),
  components: Schema.Struct({
    uncertainty: Schema.Number,
    negStreak: Schema.Number,
    staleTension: Schema.Number,
    drift: Schema.Number,
    silence: Schema.Number,
  }),
  maxSigma: Schema.Number,
  maxNegStreak: NonNegativeInt,
  maxTensionAge: NonNegativeInt,
  silenceHours: Schema.Number,
  colorDrift: Schema.Number,
  reasons: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
});
export type AnimaHealthAssessment = typeof AnimaHealthAssessment.Type;

export const AnimaAuditFinding = Schema.Struct({
  level: Schema.Literals(["error", "warn", "info"]),
  message: Schema.String,
});
export type AnimaAuditFinding = typeof AnimaAuditFinding.Type;

export const AnimaHealthResult = Schema.Struct({
  name: AnimaName,
  /** Null before the anima has any rows. */
  health: Schema.NullOr(AnimaHealthAssessment),
  circuit: Schema.Literals(["closed", "open", "half-open"]),
  circuitCount: NonNegativeInt,
  /** Data-integrity findings from the CLI's `audit` checks. */
  audit: Schema.Array(AnimaAuditFinding),
});
export type AnimaHealthResult = typeof AnimaHealthResult.Type;

export const AnimaLibrarySlug = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/),
);

export const AnimaLibraryEntry = Schema.Struct({
  slug: Schema.String,
  /** First `# ` heading, if any. */
  title: Schema.NullOr(Schema.String),
  bytes: NonNegativeInt,
  modifiedAt: Schema.NullOr(Schema.String),
});
export type AnimaLibraryEntry = typeof AnimaLibraryEntry.Type;

export const AnimaLibraryListInput = Schema.Struct({});
export const AnimaLibraryListResult = Schema.Struct({ entries: Schema.Array(AnimaLibraryEntry) });
export type AnimaLibraryListResult = typeof AnimaLibraryListResult.Type;

export const AnimaLibraryReadInput = Schema.Struct({ slug: AnimaLibrarySlug });
export const AnimaLibraryReadResult = Schema.Struct({
  slug: Schema.String,
  content: Schema.String,
});
export type AnimaLibraryReadResult = typeof AnimaLibraryReadResult.Type;

/** Creates the entry, or appends a dated section when the slug exists. */
export const AnimaLibraryShelveInput = Schema.Struct({
  slug: AnimaLibrarySlug,
  author: AnimaName,
  content: TrimmedNonEmptyString.check(Schema.isMaxLength(64_000)),
  /** Shelves into this anima's own directory instead of the shared library. */
  forAnima: Schema.optional(AnimaName),
});
export type AnimaLibraryShelveInput = typeof AnimaLibraryShelveInput.Type;

export const AnimaTeamInput = Schema.Struct({
  lead: AnimaName,
  action: Schema.Literals(["add", "remove"]),
  member: AnimaName,
});
export type AnimaTeamInput = typeof AnimaTeamInput.Type;

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
