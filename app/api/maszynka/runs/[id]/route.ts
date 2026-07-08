import { assertValidTransition, type RunStatus } from "@/lib/maszynka/status";
import { ensureSchema, getSql, rowToRun, type MaszynkaStatusEvent } from "@/lib/maszynka/store";

export const runtime = "nodejs";

interface PatchRunBody {
  status?: RunStatus;
  detail?: string;
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
  if (!body.status) return Response.json({ error: "status is required" }, { status: 400 });

  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka runs require Neon (see .env.local)." },
      { status: 503 },
    );
  }

  try {
    await ensureSchema(sql);
    const existingRows = await sql`SELECT status FROM maszynka_runs WHERE id = ${id}`;
    if (existingRows.length === 0) return Response.json({ error: "Run not found" }, { status: 404 });
    const currentStatus = existingRows[0].status as RunStatus;

    try {
      assertValidTransition(currentStatus, body.status);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Invalid transition" }, { status: 409 });
    }

    const event: MaszynkaStatusEvent = {
      status: body.status,
      at: new Date().toISOString(),
      ...(body.detail ? { detail: body.detail } : {}),
    };
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
        status = ${body.status},
        status_history = status_history || ${JSON.stringify([event])}::jsonb,
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
