import {
  BotError,
  type BotName,
  BotWorkItemId,
  type BotWorkItemState,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";

export interface BotRecord {
  readonly name: BotName;
  /** The bot's main chat; replaced when that thread is deleted and the bot started again. */
  readonly threadId: ThreadId | null;
  readonly purpose: string;
  readonly charter: string;
  /** It reads every other bot's board and is the person's one point of contact. */
  readonly oversees: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One conversation a bot has with its person: its main chat, or a thread opened beside it to
 * keep one piece of work apart. Each has its own model session; all share the bot's memory.
 */
export interface BotConversation {
  readonly threadId: ThreadId;
  readonly bot: BotName;
  /** Empty for the main chat. */
  readonly title: string;
  /** The message a thread was opened from, with what it said then. */
  readonly anchor: { readonly messageId: string; readonly text: string } | null;
  /** What its model session was last sent in full, and the run that carried it. */
  readonly context: {
    readonly sent: string | null;
    readonly runId: string | null;
    /** The session lost its earlier messages since, so the next turn sends it all again. */
    readonly due: boolean;
  };
  readonly createdAt: string;
}

export interface BotItemRecord {
  readonly id: BotWorkItemId;
  readonly bot: BotName;
  readonly title: string;
  readonly detail: string;
  readonly nextStep: string;
  readonly state: BotWorkItemState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One message of a thread, as the bot keeps it. */
export interface BotMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly createdAt: string;
  readonly text: string;
}

export interface BotRecallHit extends BotThreadRef {
  readonly messageId: string;
  readonly role: string;
  readonly createdAt: string;
  /** The passage that matched, or the whole message when a thread is read. */
  readonly text: string;
  /** Absent for the bot's own conversation. */
  readonly title: string | null;
  readonly where: string | null;
}

/** Something worth knowing later, always resting on a copied message. */
export interface BotNote extends BotThreadRef {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
  readonly messageId: string;
  /** The passage of that message the note rests on. */
  readonly quote: string;
  /** The title of the thread it comes from; null for the bot's own conversation. */
  readonly source: string | null;
  readonly outdatedAt: string | null;
  readonly outdatedReason: string | null;
  readonly replacedBy: string | null;
}

/** Something one bot told another, as the message it became in the other's thread. */
export interface BotToldMessage {
  readonly id: number;
  readonly from: BotName;
  /** The conversation it was told from, where the answer goes; null for the main chat. */
  readonly fromThreadId: ThreadId | null;
  readonly to: BotName;
  readonly messageId: string;
}

/** Something a task handed to its bot: a file, kept as a copy when it fits, or a link. */
export interface BotFile extends BotThreadRef {
  readonly id: string;
  readonly bot: BotName;
  readonly itemId: BotWorkItemId | null;
  readonly title: string;
  /** The file's own name; null for a link. */
  readonly name: string | null;
  readonly mimeType: string | null;
  readonly bytes: number;
  /** The copy in T3's attachment store; null for a link, a file too large, or one evicted. */
  readonly attachmentId: string | null;
  readonly url: string | null;
  /** Where the file was when it was handed over. */
  readonly sourcePath: string | null;
  readonly createdAt: string;
}

export interface BotReflectionPass {
  readonly at: string;
  readonly messages: number;
  readonly added: number;
  readonly retired: number;
  readonly rejected: number;
  readonly error: string | null;
}

/** A copied message a reflection pass has not read yet. */
export interface BotUnreadMessage extends BotRecallHit {
  readonly row: number;
}

export interface BotReflectionState {
  /** Copied messages no pass has read. */
  readonly unread: number;
  readonly lastAt: string | null;
  readonly passesSince: number;
  /** A work item was closed after the last pass. */
  readonly itemClosed: boolean;
}

export interface BotThreadRef {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export interface BotItemThreadRecord extends BotThreadRef {
  readonly itemId: BotWorkItemId;
  readonly title: string;
  readonly where: string;
  readonly linkedAt: string;
}

/** What a finished run of a bot's thread did, kept here so it outlives the machine it ran on. */
export interface BotEpisodeRecord extends BotThreadRef {
  readonly bot: BotName;
  /** The bot's conversation that started the task; null when recorded before a bot had several. */
  readonly fromThreadId: ThreadId | null;
  readonly runKey: string;
  readonly title: string;
  readonly where: string;
  readonly outcome: string;
  readonly startedAt: string | null;
  readonly endedAt: string;
  readonly result: string;
}

export interface BotItemSave {
  readonly id?: BotWorkItemId | undefined;
  readonly title?: string | undefined;
  readonly detail?: string | undefined;
  readonly nextStep?: string | undefined;
  readonly state?: BotWorkItemState | undefined;
}

export class BotStore extends Context.Service<
  BotStore,
  {
    readonly getBot: (name: BotName) => Effect.Effect<BotRecord | null, BotError>;
    readonly listBots: Effect.Effect<ReadonlyArray<BotRecord>, BotError>;
    /** Creates the bot, or returns it unchanged when it exists. */
    readonly ensureBot: (input: {
      readonly name: BotName;
      readonly purpose: string;
      readonly charter: string;
      readonly oversees?: boolean | undefined;
    }) => Effect.Effect<BotRecord, BotError>;
    /** How often one bot has told another something since `since`. */
    readonly countBotMessages: (
      from: BotName,
      to: BotName,
      since: string,
    ) => Effect.Effect<number, BotError>;
    /** Records what one bot told another: the message it became in the other's thread. */
    readonly addBotMessage: (input: {
      readonly from: BotName;
      readonly fromThreadId: ThreadId;
      readonly to: BotName;
      readonly messageId: string;
    }) => Effect.Effect<void, BotError>;
    /** Of these messages, the ones another bot sent and has had no answer to. */
    readonly unansweredBotMessages: (
      messageIds: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<BotToldMessage>, BotError>;
    /** Everything one bot told another since `since` that has had no answer. */
    readonly unansweredBotMessagesSince: (
      since: string,
    ) => Effect.Effect<ReadonlyArray<BotToldMessage>, BotError>;
    readonly markBotMessageAnswered: (id: number) => Effect.Effect<void, BotError>;
    /** Names a bot's main chat. */
    readonly setThread: (name: BotName, threadId: ThreadId) => Effect.Effect<void, BotError>;
    /** The bot a conversation belongs to: its main chat or any thread opened beside it. */
    readonly botForThread: (threadId: ThreadId) => Effect.Effect<BotRecord | null, BotError>;
    readonly conversation: (threadId: ThreadId) => Effect.Effect<BotConversation | null, BotError>;
    /** A bot's conversations, its main chat first. */
    readonly conversations: (
      bot: BotName,
    ) => Effect.Effect<ReadonlyArray<BotConversation>, BotError>;
    readonly addConversation: (
      conversation: Pick<BotConversation, "threadId" | "bot" | "title" | "anchor">,
    ) => Effect.Effect<void, BotError>;
    /** The charter it replaces is kept. */
    readonly setCharter: (name: BotName, charter: string) => Effect.Effect<void, BotError>;
    /** Charters a bot had before, newest first. */
    readonly charterHistory: (
      name: BotName,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly replacedAt: string; readonly charter: string }>,
      BotError
    >;
    readonly setContextSent: (
      threadId: ThreadId,
      sent: string,
      runId: string,
    ) => Effect.Effect<void, BotError>;
    readonly markContextLost: (threadId: ThreadId) => Effect.Effect<void, BotError>;
    readonly listItems: (
      bot: BotName,
      options?: { readonly includeClosed?: boolean | undefined },
    ) => Effect.Effect<ReadonlyArray<BotItemRecord>, BotError>;
    readonly getItem: (id: BotWorkItemId) => Effect.Effect<BotItemRecord | null, BotError>;
    /** Creates the item when `id` is absent; otherwise changes only the fields given. */
    readonly saveItem: (bot: BotName, input: BotItemSave) => Effect.Effect<BotItemRecord, BotError>;
    /** A thread belongs to one item; linking it again moves it. */
    readonly linkThread: (
      itemId: BotWorkItemId,
      thread: BotThreadRef & { readonly title: string; readonly where: string },
    ) => Effect.Effect<void, BotError>;
    readonly itemThreads: (
      itemIds: ReadonlyArray<BotWorkItemId>,
    ) => Effect.Effect<ReadonlyArray<BotItemThreadRecord>, BotError>;
    readonly itemForThread: (thread: BotThreadRef) => Effect.Effect<BotWorkItemId | null, BotError>;
    /** Idempotent per thread and run. */
    readonly recordEpisode: (episode: BotEpisodeRecord) => Effect.Effect<boolean, BotError>;
    /** Adds a thread's messages to what the bot can search; one sent again replaces itself. */
    readonly saveMessages: (
      bot: BotName,
      thread: BotThreadRef,
      messages: ReadonlyArray<BotMessage>,
    ) => Effect.Effect<void, BotError>;
    /** Finished threads whose messages are not copied yet, or have a later run than the copy. */
    readonly threadsToCopy: (
      bot: BotName,
      since: string,
    ) => Effect.Effect<
      ReadonlyArray<
        BotThreadRef & {
          readonly runKey: string;
          readonly endedAt: string;
          readonly fromThreadId: ThreadId | null;
        }
      >,
      BotError
    >;
    readonly markCopied: (thread: BotThreadRef, endedAt: string) => Effect.Effect<void, BotError>;
    /** Passages matching every word of `query`, or any of them when none match all. */
    readonly recall: (
      bot: BotName,
      query: string,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<BotRecallHit>, BotError>;
    /** The latest copied messages of one thread, oldest first. */
    readonly threadMessages: (
      bot: BotName,
      thread: BotThreadRef,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<BotRecallHit>, BotError>;
    /** Notes that still hold, newest first. */
    readonly activeNotes: (bot: BotName) => Effect.Effect<ReadonlyArray<BotNote>, BotError>;
    readonly addFile: (file: Omit<BotFile, "id" | "createdAt">) => Effect.Effect<BotFile, BotError>;
    readonly itemFiles: (
      itemIds: ReadonlyArray<BotWorkItemId>,
    ) => Effect.Effect<ReadonlyArray<BotFile>, BotError>;
    /** Bytes of every copy kept, across all bots. */
    readonly storedFileBytes: Effect.Effect<number, BotError>;
    /** The oldest copies kept, for eviction. */
    readonly oldestStoredFiles: (limit: number) => Effect.Effect<ReadonlyArray<BotFile>, BotError>;
    /** Drops a file's copy and keeps its record. */
    readonly markFileEvicted: (id: string) => Effect.Effect<void, BotError>;
    /** Every note, current ones first, each group newest first. */
    readonly allNotes: (bot: BotName) => Effect.Effect<ReadonlyArray<BotNote>, BotError>;
    readonly reflectionPasses: (
      bot: BotName,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<BotReflectionPass>, BotError>;
    readonly searchNotes: (
      bot: BotName,
      query: string,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<BotNote>, BotError>;
    /** Marks a note outdated; false when it is not an active note of this bot. */
    readonly retireNote: (
      bot: BotName,
      id: string,
      reason: string,
    ) => Effect.Effect<boolean, BotError>;
    /** The oldest unread copied messages, up to `maxChars` of text. */
    readonly unreadMessages: (
      bot: BotName,
      maxChars: number,
    ) => Effect.Effect<ReadonlyArray<BotUnreadMessage>, BotError>;
    readonly reflectionState: (
      bot: BotName,
      since: string,
    ) => Effect.Effect<BotReflectionState, BotError>;
    /**
     * One reflection pass, whole or not at all: the notes it adds and retires, and how far it
     * read. Notes are never deleted; a retired one keeps its reason and what replaced it.
     */
    readonly recordReflection: (
      bot: BotName,
      pass: {
        readonly throughRow: number;
        readonly messages: number;
        readonly rejected: number;
        readonly error: string | null;
        readonly add: ReadonlyArray<
          BotThreadRef & {
            readonly text: string;
            readonly messageId: string;
            readonly quote: string;
          }
        >;
        readonly retire: ReadonlyArray<{
          readonly id: string;
          readonly reason: string;
          /** Position in `add` of the note that replaces it. */
          readonly replacedBy: number | null;
        }>;
      },
    ) => Effect.Effect<{ readonly added: number; readonly retired: number }, BotError>;
    /** One copy of the whole store a day, the last week of them kept. */
    readonly backup: Effect.Effect<void, BotError>;
    readonly latestEpisodes: (
      threads: ReadonlyArray<BotThreadRef>,
    ) => Effect.Effect<ReadonlyArray<BotEpisodeRecord>, BotError>;
  }
>()("t3/bots/BotStore") {}

const SCHEMA_VERSION = 8;
const BACKUPS_KEPT = 7;
const BACKUP_NAME = /^bots-\d{4}-\d{2}-\d{2}\.sqlite$/;

const CHARTER_HISTORY = `
  CREATE TABLE IF NOT EXISTS charters (
    bot TEXT NOT NULL,
    replaced_at TEXT NOT NULL,
    charter TEXT NOT NULL,
    PRIMARY KEY (bot, replaced_at)
  )
`;

// The originals a bot's memory rests on: copied once, never rewritten by a model.
const MESSAGE_COPIES = [
  `CREATE TABLE IF NOT EXISTS messages (
    bot TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (environment_id, thread_id, message_id)
  )`,
  "CREATE INDEX IF NOT EXISTS messages_thread ON messages (bot, environment_id, thread_id, created_at)",
  `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    text, content='messages', content_rowid='rowid', tokenize='porter unicode61'
  )`,
  `CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO messages_fts (rowid, text) VALUES (new.rowid, new.text);
  END`,
  `CREATE TABLE IF NOT EXISTS copied (
    environment_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    PRIMARY KEY (environment_id, thread_id)
  )`,
];

const NOTES = [
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    bot TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    environment_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    quote TEXT NOT NULL,
    outdated_at TEXT,
    outdated_reason TEXT,
    replaced_by TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS notes_bot ON notes (bot, outdated_at, created_at)",
  `CREATE TABLE IF NOT EXISTS reflections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot TEXT NOT NULL,
    at TEXT NOT NULL,
    through_row INTEGER NOT NULL,
    messages INTEGER NOT NULL,
    added INTEGER NOT NULL,
    retired INTEGER NOT NULL,
    rejected INTEGER NOT NULL,
    error TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS reflections_bot ON reflections (bot, at)",
];

const FILES = [
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    bot TEXT NOT NULL,
    item_id TEXT,
    environment_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    title TEXT NOT NULL,
    name TEXT,
    mime_type TEXT,
    bytes INTEGER NOT NULL,
    attachment_id TEXT,
    url TEXT,
    source_path TEXT,
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS files_item ON files (item_id, created_at)",
];

const OVERSEES_COLUMN = "ALTER TABLE bots ADD COLUMN oversees INTEGER NOT NULL DEFAULT 0";

// What one bot told another, kept only to stop two of them answering each other without end.
const BOT_MESSAGES = [
  `CREATE TABLE IF NOT EXISTS bot_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_bot TEXT NOT NULL,
    to_bot TEXT NOT NULL,
    at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS bot_messages_pair ON bot_messages (from_bot, to_bot, at)",
];

const BOT_MESSAGE_ANSWER_COLUMNS = [
  "ALTER TABLE bot_messages ADD COLUMN message_id TEXT",
  "ALTER TABLE bot_messages ADD COLUMN answered_at TEXT",
];

const CONVERSATIONS = [
  `CREATE TABLE IF NOT EXISTS conversations (
    thread_id TEXT PRIMARY KEY,
    bot TEXT NOT NULL,
    title TEXT NOT NULL,
    anchor_message_id TEXT,
    anchor_text TEXT,
    created_at TEXT NOT NULL,
    context_sent TEXT,
    context_run TEXT,
    context_due INTEGER NOT NULL DEFAULT 1
  )`,
  "CREATE INDEX IF NOT EXISTS conversations_bot ON conversations (bot, created_at)",
];
// A bot's session state lived on its row while it had one conversation; those columns stay unread.
const CONVERSATIONS_FROM_BOTS = `
  INSERT OR IGNORE INTO conversations (
    thread_id, bot, title, created_at, context_sent, context_run, context_due
  )
  SELECT thread_id, name, '', created_at, context_sent, context_run, context_due
  FROM bots WHERE thread_id IS NOT NULL
`;
const BOT_MESSAGE_FROM_THREAD_COLUMN = "ALTER TABLE bot_messages ADD COLUMN from_thread_id TEXT";
const EPISODE_FROM_THREAD_COLUMN = "ALTER TABLE episodes ADD COLUMN from_thread_id TEXT";

const CONTEXT_COLUMNS = [
  "ALTER TABLE bots ADD COLUMN context_sent TEXT",
  "ALTER TABLE bots ADD COLUMN context_run TEXT",
  "ALTER TABLE bots ADD COLUMN context_due INTEGER NOT NULL DEFAULT 1",
];

const migrate = Effect.fn("BotStore.migrate")(function* (sql: SqlClient.SqlClient) {
  yield* sql`PRAGMA journal_mode = WAL`;
  yield* sql`PRAGMA synchronous = NORMAL`;
  yield* sql`PRAGMA busy_timeout = 5000`;
  const [row] = yield* sql<{ user_version: number }>`PRAGMA user_version`;
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      if (version < 2) yield* sql.unsafe(CHARTER_HISTORY);
      for (const statement of [
        ...MESSAGE_COPIES,
        ...NOTES,
        ...FILES,
        ...BOT_MESSAGES,
        ...CONVERSATIONS,
      ])
        yield* sql.unsafe(statement);
      if (version === 1) for (const column of CONTEXT_COLUMNS) yield* sql.unsafe(column);
      if (version >= 1 && version < 6) yield* sql.unsafe(OVERSEES_COLUMN);
      if (version < 7) for (const column of BOT_MESSAGE_ANSWER_COLUMNS) yield* sql.unsafe(column);
      yield* sql.unsafe(BOT_MESSAGE_FROM_THREAD_COLUMN);
      if (version >= 1) {
        yield* sql.unsafe(EPISODE_FROM_THREAD_COLUMN);
        yield* sql.unsafe(CONVERSATIONS_FROM_BOTS);
        yield* sql.unsafe(`PRAGMA user_version = ${SCHEMA_VERSION}`);
        return;
      }
      yield* sql`
        CREATE TABLE IF NOT EXISTS bots (
          name TEXT PRIMARY KEY,
          thread_id TEXT,
          purpose TEXT NOT NULL,
          charter TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          context_sent TEXT,
          context_run TEXT,
          context_due INTEGER NOT NULL DEFAULT 1,
          oversees INTEGER NOT NULL DEFAULT 0
        )
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          bot TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT NOT NULL,
          next_step TEXT NOT NULL,
          state TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `;
      yield* sql`CREATE INDEX IF NOT EXISTS items_bot_state ON items (bot, state, updated_at)`;
      yield* sql`
        CREATE TABLE IF NOT EXISTS item_threads (
          environment_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          title TEXT NOT NULL,
          location TEXT NOT NULL,
          linked_at TEXT NOT NULL,
          PRIMARY KEY (environment_id, thread_id)
        )
      `;
      yield* sql`CREATE INDEX IF NOT EXISTS item_threads_item ON item_threads (item_id)`;
      yield* sql`
        CREATE TABLE IF NOT EXISTS episodes (
          environment_id TEXT NOT NULL,
          thread_id TEXT NOT NULL,
          run_key TEXT NOT NULL,
          bot TEXT NOT NULL,
          title TEXT NOT NULL,
          location TEXT NOT NULL,
          outcome TEXT NOT NULL,
          started_at TEXT,
          ended_at TEXT NOT NULL,
          result TEXT NOT NULL,
          from_thread_id TEXT,
          PRIMARY KEY (environment_id, thread_id, run_key)
        )
      `;
      yield* sql`CREATE INDEX IF NOT EXISTS episodes_thread ON episodes (environment_id, thread_id, ended_at)`;
      yield* sql.unsafe(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }),
  );
});

type ItemRow = {
  id: string;
  bot: string;
  title: string;
  detail: string;
  next_step: string;
  state: string;
  created_at: string;
  updated_at: string;
};

const toItem = (row: ItemRow): BotItemRecord => ({
  id: BotWorkItemId.make(row.id),
  bot: row.bot as BotName,
  title: row.title,
  detail: row.detail,
  nextStep: row.next_step,
  state: row.state as BotWorkItemState,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** An open SQLite client on its own file, so bot memory never waits on orchestration writes. */
const makeWith = Effect.fn("BotStore.make")(function* (
  sql: SqlClient.SqlClient,
  backup: BotStore["Service"]["backup"] = Effect.void,
) {
  yield* migrate(sql);
  const random = yield* SecureRandom.SecureRandom;
  const fail = (operation: string) => (cause: unknown) => new BotError({ operation, cause });
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  type BotRow = {
    name: string;
    thread_id: string | null;
    purpose: string;
    charter: string;
    created_at: string;
    updated_at: string;
    oversees: number;
  };
  const toBot = (row: BotRow | undefined): BotRecord | null =>
    row === undefined
      ? null
      : {
          name: row.name as BotName,
          threadId: row.thread_id as ThreadId | null,
          purpose: row.purpose,
          charter: row.charter,
          oversees: row.oversees !== 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
  const getBot: BotStore["Service"]["getBot"] = (name) =>
    sql<BotRow>`SELECT * FROM bots WHERE name = ${name}`.pipe(
      Effect.map(([row]) => toBot(row)),
      Effect.mapError(fail("read a bot")),
    );
  const botForThread: BotStore["Service"]["botForThread"] = (threadId) =>
    sql<BotRow>`
      SELECT b.* FROM bots b JOIN conversations c ON c.bot = b.name WHERE c.thread_id = ${threadId}
    `.pipe(
      Effect.map(([row]) => toBot(row)),
      Effect.mapError(fail("read a bot")),
    );

  type ConversationRow = {
    thread_id: string;
    bot: string;
    title: string;
    anchor_message_id: string | null;
    anchor_text: string | null;
    created_at: string;
    context_sent: string | null;
    context_run: string | null;
    context_due: number;
  };
  const toConversation = (row: ConversationRow): BotConversation => ({
    threadId: row.thread_id as ThreadId,
    bot: row.bot as BotName,
    title: row.title,
    anchor:
      row.anchor_message_id === null
        ? null
        : { messageId: row.anchor_message_id, text: row.anchor_text ?? "" },
    context: { sent: row.context_sent, runId: row.context_run, due: row.context_due !== 0 },
    createdAt: row.created_at,
  });
  const conversation: BotStore["Service"]["conversation"] = (threadId) =>
    sql<ConversationRow>`SELECT * FROM conversations WHERE thread_id = ${threadId}`.pipe(
      Effect.map(([row]) => (row === undefined ? null : toConversation(row))),
      Effect.mapError(fail("read a bot's conversation")),
    );
  const conversations: BotStore["Service"]["conversations"] = (bot) =>
    sql<ConversationRow>`
      SELECT c.* FROM conversations c JOIN bots b ON b.name = c.bot
      WHERE c.bot = ${bot}
      ORDER BY c.thread_id = b.thread_id DESC, c.created_at
    `.pipe(
      Effect.map((rows) => rows.map(toConversation)),
      Effect.mapError(fail("list a bot's conversations")),
    );
  const addConversation: BotStore["Service"]["addConversation"] = Effect.fn(
    "BotStore.addConversation",
  )(
    function* (input) {
      yield* sql`
        INSERT INTO conversations (
          thread_id, bot, title, anchor_message_id, anchor_text, created_at
        ) VALUES (
          ${input.threadId}, ${input.bot}, ${input.title}, ${input.anchor?.messageId ?? null},
          ${input.anchor?.text ?? null}, ${yield* now}
        )
        ON CONFLICT (thread_id) DO NOTHING
      `;
    },
    Effect.mapError(fail("open a bot's conversation")),
  );
  const setThread: BotStore["Service"]["setThread"] = Effect.fn("BotStore.setThread")(
    function* (name, threadId) {
      yield* sql`UPDATE bots SET thread_id = ${threadId} WHERE name = ${name}`;
      yield* addConversation({ threadId, bot: name, title: "", anchor: null });
    },
    Effect.mapError(fail("update a bot")),
  );

  const listBots: BotStore["Service"]["listBots"] = sql<BotRow>`
    SELECT * FROM bots ORDER BY name
  `.pipe(
    Effect.map((rows) => rows.flatMap((row) => toBot(row) ?? [])),
    Effect.mapError(fail("list bots")),
  );

  const ensureBot: BotStore["Service"]["ensureBot"] = Effect.fn("BotStore.ensureBot")(
    function* (input) {
      const at = yield* now;
      yield* sql`
        INSERT INTO bots (name, purpose, charter, created_at, updated_at, oversees)
        VALUES (
          ${input.name}, ${input.purpose}, ${input.charter}, ${at}, ${at},
          ${input.oversees === true ? 1 : 0}
        )
        ON CONFLICT (name) DO NOTHING
      `.pipe(Effect.mapError(fail("create a bot")));
      return (yield* getBot(input.name))!;
    },
  );

  const setCharter: BotStore["Service"]["setCharter"] = Effect.fn("BotStore.setCharter")(
    function* (name, charter) {
      const at = yield* now;
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT OR IGNORE INTO charters (bot, replaced_at, charter)
            SELECT name, ${at}, charter FROM bots WHERE name = ${name} AND charter <> ${charter}
          `;
          yield* sql`UPDATE bots SET charter = ${charter}, updated_at = ${at} WHERE name = ${name}`;
        }),
      );
    },
    Effect.mapError(fail("update a charter")),
  );

  const charterHistory: BotStore["Service"]["charterHistory"] = (name) =>
    sql<{ replaced_at: string; charter: string }>`
      SELECT replaced_at, charter FROM charters WHERE bot = ${name} ORDER BY replaced_at DESC
    `.pipe(
      Effect.map((rows) =>
        rows.map((row) => ({ replacedAt: row.replaced_at, charter: row.charter })),
      ),
      Effect.mapError(fail("read a charter's history")),
    );

  const setContextSent: BotStore["Service"]["setContextSent"] = (threadId, sent, runId) =>
    sql`
      UPDATE conversations SET context_sent = ${sent}, context_run = ${runId}, context_due = 0
      WHERE thread_id = ${threadId}
    `.pipe(Effect.asVoid, Effect.mapError(fail("record a bot's context")));

  const markContextLost: BotStore["Service"]["markContextLost"] = (threadId) =>
    sql`UPDATE conversations SET context_due = 1 WHERE thread_id = ${threadId}`.pipe(
      Effect.asVoid,
      Effect.mapError(fail("record a bot's context")),
    );

  const listItems: BotStore["Service"]["listItems"] = (bot, options) =>
    (options?.includeClosed === true
      ? sql<ItemRow>`SELECT * FROM items WHERE bot = ${bot} ORDER BY updated_at DESC`
      : sql<ItemRow>`
          SELECT * FROM items WHERE bot = ${bot} AND state = 'open' ORDER BY updated_at DESC
        `
    ).pipe(
      Effect.map((rows) => rows.map(toItem)),
      Effect.mapError(fail("list work items")),
    );

  const getItem: BotStore["Service"]["getItem"] = (id) =>
    sql<ItemRow>`SELECT * FROM items WHERE id = ${id}`.pipe(
      Effect.map(([row]) => (row === undefined ? null : toItem(row))),
      Effect.mapError(fail("read a work item")),
    );

  const saveItem: BotStore["Service"]["saveItem"] = Effect.fn("BotStore.saveItem")(
    function* (bot, input) {
      const at = yield* now;
      if (input.id === undefined) {
        const id = BotWorkItemId.make(
          `item:${(yield* random.uuidV4().pipe(Effect.mapError(fail("create a work item")))).slice(0, 8)}`,
        );
        yield* sql`
          INSERT INTO items (id, bot, title, detail, next_step, state, created_at, updated_at)
          VALUES (
            ${id}, ${bot}, ${input.title ?? "Untitled work"}, ${input.detail ?? ""},
            ${input.nextStep ?? ""}, ${input.state ?? "open"}, ${at}, ${at}
          )
        `.pipe(Effect.mapError(fail("create a work item")));
        return (yield* getItem(id))!;
      }
      const current = yield* getItem(input.id);
      if (current === null || current.bot !== bot)
        return yield* new BotError({
          operation: "update a work item",
          cause: new Error(`No work item ${input.id}.`),
        });
      yield* sql`
        UPDATE items SET
          title = ${input.title ?? current.title},
          detail = ${input.detail ?? current.detail},
          next_step = ${input.nextStep ?? current.nextStep},
          state = ${input.state ?? current.state},
          updated_at = ${at}
        WHERE id = ${input.id}
      `.pipe(Effect.mapError(fail("update a work item")));
      return (yield* getItem(input.id))!;
    },
  );

  const linkThread: BotStore["Service"]["linkThread"] = (itemId, thread) =>
    now.pipe(
      Effect.flatMap(
        (at) => sql`
          INSERT INTO item_threads (environment_id, thread_id, item_id, title, location, linked_at)
          VALUES (
            ${thread.environmentId}, ${thread.threadId}, ${itemId}, ${thread.title},
            ${thread.where}, ${at}
          )
          ON CONFLICT (environment_id, thread_id) DO UPDATE SET
            item_id = excluded.item_id,
            title = excluded.title,
            location = excluded.location
        `,
      ),
      Effect.andThen(
        now.pipe(
          Effect.flatMap((at) => sql`UPDATE items SET updated_at = ${at} WHERE id = ${itemId}`),
        ),
      ),
      Effect.asVoid,
      Effect.mapError(fail("link a thread")),
    );

  const itemThreads: BotStore["Service"]["itemThreads"] = (itemIds) =>
    itemIds.length === 0
      ? Effect.succeed([])
      : sql<{
          environment_id: string;
          thread_id: string;
          item_id: string;
          title: string;
          location: string;
          linked_at: string;
        }>`
          SELECT * FROM item_threads WHERE item_id IN ${sql.in(itemIds)} ORDER BY linked_at
        `.pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              environmentId: row.environment_id as EnvironmentId,
              threadId: row.thread_id as ThreadId,
              itemId: BotWorkItemId.make(row.item_id),
              title: row.title,
              where: row.location,
              linkedAt: row.linked_at,
            })),
          ),
          Effect.mapError(fail("read linked threads")),
        );

  const itemForThread: BotStore["Service"]["itemForThread"] = (thread) =>
    sql<{ item_id: string }>`
      SELECT item_id FROM item_threads
      WHERE environment_id = ${thread.environmentId} AND thread_id = ${thread.threadId}
    `.pipe(
      Effect.map(([row]) => (row === undefined ? null : BotWorkItemId.make(row.item_id))),
      Effect.mapError(fail("read a thread's work item")),
    );

  const recordEpisode: BotStore["Service"]["recordEpisode"] = (episode) =>
    sql<{ thread_id: string }>`
      INSERT INTO episodes (
        environment_id, thread_id, run_key, bot, title, location, outcome, started_at, ended_at,
        result, from_thread_id
      ) VALUES (
        ${episode.environmentId}, ${episode.threadId}, ${episode.runKey}, ${episode.bot},
        ${episode.title}, ${episode.where}, ${episode.outcome}, ${episode.startedAt},
        ${episode.endedAt}, ${episode.result}, ${episode.fromThreadId}
      )
      ON CONFLICT (environment_id, thread_id, run_key) DO NOTHING
      RETURNING thread_id
    `.pipe(
      Effect.map((rows) => rows.length > 0),
      Effect.mapError(fail("record a result")),
    );

  const latestEpisodes: BotStore["Service"]["latestEpisodes"] = (threads) =>
    Effect.forEach(
      threads,
      (thread) =>
        sql<{
          environment_id: string;
          thread_id: string;
          run_key: string;
          bot: string;
          title: string;
          location: string;
          outcome: string;
          started_at: string | null;
          ended_at: string;
          result: string;
          from_thread_id: string | null;
        }>`
        SELECT * FROM episodes
        WHERE environment_id = ${thread.environmentId} AND thread_id = ${thread.threadId}
        ORDER BY ended_at DESC LIMIT 1
      `,
    ).pipe(
      Effect.map((rows) =>
        rows.flat().map((row) => ({
          environmentId: row.environment_id as EnvironmentId,
          threadId: row.thread_id as ThreadId,
          runKey: row.run_key,
          bot: row.bot as BotName,
          title: row.title,
          where: row.location,
          outcome: row.outcome,
          startedAt: row.started_at,
          endedAt: row.ended_at,
          result: row.result,
          fromThreadId: row.from_thread_id as ThreadId | null,
        })),
      ),
      Effect.mapError(fail("read results")),
    );

  const saveMessages: BotStore["Service"]["saveMessages"] = (bot, thread, messages) =>
    sql
      .withTransaction(
        Effect.forEach(
          messages,
          (message) => sql`
            INSERT INTO messages (bot, environment_id, thread_id, message_id, role, created_at, text)
            VALUES (
              ${bot}, ${thread.environmentId}, ${thread.threadId}, ${message.id}, ${message.role},
              ${message.createdAt}, ${message.text}
            )
            ON CONFLICT (environment_id, thread_id, message_id) DO UPDATE
            SET text = excluded.text WHERE messages.text <> excluded.text
          `,
          { discard: true },
        ),
      )
      .pipe(Effect.mapError(fail("copy a thread's messages")));

  const threadsToCopy: BotStore["Service"]["threadsToCopy"] = (bot, since) =>
    sql<{
      environment_id: string;
      thread_id: string;
      run_key: string;
      ended_at: string;
      from_thread_id: string | null;
    }>`
      SELECT e.environment_id, e.thread_id, e.run_key, e.from_thread_id,
        MAX(e.ended_at) AS ended_at
      FROM episodes e
      LEFT JOIN copied c ON c.environment_id = e.environment_id AND c.thread_id = e.thread_id
      WHERE e.bot = ${bot} AND e.ended_at >= ${since}
      GROUP BY e.environment_id, e.thread_id
      HAVING c.ended_at IS NULL OR c.ended_at < MAX(e.ended_at)
    `.pipe(
      Effect.map((rows) =>
        rows.map((row) => ({
          environmentId: row.environment_id as EnvironmentId,
          threadId: row.thread_id as ThreadId,
          runKey: row.run_key,
          endedAt: row.ended_at,
          fromThreadId: row.from_thread_id as ThreadId | null,
        })),
      ),
      Effect.mapError(fail("list threads to copy")),
    );

  const markCopied: BotStore["Service"]["markCopied"] = (thread, endedAt) =>
    sql`
      INSERT INTO copied (environment_id, thread_id, ended_at)
      VALUES (${thread.environmentId}, ${thread.threadId}, ${endedAt})
      ON CONFLICT (environment_id, thread_id) DO UPDATE SET ended_at = excluded.ended_at
    `.pipe(Effect.asVoid, Effect.mapError(fail("record a copied thread")));

  type RecallRow = {
    environment_id: string;
    thread_id: string;
    message_id: string;
    role: string;
    created_at: string;
    text: string;
    title: string | null;
    location: string | null;
  };
  const toHit = (row: RecallRow): BotRecallHit => ({
    environmentId: row.environment_id as EnvironmentId,
    threadId: row.thread_id as ThreadId,
    messageId: row.message_id,
    role: row.role,
    createdAt: row.created_at,
    text: row.text,
    title: row.title,
    where: row.location,
  });
  const search = (bot: BotName, match: string, limit: number) =>
    sql<RecallRow>`
      SELECT m.environment_id, m.thread_id, m.message_id, m.role, m.created_at,
        snippet(messages_fts, 0, '', '', ' … ', 60) AS text, t.title, t.location
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      LEFT JOIN item_threads t
        ON t.environment_id = m.environment_id AND t.thread_id = m.thread_id
      WHERE messages_fts MATCH ${match} AND m.bot = ${bot}
      ORDER BY bm25(messages_fts), m.created_at DESC
      LIMIT ${limit}
    `;
  const recall: BotStore["Service"]["recall"] = Effect.fn("BotStore.recall")(
    function* (bot, query, limit) {
      // Quoted, so a word of the query is never read as search syntax.
      const words = (query.match(/[\p{L}\p{N}_]+/gu) ?? []).map((word) => `"${word}"`);
      if (words.length === 0) return [];
      const all = yield* search(bot, words.join(" "), limit);
      const rows =
        all.length > 0 || words.length === 1 ? all : yield* search(bot, words.join(" OR "), limit);
      return rows.map(toHit);
    },
    Effect.mapError(fail("search a bot's memory")),
  );

  const threadMessages: BotStore["Service"]["threadMessages"] = (bot, thread, limit) =>
    sql<RecallRow>`
      SELECT * FROM (
        SELECT m.environment_id, m.thread_id, m.message_id, m.role, m.created_at, m.text,
          t.title, t.location
        FROM messages m
        LEFT JOIN item_threads t
          ON t.environment_id = m.environment_id AND t.thread_id = m.thread_id
        WHERE m.bot = ${bot} AND m.environment_id = ${thread.environmentId}
          AND m.thread_id = ${thread.threadId}
        ORDER BY m.created_at DESC
        LIMIT ${limit}
      ) ORDER BY created_at
    `.pipe(
      Effect.map((rows) => rows.map(toHit)),
      Effect.mapError(fail("read a copied thread")),
    );

  const countBotMessages: BotStore["Service"]["countBotMessages"] = (from, to, since) =>
    sql<{ count: number }>`
      SELECT COUNT(*) AS count FROM bot_messages
      WHERE from_bot = ${from} AND to_bot = ${to} AND at >= ${since}
    `.pipe(
      Effect.map(([row]) => row?.count ?? 0),
      Effect.mapError(fail("count messages between bots")),
    );

  const addBotMessage: BotStore["Service"]["addBotMessage"] = Effect.fn("BotStore.addBotMessage")(
    function* (input) {
      yield* sql`
        INSERT INTO bot_messages (from_bot, to_bot, at, message_id, from_thread_id)
        VALUES (
          ${input.from}, ${input.to}, ${yield* now}, ${input.messageId}, ${input.fromThreadId}
        )
      `;
    },
    Effect.mapError(fail("record a message between bots")),
  );

  type BotToldRow = {
    id: number;
    from_bot: string;
    to_bot: string;
    message_id: string;
    from_thread_id: string | null;
  };
  const toTold = (rows: ReadonlyArray<BotToldRow>): ReadonlyArray<BotToldMessage> =>
    rows.map((row) => ({
      id: row.id,
      from: row.from_bot as BotName,
      fromThreadId: row.from_thread_id as ThreadId | null,
      to: row.to_bot as BotName,
      messageId: row.message_id,
    }));

  const unansweredBotMessages: BotStore["Service"]["unansweredBotMessages"] = (messageIds) =>
    messageIds.length === 0
      ? Effect.succeed([])
      : sql<BotToldRow>`
          SELECT id, from_bot, to_bot, message_id, from_thread_id FROM bot_messages
          WHERE answered_at IS NULL AND message_id IN ${sql.in(messageIds)}
        `.pipe(Effect.map(toTold), Effect.mapError(fail("read messages between bots")));

  const unansweredBotMessagesSince: BotStore["Service"]["unansweredBotMessagesSince"] = (since) =>
    sql<BotToldRow>`
      SELECT id, from_bot, to_bot, message_id, from_thread_id FROM bot_messages
      WHERE answered_at IS NULL AND message_id IS NOT NULL AND at >= ${since}
    `.pipe(Effect.map(toTold), Effect.mapError(fail("read messages between bots")));

  const markBotMessageAnswered: BotStore["Service"]["markBotMessageAnswered"] = Effect.fn(
    "BotStore.markBotMessageAnswered",
  )(
    function* (id) {
      yield* sql`UPDATE bot_messages SET answered_at = ${yield* now} WHERE id = ${id}`;
    },
    Effect.mapError(fail("record an answer between bots")),
  );

  type FileRow = {
    id: string;
    bot: string;
    item_id: string | null;
    environment_id: string;
    thread_id: string;
    title: string;
    name: string | null;
    mime_type: string | null;
    bytes: number;
    attachment_id: string | null;
    url: string | null;
    source_path: string | null;
    created_at: string;
  };
  const toFile = (row: FileRow): BotFile => ({
    id: row.id,
    bot: row.bot as BotName,
    itemId: row.item_id as BotWorkItemId | null,
    environmentId: row.environment_id as EnvironmentId,
    threadId: row.thread_id as ThreadId,
    title: row.title,
    name: row.name,
    mimeType: row.mime_type,
    bytes: row.bytes,
    attachmentId: row.attachment_id,
    url: row.url,
    sourcePath: row.source_path,
    createdAt: row.created_at,
  });

  const addFile: BotStore["Service"]["addFile"] = Effect.fn("BotStore.addFile")(
    function* (file) {
      const id = `file:${(yield* random.uuidV4()).slice(0, 8)}`;
      const createdAt = yield* now;
      yield* sql`
        INSERT INTO files (
          id, bot, item_id, environment_id, thread_id, title, name, mime_type, bytes,
          attachment_id, url, source_path, created_at
        ) VALUES (
          ${id}, ${file.bot}, ${file.itemId}, ${file.environmentId}, ${file.threadId},
          ${file.title}, ${file.name}, ${file.mimeType}, ${file.bytes}, ${file.attachmentId},
          ${file.url}, ${file.sourcePath}, ${createdAt}
        )
      `;
      return { ...file, id, createdAt };
    },
    Effect.mapError(fail("record a file")),
  );

  const itemFiles: BotStore["Service"]["itemFiles"] = (itemIds) =>
    itemIds.length === 0
      ? Effect.succeed([])
      : sql<FileRow>`
          SELECT * FROM files WHERE item_id IN ${sql.in(itemIds)} ORDER BY created_at
        `.pipe(
          Effect.map((rows) => rows.map(toFile)),
          Effect.mapError(fail("read files")),
        );

  const storedFileBytes: BotStore["Service"]["storedFileBytes"] = sql<{ total: number | null }>`
    SELECT SUM(bytes) AS total FROM files WHERE attachment_id IS NOT NULL
  `.pipe(
    Effect.map(([row]) => row?.total ?? 0),
    Effect.mapError(fail("measure kept files")),
  );

  const oldestStoredFiles: BotStore["Service"]["oldestStoredFiles"] = (limit) =>
    sql<FileRow>`
      SELECT * FROM files WHERE attachment_id IS NOT NULL ORDER BY created_at LIMIT ${limit}
    `.pipe(
      Effect.map((rows) => rows.map(toFile)),
      Effect.mapError(fail("read files")),
    );

  const markFileEvicted: BotStore["Service"]["markFileEvicted"] = (id) =>
    sql`UPDATE files SET attachment_id = NULL WHERE id = ${id}`.pipe(
      Effect.asVoid,
      Effect.mapError(fail("record an evicted file")),
    );

  type NoteRow = {
    id: string;
    text: string;
    created_at: string;
    environment_id: string;
    thread_id: string;
    message_id: string;
    quote: string;
    outdated_at: string | null;
    outdated_reason: string | null;
    replaced_by: string | null;
    source: string | null;
  };
  const toNote = (row: NoteRow): BotNote => ({
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    environmentId: row.environment_id as EnvironmentId,
    threadId: row.thread_id as ThreadId,
    messageId: row.message_id,
    quote: row.quote,
    source: row.source,
    outdatedAt: row.outdated_at,
    outdatedReason: row.outdated_reason,
    replacedBy: row.replaced_by,
  });

  const notesOf = (bot: BotName) => sql<NoteRow>`
    SELECT n.*, t.title AS source
    FROM notes n
    LEFT JOIN item_threads t
      ON t.environment_id = n.environment_id AND t.thread_id = n.thread_id
    WHERE n.bot = ${bot}
    ORDER BY n.outdated_at IS NOT NULL, n.created_at DESC
  `;

  const allNotes: BotStore["Service"]["allNotes"] = (bot) =>
    notesOf(bot).pipe(
      Effect.map((rows) => rows.map(toNote)),
      Effect.mapError(fail("read notes")),
    );

  const activeNotes: BotStore["Service"]["activeNotes"] = (bot) =>
    allNotes(bot).pipe(Effect.map((notes) => notes.filter((note) => note.outdatedAt === null)));

  const reflectionPasses: BotStore["Service"]["reflectionPasses"] = (bot, limit) =>
    sql<BotReflectionPass>`
      SELECT at, messages, added, retired, rejected, error FROM reflections
      WHERE bot = ${bot} ORDER BY id DESC LIMIT ${limit}
    `.pipe(
      Effect.map((rows) => rows.map((row) => ({ ...row }))),
      Effect.mapError(fail("read reflection passes")),
    );

  // Notes are few, so every word is matched in turn, outdated notes included.
  const searchNotes: BotStore["Service"]["searchNotes"] = (bot, query, limit) => {
    const words = (query.match(/[\p{L}\p{N}_]+/gu) ?? []).map((word) => word.toLowerCase());
    return words.length === 0
      ? Effect.succeed([])
      : notesOf(bot).pipe(
          Effect.map((rows) =>
            rows
              .filter((row) => words.every((word) => row.text.toLowerCase().includes(word)))
              .slice(0, limit)
              .map(toNote),
          ),
          Effect.mapError(fail("search notes")),
        );
  };

  const retireNote: BotStore["Service"]["retireNote"] = Effect.fn("BotStore.retireNote")(
    function* (bot, id, reason) {
      const at = yield* now;
      const rows = yield* sql<{ id: string }>`
        UPDATE notes SET outdated_at = ${at}, outdated_reason = ${reason}
        WHERE id = ${id} AND bot = ${bot} AND outdated_at IS NULL
        RETURNING id
      `;
      return rows.length > 0;
    },
    Effect.mapError(fail("retire a note")),
  );

  const reflectedRow = (bot: BotName) =>
    sql<{ row: number | null }>`
      SELECT MAX(through_row) AS row FROM reflections WHERE bot = ${bot}
    `.pipe(Effect.map(([found]) => found?.row ?? 0));

  const unreadMessages: BotStore["Service"]["unreadMessages"] = Effect.fn(
    "BotStore.unreadMessages",
  )(
    function* (bot, maxChars) {
      const after = yield* reflectedRow(bot);
      const rows = yield* sql<RecallRow & { row: number }>`
        SELECT m.rowid AS row, m.environment_id, m.thread_id, m.message_id, m.role, m.created_at,
          m.text, t.title, t.location
        FROM messages m
        LEFT JOIN item_threads t
          ON t.environment_id = m.environment_id AND t.thread_id = m.thread_id
        WHERE m.bot = ${bot} AND m.rowid > ${after}
        ORDER BY m.rowid
        LIMIT 400
      `;
      const batch: Array<BotUnreadMessage> = [];
      let chars = 0;
      for (const row of rows) {
        chars += row.text.length;
        if (batch.length > 0 && chars > maxChars) break;
        batch.push({ ...toHit(row), row: row.row });
      }
      return batch;
    },
    Effect.mapError(fail("read unread messages")),
  );

  const reflectionState: BotStore["Service"]["reflectionState"] = Effect.fn(
    "BotStore.reflectionState",
  )(
    function* (bot, since) {
      const after = yield* reflectedRow(bot);
      const [unread] = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM messages WHERE bot = ${bot} AND rowid > ${after}
      `;
      const [last] = yield* sql<{ at: string | null; passes: number }>`
        SELECT MAX(at) AS at, COALESCE(SUM(at >= ${since}), 0) AS passes
        FROM reflections WHERE bot = ${bot}
      `;
      const lastAt = last?.at ?? null;
      const [closed] = yield* sql<{ count: number }>`
        SELECT COUNT(*) AS count FROM items
        WHERE bot = ${bot} AND state <> 'open' AND updated_at > ${lastAt ?? ""}
      `;
      return {
        unread: unread?.count ?? 0,
        lastAt,
        passesSince: last?.passes ?? 0,
        itemClosed: (closed?.count ?? 0) > 0,
      };
    },
    Effect.mapError(fail("read a bot's reflection state")),
  );

  const recordReflection: BotStore["Service"]["recordReflection"] = Effect.fn(
    "BotStore.recordReflection",
  )(
    function* (bot, pass) {
      const at = yield* now;
      const ids: Array<string> = [];
      for (const _ of pass.add) ids.push(`note:${(yield* random.uuidV4()).slice(0, 8)}`);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const [index, note] of pass.add.entries())
            yield* sql`
              INSERT INTO notes (
                id, bot, text, created_at, environment_id, thread_id, message_id, quote
              ) VALUES (
                ${ids[index]!}, ${bot}, ${note.text}, ${at}, ${note.environmentId},
                ${note.threadId}, ${note.messageId}, ${note.quote}
              )
            `;
          let retired = 0;
          for (const note of pass.retire) {
            const rows = yield* sql<{ id: string }>`
              UPDATE notes
              SET outdated_at = ${at}, outdated_reason = ${note.reason},
                replaced_by = ${note.replacedBy === null ? null : (ids[note.replacedBy] ?? null)}
              WHERE id = ${note.id} AND bot = ${bot} AND outdated_at IS NULL
              RETURNING id
            `;
            retired += rows.length;
          }
          yield* sql`
            INSERT INTO reflections (bot, at, through_row, messages, added, retired, rejected, error)
            VALUES (
              ${bot}, ${at}, ${pass.throughRow}, ${pass.messages}, ${ids.length}, ${retired},
              ${pass.rejected}, ${pass.error}
            )
          `;
          return { added: ids.length, retired };
        }),
      );
    },
    Effect.mapError(fail("record a reflection")),
  );

  return BotStore.of({
    getBot,
    listBots,
    ensureBot,
    setThread,
    botForThread,
    conversation,
    conversations,
    addConversation,
    setCharter,
    charterHistory,
    setContextSent,
    markContextLost,
    listItems,
    getItem,
    saveItem,
    linkThread,
    itemThreads,
    itemForThread,
    recordEpisode,
    latestEpisodes,
    saveMessages,
    threadsToCopy,
    markCopied,
    recall,
    threadMessages,
    countBotMessages,
    addBotMessage,
    unansweredBotMessages,
    unansweredBotMessagesSince,
    markBotMessageAnswered,
    addFile,
    itemFiles,
    storedFileBytes,
    oldestStoredFiles,
    markFileEvicted,
    activeNotes,
    allNotes,
    reflectionPasses,
    searchNotes,
    retireNote,
    unreadMessages,
    reflectionState,
    recordReflection,
    backup,
  });
});

/** Beside statev2.sqlite, outside upstream's migrations, and backed up or moved on its own. */
export const layer = Layer.effect(
  BotStore,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const context = yield* Layer.build(
      NodeSqliteClient.layer({ filename: path.join(config.stateDir, "bots.sqlite") }),
    );
    const sql = Context.get(context, SqlClient.SqlClient);
    const directory = path.join(config.stateDir, "bots-backups");
    const backup = Effect.gen(function* () {
      const day = DateTime.formatIso(yield* DateTime.now).slice(0, 10);
      const target = path.join(directory, `bots-${day}.sqlite`);
      yield* fs.makeDirectory(directory, { recursive: true });
      if (yield* fs.exists(target)) return;
      // Written beside its name, so a copy cut short is never taken for a whole one.
      const partial = `${target}.partial`;
      yield* fs.remove(partial, { force: true });
      yield* sql.unsafe(`VACUUM INTO '${partial.replaceAll("'", "''")}'`);
      yield* fs.rename(partial, target);
      const copies = (yield* fs.readDirectory(directory)).filter((name) => BACKUP_NAME.test(name));
      for (const name of copies.toSorted().slice(0, -BACKUPS_KEPT))
        yield* fs.remove(path.join(directory, name));
    }).pipe(Effect.mapError((cause) => new BotError({ operation: "back up bot memory", cause })));
    return yield* makeWith(sql, backup);
  }).pipe(Effect.orDie),
);

export const layerMemory = Layer.effect(
  BotStore,
  Effect.gen(function* () {
    const context = yield* Layer.build(NodeSqliteClient.layer({ filename: ":memory:" }));
    return yield* makeWith(Context.get(context, SqlClient.SqlClient));
  }).pipe(Effect.orDie),
);
