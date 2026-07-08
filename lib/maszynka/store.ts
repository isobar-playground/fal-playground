// Server-only Neon access for Maszynka runs (see ADR 0001 — runs and configs live in
// Neon, not localStorage, because run history must be shared across operators/browsers).
// Shared by both app/api/maszynka/runs route files so the schema/mapping lives once.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { RunStatus } from "./status";

export const runtime = "nodejs";

export interface MaszynkaStatusEvent {
  status: RunStatus;
  at: string; // ISO
  detail?: string;
}

export interface MaszynkaRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  assetType: "image" | "video";
  status: RunStatus;
  statusHistory: MaszynkaStatusEvent[];
  userPromptRaw: string;
  modelKey: string;
  modelId: string;
  modelLabel: string;
  packshotUrl: string | null;
  falRequest: unknown;
  falResponse: unknown;
  outputs: { url: string; width?: number; height?: number }[];
  error: string | null;
  contract: unknown; // Prompt builder Contract snapshot (slice 3) — see lib/maszynka/contract.ts
  // Prompt builder LLM stage (slice 4) — see lib/maszynka/promptBuilder.ts. The operator's
  // chosen OpenRouter model, the raw request/response sent/received, and the parsed +
  // schema-validated structured output (finalPrompt/negativePrompt/promptSummary/
  // appliedRules/riskNotes) that then drives FAL generation.
  promptBuilderModel: string | null;
  promptBuilderRequest: unknown;
  promptBuilderResponse: unknown;
  promptBuilderOutput: unknown;
}

interface RunRow {
  id: string;
  created_at: string;
  updated_at: string;
  asset_type: string;
  status: string;
  status_history: MaszynkaStatusEvent[];
  user_prompt_raw: string;
  model_key: string;
  model_id: string;
  model_label: string;
  packshot_url: string | null;
  fal_request: unknown;
  fal_response: unknown;
  outputs: MaszynkaRun["outputs"];
  error: string | null;
  contract: unknown;
  prompt_builder_model: string | null;
  prompt_builder_request: unknown;
  prompt_builder_response: unknown;
  prompt_builder_output: unknown;
}

export function rowToRun(row: RunRow): MaszynkaRun {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    assetType: row.asset_type === "video" ? "video" : "image",
    status: row.status as RunStatus,
    statusHistory: row.status_history ?? [],
    userPromptRaw: row.user_prompt_raw,
    modelKey: row.model_key,
    modelId: row.model_id,
    modelLabel: row.model_label,
    packshotUrl: row.packshot_url,
    falRequest: row.fal_request ?? null,
    falResponse: row.fal_response ?? null,
    outputs: row.outputs ?? [],
    error: row.error,
    contract: row.contract ?? null,
    promptBuilderModel: row.prompt_builder_model ?? null,
    promptBuilderRequest: row.prompt_builder_request ?? null,
    promptBuilderResponse: row.prompt_builder_response ?? null,
    promptBuilderOutput: row.prompt_builder_output ?? null,
  };
}

// Created on first write so there's no separate migration step (same pattern as
// app/api/log-generation and app/api/log-chat). Reset on failure so a transient DDL
// error doesn't permanently wedge every later query.
let schemaReady: Promise<void> | null = null;
export function ensureSchema(sql: NeonQueryFunction<false, false>) {
  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS maszynka_runs (
        id              text        PRIMARY KEY,
        created_at      timestamptz NOT NULL DEFAULT now(),
        updated_at      timestamptz NOT NULL DEFAULT now(),
        asset_type      text        NOT NULL DEFAULT 'image',
        status          text        NOT NULL,
        status_history  jsonb       NOT NULL DEFAULT '[]'::jsonb,
        user_prompt_raw text        NOT NULL,
        model_key       text        NOT NULL,
        model_id        text        NOT NULL,
        model_label     text        NOT NULL,
        packshot_url    text,
        fal_request     jsonb,
        fal_response    jsonb,
        outputs         jsonb       NOT NULL DEFAULT '[]'::jsonb,
        error           text
      )
    `;
    // Slice 3 adds the Prompt builder Contract. `CREATE TABLE IF NOT EXISTS` above is a
    // no-op on a database that already has the table from slice 1/2, so the new column
    // needs its own idempotent statement — same "created on first write" story, just for
    // a column instead of the whole table.
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS contract jsonb`;
    // Slice 4 adds the Prompt builder LLM stage — same idempotent-column story.
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_builder_model text`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_builder_request jsonb`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_builder_response jsonb`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_builder_output jsonb`;
  })()
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null;
      throw e;
    });
  return schemaReady;
}

/** Returns null (not an error) when DATABASE_URL isn't set — callers turn that into 503. */
export function getSql(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL;
  return url ? neon(url) : null;
}
