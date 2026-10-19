import { AtlasInitiative, AtlasPersistenceError, type ProjectId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

const encodeInitiative = Schema.encodeEffect(Schema.fromJsonString(AtlasInitiative));
const decodeInitiative = Schema.decodeUnknownEffect(Schema.fromJsonString(AtlasInitiative));

interface AtlasInitiativeRow {
  readonly initiative_id: string;
  readonly initiative_json: string;
}

const persistenceError = (operation: AtlasPersistenceError["operation"], cause: unknown) =>
  new AtlasPersistenceError({ operation, cause });

const toInitiative = (row: AtlasInitiativeRow) =>
  decodeInitiative(row.initiative_json).pipe(
    Effect.mapError((cause) => persistenceError("decode", cause)),
  );

export class AtlasStore extends Context.Service<
  AtlasStore,
  {
    readonly list: (
      projectId?: ProjectId,
    ) => Effect.Effect<ReadonlyArray<AtlasInitiative>, AtlasPersistenceError>;
    readonly get: (
      initiativeId: AtlasInitiative["id"],
    ) => Effect.Effect<Option.Option<AtlasInitiative>, AtlasPersistenceError>;
    readonly save: (initiative: AtlasInitiative) => Effect.Effect<void, AtlasPersistenceError>;
    readonly remove: (
      initiativeId: AtlasInitiative["id"],
    ) => Effect.Effect<boolean, AtlasPersistenceError>;
  }
>()("t3/atlas/AtlasStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const list: AtlasStore["Service"]["list"] = (projectId) =>
    Effect.gen(function* () {
      const rows =
        projectId === undefined
          ? yield* sql<AtlasInitiativeRow>`
              SELECT initiative_id, initiative_json
              FROM atlas_initiatives
              ORDER BY updated_at DESC, initiative_id
            `
          : yield* sql<AtlasInitiativeRow>`
              SELECT initiative_id, initiative_json
              FROM atlas_initiatives
              WHERE project_id = ${projectId}
              ORDER BY updated_at DESC, initiative_id
            `;
      return yield* Effect.forEach(rows, toInitiative, { concurrency: 1 });
    }).pipe(Effect.mapError((cause) => persistenceError("list", cause)));

  const get: AtlasStore["Service"]["get"] = (initiativeId) =>
    Effect.gen(function* () {
      const rows = yield* sql<AtlasInitiativeRow>`
        SELECT initiative_id, initiative_json
        FROM atlas_initiatives
        WHERE initiative_id = ${initiativeId}
      `;
      const row = rows[0];
      return row === undefined
        ? Option.none<AtlasInitiative>()
        : Option.some(yield* toInitiative(row));
    }).pipe(Effect.mapError((cause) => persistenceError("get", cause)));

  const save: AtlasStore["Service"]["save"] = (initiative) =>
    Effect.gen(function* () {
      const initiativeJson = yield* encodeInitiative(initiative);
      yield* sql`
        INSERT INTO atlas_initiatives (
          initiative_id,
          project_id,
          initiative_json,
          created_at,
          updated_at
        ) VALUES (
          ${initiative.id},
          ${initiative.projectId},
          ${initiativeJson},
          ${initiative.createdAt},
          ${initiative.updatedAt}
        )
        ON CONFLICT(initiative_id) DO UPDATE SET
          project_id = excluded.project_id,
          initiative_json = excluded.initiative_json,
          updated_at = excluded.updated_at
      `;
    }).pipe(Effect.mapError((cause) => persistenceError("save", cause)));

  const remove: AtlasStore["Service"]["remove"] = (initiativeId) =>
    Effect.gen(function* () {
      const removed = yield* sql<{ readonly initiative_id: string }>`
        DELETE FROM atlas_initiatives
        WHERE initiative_id = ${initiativeId}
        RETURNING initiative_id
      `;
      return removed.length > 0;
    }).pipe(Effect.mapError((cause) => persistenceError("delete", cause)));

  return AtlasStore.of({ list, get, save, remove });
});

export const layer = Layer.effect(AtlasStore, make);
