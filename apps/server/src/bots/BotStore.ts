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
  /** The bot's conversation; replaced when that thread is deleted and the bot started again. */
  readonly threadId: ThreadId | null;
  readonly purpose: string;
  readonly charter: string;
  /** What its model session was last sent in full, and the run that carried it. */
  readonly context: {
    readonly sent: string | null;
    readonly runId: string | null;
    /** The session lost its earlier messages since, so the next turn sends it all again. */
    readonly due: boolean;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
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
    }) => Effect.Effect<BotRecord, BotError>;
    readonly setThread: (name: BotName, threadId: ThreadId) => Effect.Effect<void, BotError>;
    readonly botForThread: (threadId: ThreadId) => Effect.Effect<BotRecord | null, BotError>;
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
      name: BotName,
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
    /** One copy of the whole store a day, the last week of them kept. */
    readonly backup: Effect.Effect<void, BotError>;
    readonly latestEpisodes: (
      threads: ReadonlyArray<BotThreadRef>,
    ) => Effect.Effect<ReadonlyArray<BotEpisodeRecord>, BotError>;
  }
>()("t3/bots/BotStore") {}

const SCHEMA_VERSION = 2;
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
      if (version === 1) for (const column of CONTEXT_COLUMNS) yield* sql.unsafe(column);
      if (version >= 1) {
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
          context_due INTEGER NOT NULL DEFAULT 1
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
    context_sent: string | null;
    context_run: string | null;
    context_due: number;
  };
  const toBot = (row: BotRow | undefined): BotRecord | null =>
    row === undefined
      ? null
      : {
          name: row.name as BotName,
          threadId: row.thread_id as ThreadId | null,
          purpose: row.purpose,
          charter: row.charter,
          context: { sent: row.context_sent, runId: row.context_run, due: row.context_due !== 0 },
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
  const getBot: BotStore["Service"]["getBot"] = (name) =>
    sql<BotRow>`SELECT * FROM bots WHERE name = ${name}`.pipe(
      Effect.map(([row]) => toBot(row)),
      Effect.mapError(fail("read a bot")),
    );
  const botForThread: BotStore["Service"]["botForThread"] = (threadId) =>
    sql<BotRow>`SELECT * FROM bots WHERE thread_id = ${threadId}`.pipe(
      Effect.map(([row]) => toBot(row)),
      Effect.mapError(fail("read a bot")),
    );
  const setThread: BotStore["Service"]["setThread"] = (name, threadId) =>
    sql`UPDATE bots SET thread_id = ${threadId} WHERE name = ${name}`.pipe(
      Effect.asVoid,
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
        INSERT INTO bots (name, purpose, charter, created_at, updated_at)
        VALUES (${input.name}, ${input.purpose}, ${input.charter}, ${at}, ${at})
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

  const setContextSent: BotStore["Service"]["setContextSent"] = (name, sent, runId) =>
    sql`
      UPDATE bots SET context_sent = ${sent}, context_run = ${runId}, context_due = 0
      WHERE name = ${name}
    `.pipe(Effect.asVoid, Effect.mapError(fail("record a bot's context")));

  const markContextLost: BotStore["Service"]["markContextLost"] = (threadId) =>
    sql`UPDATE bots SET context_due = 1 WHERE thread_id = ${threadId}`.pipe(
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
        result
      ) VALUES (
        ${episode.environmentId}, ${episode.threadId}, ${episode.runKey}, ${episode.bot},
        ${episode.title}, ${episode.where}, ${episode.outcome}, ${episode.startedAt},
        ${episode.endedAt}, ${episode.result}
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
        })),
      ),
      Effect.mapError(fail("read results")),
    );

  return BotStore.of({
    getBot,
    listBots,
    ensureBot,
    setThread,
    botForThread,
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
