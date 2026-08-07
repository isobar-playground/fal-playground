// Server-only Neon access for Maszynka Video runs — a separate table + module set
// from lib/maszynka/store.ts by design (PRD 0003: the image and video pipelines
// share no stage), following the same ADR 0001 rationale: Video runs are recorded
// server-side and shared across operators, never localStorage. Shared by both
// app/api/maszynka-video/runs route files so the schema lives once.
import "../neonLocal";
import type { NeonQueryFunction } from "@neondatabase/serverless";

// The DATABASE_URL accessor is identical for both stores — reuse it rather than copy it.
export { getSql } from "../maszynka/store";
export {
  rowToVideoRun,
  type VideoCropRecord,
  type VideoGridRecord,
  type VideoReferenceFile,
  type VideoRun,
  type VideoRunRow,
} from "./runMapping";

export const runtime = "nodejs";

// Created on first write so there's no separate migration step (same pattern as
// lib/maszynka/store.ts). Reset on failure so a transient DDL error doesn't
// permanently wedge every later query.
let schemaReady: Promise<void> | null = null;
export function ensureVideoSchema(sql: NeonQueryFunction<false, false>) {
  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS maszynka_video_runs (
        id             text        PRIMARY KEY,
        created_at     timestamptz NOT NULL DEFAULT now(),
        updated_at     timestamptz NOT NULL DEFAULT now(),
        name           text        NOT NULL,
        global_rules   text        NOT NULL DEFAULT '',
        priority_logic text        NOT NULL DEFAULT ''
      )
    `;
    // Slice 2 (issue #25) adds the Planner stage — idempotent per-column additions,
    // same "created on first write" story as lib/maszynka/store.ts.
    await sql`ALTER TABLE maszynka_video_runs ADD COLUMN IF NOT EXISTS planner_config jsonb`;
    await sql`ALTER TABLE maszynka_video_runs ADD COLUMN IF NOT EXISTS planner_request jsonb`;
    await sql`ALTER TABLE maszynka_video_runs ADD COLUMN IF NOT EXISTS planner_response jsonb`;
    await sql`ALTER TABLE maszynka_video_runs ADD COLUMN IF NOT EXISTS planner_output jsonb`;
    await sql`ALTER TABLE maszynka_video_runs ADD COLUMN IF NOT EXISTS planner_validation_error text`;
    // Slice 3 (issue #26) adds reference files — uploaded once via FAL storage, reused
    // by the Planner (image parts) and the grid stage. Full-replace jsonb array.
    await sql`ALTER TABLE maszynka_video_runs ADD COLUMN IF NOT EXISTS reference_files jsonb NOT NULL DEFAULT '[]'::jsonb`;
    // Slice 4 (issue #27) adds grid results — a jsonb MAP keyed by batchId (same
    // upsert-one-key pattern as maszynka_runs.manual_scores) so regenerating one grid
    // never touches another grid's stored result.
    await sql`ALTER TABLE maszynka_video_runs ADD COLUMN IF NOT EXISTS grids jsonb NOT NULL DEFAULT '{}'::jsonb`;
    // Slice 5 (issue #28) adds Crops — a jsonb map keyed by sceneId (spec: mapping is
    // by sceneId ONLY), upserted per scene so Replace crop swaps a single entry.
    await sql`ALTER TABLE maszynka_video_runs ADD COLUMN IF NOT EXISTS crops jsonb NOT NULL DEFAULT '{}'::jsonb`;
  })()
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null;
      throw e;
    });
  return schemaReady;
}
