import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS atlas_initiatives (
      initiative_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      initiative_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS atlas_initiatives_project_updated
    ON atlas_initiatives (project_id, updated_at DESC)
  `;
});
