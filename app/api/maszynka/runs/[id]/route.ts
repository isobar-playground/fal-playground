import { assertValidTransition, type RunStatus } from "@/lib/maszynka/status";
import { ensureSchema, getSql, rowToRun, type MaszynkaStatusEvent } from "@/lib/maszynka/store";
import { isRunFullyScored, validateAssetScoreInput, type AssetScore, type ScoresByAsset } from "@/lib/maszynka/scoring";

export const runtime = "nodejs";

interface PatchRunAssetScoreBody {
  assetUrl?: unknown;
  decision?: unknown;
  blockerIssues?: unknown;
  comment?: unknown;
  nextActions?: unknown;
}

interface PatchRunBody {
  // Optional as of issue #11: a scoring-only PATCH (see `assetScore` below) never
  // changes the run's status by itself — most scoring calls carry no `status` field at
  // all (see lib/maszynka/status.ts's ALLOWED_NEXT comment for `generation_completed`).
  status?: RunStatus;
  detail?: string;
  /** Manual scoring (issue #11) — one asset's verdict, upserted (merged) into
   *  `manual_scores` keyed by `assetUrl`, never replacing the whole map. Re-sending the
   *  same `assetUrl` re-scores it, overwriting only that entry (see
   *  lib/maszynka/scoring.ts). Requires the run to already be at `generation_completed`
   *  or `manual_scoring_completed` — a run that never generated anything has nothing to
   *  score, and a `run_completed` run is closed. */
  assetScore?: PatchRunAssetScoreBody;
  /** The Content safety pre-check stage's request/response/parsed-output (issue #7) —
   *  full replace (not append), same as promptBuilderRequest/Response/Output below,
   *  since this stage makes exactly one call per run (see contentSafety.ts). */
  contentSafetyRequest?: unknown;
  contentSafetyResponse?: unknown;
  contentSafetyOutput?: unknown;
  /** The FAL request mapper's mappingNotes (issue #10) — full replace, single call per
   *  run (no revise loop), see lib/maszynka/falMapper.ts. */
  falMappingNotes?: unknown;
  falRequest?: unknown;
  falResponse?: unknown;
  outputs?: { url: string; width?: number; height?: number }[];
  error?: string;
  contract?: unknown;
  promptBuilderRequest?: unknown;
  promptBuilderResponse?: unknown;
  promptBuilderOutput?: unknown;
  /** One Prompt builder attempt record — appended to `prompt_builder_attempts`, never
   *  replacing the array (see lib/maszynka/store.ts / promptBuilder.ts). */
  promptBuilderAttempt?: unknown;
  /** One Prompt reviewer attempt record — appended to `prompt_reviewer_attempts`, never
   *  replacing the array (see lib/maszynka/store.ts / promptReviewer.ts). */
  promptReviewerAttempt?: unknown;
  /** The Asset analysis stage's full per-asset record set (issue #6) — written once, in
   *  full, when the stage finishes; replaces (never appends to) `asset_analysis_results`
   *  since there is no revise loop for this stage (see lib/maszynka/assetAnalysis.ts). */
  assetAnalysisResults?: unknown;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka runs require Neon (see .env.local)." },
      { status: 503 },
    );
  }
  try {
    await ensureSchema(sql);
    const rows = await sql`SELECT * FROM maszynka_runs WHERE id = ${id}`;
    if (rows.length === 0) return Response.json({ error: "Run not found" }, { status: 404 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Response.json(rowToRun(rows[0] as any));
  } catch (e) {
    console.error("[maszynka] get run failed:", e);
    return Response.json({ error: "Failed to load run" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: PatchRunBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.status && body.assetScore === undefined) {
    return Response.json({ error: "status or assetScore is required" }, { status: 400 });
  }

  let scoreRecord: AssetScore | null = null;
  if (body.assetScore !== undefined) {
    const errors = validateAssetScoreInput(body.assetScore);
    if (errors.length) return Response.json({ error: errors.join(" ") }, { status: 400 });
    scoreRecord = {
      assetUrl: body.assetScore.assetUrl as string,
      decision: body.assetScore.decision as AssetScore["decision"],
      blockerIssues: (body.assetScore.blockerIssues as AssetScore["blockerIssues"] | undefined) ?? [],
      comment: typeof body.assetScore.comment === "string" ? body.assetScore.comment : "",
      nextActions: (body.assetScore.nextActions as AssetScore["nextActions"] | undefined) ?? [],
      scoredAt: new Date().toISOString(),
    };
  }

  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka runs require Neon (see .env.local)." },
      { status: 503 },
    );
  }

  try {
    await ensureSchema(sql);
    const existingRows = await sql`SELECT status, outputs, manual_scores FROM maszynka_runs WHERE id = ${id}`;
    if (existingRows.length === 0) return Response.json({ error: "Run not found" }, { status: 404 });
    const currentStatus = existingRows[0].status as RunStatus;
    const currentOutputs = (existingRows[0].outputs as { url: string }[] | null) ?? [];
    const currentManualScores = (existingRows[0].manual_scores as ScoresByAsset | null) ?? {};

    if (scoreRecord) {
      // A run can only be scored once it has something generated, and no longer once
      // it's closed — see the `assetScore` field's doc comment above.
      if (currentStatus !== "generation_completed" && currentStatus !== "manual_scoring_completed") {
        return Response.json(
          { error: `Cannot score an asset while the run is at status "${currentStatus}".` },
          { status: 409 },
        );
      }
      if (!currentOutputs.some((o) => o.url === scoreRecord!.assetUrl)) {
        return Response.json(
          { error: "assetScore.assetUrl does not match any asset this run generated." },
          { status: 400 },
        );
      }
    }
    // Merge (not replace) so the completeness check below and the SQL write both see
    // this request's score alongside every previously stored one.
    const mergedManualScores: ScoresByAsset = scoreRecord
      ? { ...currentManualScores, [scoreRecord.assetUrl]: scoreRecord }
      : currentManualScores;

    if (body.status) {
      try {
        assertValidTransition(currentStatus, body.status);
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : "Invalid transition" }, { status: 409 });
      }
      // Issue #11: `manual_scoring_completed` requires every generated asset to already
      // have a score — this is the "per-asset scoring completeness" invariant (see
      // lib/maszynka/scoring.ts's isRunFullyScored, also enforced client-side so the UI
      // only offers this transition once it's true).
      if (body.status === "manual_scoring_completed" && !isRunFullyScored(currentOutputs, mergedManualScores)) {
        return Response.json(
          { error: "Every generated asset must be scored before the run can reach manual_scoring_completed." },
          { status: 409 },
        );
      }
    }

    const nextStatus = body.status ?? currentStatus;
    const eventJson = body.status
      ? JSON.stringify([
          { status: body.status, at: new Date().toISOString(), ...(body.detail ? { detail: body.detail } : {}) } satisfies MaszynkaStatusEvent,
        ])
      : null;
    const manualScoresJson = scoreRecord ? JSON.stringify({ [scoreRecord.assetUrl]: scoreRecord }) : null;
    const contentSafetyRequestJson = body.contentSafetyRequest !== undefined ? JSON.stringify(body.contentSafetyRequest) : null;
    const contentSafetyResponseJson = body.contentSafetyResponse !== undefined ? JSON.stringify(body.contentSafetyResponse) : null;
    const contentSafetyOutputJson = body.contentSafetyOutput !== undefined ? JSON.stringify(body.contentSafetyOutput) : null;
    const falMappingNotesJson = body.falMappingNotes !== undefined ? JSON.stringify(body.falMappingNotes) : null;
    const falRequestJson = body.falRequest !== undefined ? JSON.stringify(body.falRequest) : null;
    const falResponseJson = body.falResponse !== undefined ? JSON.stringify(body.falResponse) : null;
    const outputsJson = body.outputs !== undefined ? JSON.stringify(body.outputs) : null;
    const contractJson = body.contract !== undefined ? JSON.stringify(body.contract) : null;
    const promptBuilderRequestJson = body.promptBuilderRequest !== undefined ? JSON.stringify(body.promptBuilderRequest) : null;
    const promptBuilderResponseJson = body.promptBuilderResponse !== undefined ? JSON.stringify(body.promptBuilderResponse) : null;
    const promptBuilderOutputJson = body.promptBuilderOutput !== undefined ? JSON.stringify(body.promptBuilderOutput) : null;
    // Attempt records are appended (never replace the array) — same pattern as
    // status_history — so both Prompt builder attempts and every Prompt reviewer call
    // survive the revise loop (see lib/maszynka/store.ts).
    const promptBuilderAttemptJson =
      body.promptBuilderAttempt !== undefined ? JSON.stringify([body.promptBuilderAttempt]) : null;
    const promptReviewerAttemptJson =
      body.promptReviewerAttempt !== undefined ? JSON.stringify([body.promptReviewerAttempt]) : null;
    // Full replace (not append) — see the field's doc comment above.
    const assetAnalysisResultsJson =
      body.assetAnalysisResults !== undefined ? JSON.stringify(body.assetAnalysisResults) : null;

    const rows = await sql`
      UPDATE maszynka_runs SET
        status = ${nextStatus},
        status_history = CASE WHEN ${eventJson}::jsonb IS NOT NULL
          THEN status_history || ${eventJson}::jsonb ELSE status_history END,
        manual_scores = CASE WHEN ${manualScoresJson}::jsonb IS NOT NULL
          THEN manual_scores || ${manualScoresJson}::jsonb ELSE manual_scores END,
        content_safety_request = COALESCE(${contentSafetyRequestJson}::jsonb, content_safety_request),
        content_safety_response = COALESCE(${contentSafetyResponseJson}::jsonb, content_safety_response),
        content_safety_output = COALESCE(${contentSafetyOutputJson}::jsonb, content_safety_output),
        fal_mapping_notes = COALESCE(${falMappingNotesJson}::jsonb, fal_mapping_notes),
        fal_request = COALESCE(${falRequestJson}::jsonb, fal_request),
        fal_response = COALESCE(${falResponseJson}::jsonb, fal_response),
        outputs = COALESCE(${outputsJson}::jsonb, outputs),
        error = COALESCE(${body.error ?? null}, error),
        contract = COALESCE(${contractJson}::jsonb, contract),
        prompt_builder_request = COALESCE(${promptBuilderRequestJson}::jsonb, prompt_builder_request),
        prompt_builder_response = COALESCE(${promptBuilderResponseJson}::jsonb, prompt_builder_response),
        prompt_builder_output = COALESCE(${promptBuilderOutputJson}::jsonb, prompt_builder_output),
        prompt_builder_attempts = CASE WHEN ${promptBuilderAttemptJson}::jsonb IS NOT NULL
          THEN prompt_builder_attempts || ${promptBuilderAttemptJson}::jsonb ELSE prompt_builder_attempts END,
        prompt_reviewer_attempts = CASE WHEN ${promptReviewerAttemptJson}::jsonb IS NOT NULL
          THEN prompt_reviewer_attempts || ${promptReviewerAttemptJson}::jsonb ELSE prompt_reviewer_attempts END,
        asset_analysis_results = COALESCE(${assetAnalysisResultsJson}::jsonb, asset_analysis_results),
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Response.json(rowToRun(rows[0] as any));
  } catch (e) {
    console.error("[maszynka] update run failed:", e);
    return Response.json({ error: "Failed to update run" }, { status: 500 });
  }
}
