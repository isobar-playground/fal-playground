// Server-only Neon access for Maszynka runs (see ADR 0001 — runs and configs live in
// Neon, not localStorage, because run history must be shared across operators/browsers).
// Shared by both app/api/maszynka/runs route files so the schema/mapping lives once.
import "../neonLocal";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import type { RunStatus } from "./status";
import type { AssetRole } from "./contract";
import type { ScoresByAsset } from "./scoring";

export const runtime = "nodejs";

export interface MaszynkaStatusEvent {
  status: RunStatus;
  at: string; // ISO
  detail?: string;
}

/** One uploaded asset as stored on the run (issue #6): the role comes from which of the
 *  four upload fields it was dropped into (see MaszynkaView.tsx), never from operator
 *  description — see CONTEXT.md "Asset role". `id` lets the debug preview and the Asset
 *  analysis stage's per-asset records (`assetAnalysisResults`) refer back to the exact
 *  upload. */
export interface RunAsset {
  id: string;
  role: AssetRole;
  url: string;
}

export interface MaszynkaRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  assetType: "image" | "video";
  status: RunStatus;
  statusHistory: MaszynkaStatusEvent[];
  userPromptRaw: string;
  // Prompt improvement (issue #8) — a UI-driven, operator-triggered stage that runs
  // client-side *before* a run exists (see lib/maszynka/promptImprovement.ts), so
  // there's no request/response/status to persist for it, only its outcome: whether
  // the operator used it at all, whether they accepted the proposal, and the accepted
  // text. Recorded once at run creation, alongside `userPromptRaw` above — never
  // patched afterward. `userPromptImproved` is null unless `promptImprovementAccepted`
  // is true.
  promptImprovementUsed: boolean;
  promptImprovementAccepted: boolean;
  userPromptImproved: string | null;
  modelKey: string;
  modelId: string;
  modelLabel: string;
  // Model recommendation (issue #9 / PRD section 12 "Model recommendation") — recorded
  // once at creation, never patched. Image runs only: video runs (assetType: "video")
  // leave all four fields null (no video recommendation rules yet — see
  // lib/maszynka/recommend.ts module header). `recommendedModel` and
  // `operatorSelectedModel` are lib/models.ts catalog keys, same representation as
  // `modelKey` above (which `operatorSelectedModel` always equals — the PRD lists it as
  // its own tracked field regardless).
  recommendedModel: string | null;
  operatorSelectedModel: string | null;
  modelOverrideUsed: boolean;
  modelRecommendationReason: string | null;
  // Content safety pre-check LLM stage (issue #7) — see lib/maszynka/contentSafety.ts.
  // Runs first, before Asset analysis. The operator's chosen OpenRouter model, the raw
  // request/response, and the parsed structured output (status/reasons/constraints).
  // Single call per run (no revise loop of its own — a `content_safety_revise_required`
  // verdict means the operator must start a new run with a changed prompt/assets), so
  // these are plain fields, not an append-only attempts array like the Prompt builder/
  // reviewer pair.
  contentSafetyModel: string | null;
  contentSafetyRequest: unknown;
  contentSafetyResponse: unknown;
  contentSafetyOutput: unknown;
  // Every uploaded asset (any/all of packshot/style_reference/brand_reference/
  // campaign_reference, all optional — spec section 3), replacing the single
  // `packshotUrl` field from slice 1 (issue #6).
  assets: RunAsset[];
  // Asset analysis LLM stage (issue #6) — see lib/maszynka/assetAnalysis.ts. The
  // operator's chosen OpenRouter model for the stage, and the full per-asset analysis
  // record set, written once when the stage finishes (no revise loop, unlike the Prompt
  // builder — a single failed asset ends the whole run at `asset_analysis_failed`).
  // Each entry is an `AssetAnalysisRecord` (assetId, role, url, request, response,
  // parsed output or errors).
  assetAnalysisModel: string | null;
  assetAnalysisResults: unknown[];
  // FAL request mapper (issue #10) — see lib/maszynka/falMapper.ts. `falRequest` below
  // is now populated by the mapper's exact payload (never a hand-built ad-hoc input, see
  // MaszynkaView's handleRun) rather than slice 1's straight `buildInput` call. Written
  // once when the stage runs (no revise loop — a mapping failure ends the run at
  // `fal_request_mapping_failed`), same shape as `contentSafetyOutput` etc.
  falMappingNotes: string[];
  falRequest: unknown;
  falResponse: unknown;
  outputs: { url: string; width?: number; height?: number }[];
  error: string | null;
  contract: unknown; // Prompt builder Contract snapshot (slice 3) — see lib/maszynka/contract.ts
  // Prompt builder LLM stage (slice 4) — see lib/maszynka/promptBuilder.ts. The operator's
  // chosen OpenRouter model, the raw request/response sent/received, and the parsed +
  // schema-validated structured output (finalPrompt/negativePrompt/promptSummary/
  // appliedRules/riskNotes) that then drives FAL generation. These three columns always
  // reflect the *latest* builder attempt (attempt 2's data if a revise loop happened);
  // `promptBuilderAttempts` below is the append-only full history of every attempt.
  promptBuilderModel: string | null;
  promptBuilderRequest: unknown;
  promptBuilderResponse: unknown;
  promptBuilderOutput: unknown;
  // Prompt reviewer LLM stage (slice 5) — see lib/maszynka/promptReviewer.ts. The
  // operator's chosen OpenRouter model for the reviewer stage, and the append-only
  // history of every reviewer call made on this run (max two: the first verdict, and —
  // only if that verdict was `revise` — the verdict on the rebuilt attempt). Each entry
  // is a `PromptReviewerAttemptRecord` (attempt number, request, response, parsed
  // output or errors).
  promptReviewerModel: string | null;
  promptReviewerAttempts: unknown[];
  // Append-only history of every Prompt builder call made on this run (max two — see
  // promptReviewerAttempts above). Each entry is a `PromptBuilderAttemptRecord`.
  promptBuilderAttempts: unknown[];
  // Manual scoring (issue #11) — see lib/maszynka/scoring.ts. Keyed by generated asset
  // URL (`outputs[].url`), never a single scalar, so every asset can be scored
  // independently and re-scored later without touching any other asset's verdict. The
  // vocabularies (decision/blockerIssues/nextActions) are hardcoded in scoring.ts, not a
  // config kind (explicit PRD decision). Written incrementally, one asset at a time, as
  // the operator scores each result — unlike assetAnalysisResults above, this is a merge
  // (upsert one key) rather than a full replace; see the PATCH route.
  manualScores: ScoresByAsset;
}

interface RunRow {
  id: string;
  created_at: string;
  updated_at: string;
  asset_type: string;
  status: string;
  status_history: MaszynkaStatusEvent[];
  user_prompt_raw: string;
  prompt_improvement_used: boolean;
  prompt_improvement_accepted: boolean;
  user_prompt_improved: string | null;
  model_key: string;
  model_id: string;
  model_label: string;
  recommended_model: string | null;
  operator_selected_model: string | null;
  model_override_used: boolean;
  model_recommendation_reason: string | null;
  content_safety_model: string | null;
  content_safety_request: unknown;
  content_safety_response: unknown;
  content_safety_output: unknown;
  assets: RunAsset[];
  asset_analysis_model: string | null;
  asset_analysis_results: unknown[];
  fal_mapping_notes: string[];
  fal_request: unknown;
  fal_response: unknown;
  outputs: MaszynkaRun["outputs"];
  error: string | null;
  contract: unknown;
  prompt_builder_model: string | null;
  prompt_builder_request: unknown;
  prompt_builder_response: unknown;
  prompt_builder_output: unknown;
  prompt_reviewer_model: string | null;
  prompt_reviewer_attempts: unknown[];
  prompt_builder_attempts: unknown[];
  manual_scores: ScoresByAsset;
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
    promptImprovementUsed: row.prompt_improvement_used ?? false,
    promptImprovementAccepted: row.prompt_improvement_accepted ?? false,
    userPromptImproved: row.user_prompt_improved ?? null,
    modelKey: row.model_key,
    modelId: row.model_id,
    modelLabel: row.model_label,
    recommendedModel: row.recommended_model ?? null,
    operatorSelectedModel: row.operator_selected_model ?? null,
    modelOverrideUsed: row.model_override_used ?? false,
    modelRecommendationReason: row.model_recommendation_reason ?? null,
    contentSafetyModel: row.content_safety_model ?? null,
    contentSafetyRequest: row.content_safety_request ?? null,
    contentSafetyResponse: row.content_safety_response ?? null,
    contentSafetyOutput: row.content_safety_output ?? null,
    assets: row.assets ?? [],
    assetAnalysisModel: row.asset_analysis_model ?? null,
    assetAnalysisResults: row.asset_analysis_results ?? [],
    falMappingNotes: row.fal_mapping_notes ?? [],
    falRequest: row.fal_request ?? null,
    falResponse: row.fal_response ?? null,
    outputs: row.outputs ?? [],
    error: row.error,
    contract: row.contract ?? null,
    promptBuilderModel: row.prompt_builder_model ?? null,
    promptBuilderRequest: row.prompt_builder_request ?? null,
    promptBuilderResponse: row.prompt_builder_response ?? null,
    promptBuilderOutput: row.prompt_builder_output ?? null,
    promptReviewerModel: row.prompt_reviewer_model ?? null,
    promptReviewerAttempts: row.prompt_reviewer_attempts ?? [],
    promptBuilderAttempts: row.prompt_builder_attempts ?? [],
    manualScores: row.manual_scores ?? {},
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
    // Slice 5 adds the Prompt reviewer stage + revise loop — same idempotent-column
    // story. The two `_attempts` columns are append-only arrays (same pattern as
    // status_history above) so both Prompt builder attempts and every reviewer call
    // survive the revise loop instead of being overwritten by the second attempt.
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_reviewer_model text`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_reviewer_attempts jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_builder_attempts jsonb NOT NULL DEFAULT '[]'::jsonb`;
    // Issue #6 replaces the single `packshot_url` field with four role-specific upload
    // fields + the Asset analysis stage — same idempotent-column story. `packshot_url`
    // itself is left in place (harmless, unread from here on) rather than dropped —
    // this repo has no DROP COLUMN precedent and dropping it buys nothing for a test
    // bench with no production data to protect.
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS assets jsonb NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS asset_analysis_model text`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS asset_analysis_results jsonb NOT NULL DEFAULT '[]'::jsonb`;
    // Issue #7 adds the Content safety pre-check stage — same idempotent-column story.
    // Single call per run (no attempts array) — see the MaszynkaRun field doc comments.
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS content_safety_model text`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS content_safety_request jsonb`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS content_safety_response jsonb`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS content_safety_output jsonb`;
    // Issue #8 adds the Prompt improvement stage's three tracking fields — same
    // idempotent-column story. Written once at INSERT time (see the POST route), never
    // patched — this stage has no run status of its own (see the MaszynkaRun field doc
    // comment above and lib/maszynka/promptImprovement.ts module header).
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_improvement_used boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS prompt_improvement_accepted boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS user_prompt_improved text`;
    // Issue #9 adds Model recommendation's four tracking fields (PRD section 12) — same
    // idempotent-column story. Written once at INSERT time (see the POST route), never
    // patched — the recommendation is computed client-side before the run exists (same
    // shape as the Prompt improvement fields above), and the operator's actual model
    // choice never changes after creation either.
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS recommended_model text`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS operator_selected_model text`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS model_override_used boolean NOT NULL DEFAULT false`;
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS model_recommendation_reason text`;
    // Issue #10 adds the FAL request mapper's mappingNotes — same idempotent-column
    // story. Written once per run (no revise loop for this stage), same pattern as
    // content_safety_output above.
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS fal_mapping_notes jsonb NOT NULL DEFAULT '[]'::jsonb`;
    // Issue #11 adds Manual scoring — same idempotent-column story. A jsonb map keyed by
    // generated asset URL (see lib/maszynka/scoring.ts), not a scalar, so each asset's
    // score is merged (upserted) independently rather than the whole column being
    // replaced on every scoring call.
    await sql`ALTER TABLE maszynka_runs ADD COLUMN IF NOT EXISTS manual_scores jsonb NOT NULL DEFAULT '{}'::jsonb`;
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
