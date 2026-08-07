// Server-only Neon access for Maszynka Video runs — a separate table + module set
// from lib/maszynka/store.ts by design (PRD 0003: the image and video pipelines
// share no stage), following the same ADR 0001 rationale: Video runs are recorded
// server-side and shared across operators, never localStorage. Shared by both
// app/api/maszynka-video/runs route files so the schema lives once.
import "../neonLocal";
import type { NeonQueryFunction } from "@neondatabase/serverless";

// The DATABASE_URL accessor is identical for both stores — reuse it rather than copy it.
export { getSql } from "../maszynka/store";
export { rowToVideoRun, type VideoRun, type VideoRunRow } from "./runMapping";

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
  })()
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null;
      throw e;
    });
  return schemaReady;
}
