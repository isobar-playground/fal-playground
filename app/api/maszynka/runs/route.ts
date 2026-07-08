import { ASSET_ROLES } from "@/lib/maszynka/contract";
import { ensureSchema, getSql, rowToRun, type MaszynkaStatusEvent, type RunAsset } from "@/lib/maszynka/store";

export const runtime = "nodejs";

interface CreateRunBody {
  assetType?: "image" | "video";
  userPromptRaw?: string;
  /** Prompt improvement (issue #8) — recorded once at creation, never patched (the
   *  stage runs client-side before the run exists; see
   *  lib/maszynka/promptImprovement.ts). */
  promptImprovementUsed?: boolean;
  promptImprovementAccepted?: boolean;
  userPromptImproved?: string | null;
  modelKey?: string;
  modelId?: string;
  modelLabel?: string;
  /** Model recommendation (issue #9) — recorded once at creation, never patched; the
   *  recommendation is computed client-side (see lib/maszynka/recommend.ts) before the
   *  run exists. Image runs only — video runs simply omit all four fields (null). */
  recommendedModel?: string | null;
  operatorSelectedModel?: string | null;
  modelOverrideUsed?: boolean;
  modelRecommendationReason?: string | null;
  /** Every uploaded asset (any/all of the four roles — issue #6, replaces slice 1's
   *  single `packshotUrl`). */
  assets?: RunAsset[];
  contentSafetyModel?: string | null;
  assetAnalysisModel?: string | null;
  promptBuilderModel?: string | null;
  promptReviewerModel?: string | null;
}

export async function POST(req: Request) {
  let body: CreateRunBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userPromptRaw = body.userPromptRaw?.trim();
  if (!userPromptRaw) return Response.json({ error: "userPromptRaw is required" }, { status: 400 });
  if (!body.modelKey || !body.modelId || !body.modelLabel) {
    return Response.json({ error: "modelKey, modelId and modelLabel are required" }, { status: 400 });
  }
  const assets = Array.isArray(body.assets) ? body.assets : [];
  for (const asset of assets) {
    if (!asset || typeof asset.id !== "string" || typeof asset.url !== "string" || !ASSET_ROLES.includes(asset.role)) {
      return Response.json({ error: "each asset must have an id, a url and a valid role" }, { status: 400 });
    }
  }
  // Prompt improvement (issue #8): an accepted improvement must actually carry the
  // accepted text — a bug in the client pipeline should fail loudly here rather than
  // silently writing a run that claims acceptance with nothing to show for it.
  const promptImprovementAccepted = body.promptImprovementAccepted === true;
  if (promptImprovementAccepted && !body.userPromptImproved?.trim()) {
    return Response.json(
      { error: "userPromptImproved is required when promptImprovementAccepted is true" },
      { status: 400 },
    );
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
    const id = crypto.randomUUID();
    const firstEvent: MaszynkaStatusEvent = { status: "run_started", at: new Date().toISOString() };
    const rows = await sql`
      INSERT INTO maszynka_runs (
        id, asset_type, status, status_history, user_prompt_raw, prompt_improvement_used, prompt_improvement_accepted, user_prompt_improved, model_key, model_id, model_label, recommended_model, operator_selected_model, model_override_used, model_recommendation_reason, assets, content_safety_model, asset_analysis_model, prompt_builder_model, prompt_reviewer_model
      ) VALUES (
        ${id},
        ${body.assetType === "video" ? "video" : "image"},
        'run_started',
        ${JSON.stringify([firstEvent])}::jsonb,
        ${userPromptRaw},
        ${body.promptImprovementUsed === true},
        ${promptImprovementAccepted},
        ${promptImprovementAccepted ? body.userPromptImproved!.trim() : null},
        ${body.modelKey},
        ${body.modelId},
        ${body.modelLabel},
        ${body.recommendedModel ?? null},
        ${body.operatorSelectedModel ?? null},
        ${body.modelOverrideUsed === true},
        ${body.modelRecommendationReason ?? null},
        ${JSON.stringify(assets)}::jsonb,
        ${body.contentSafetyModel ?? null},
        ${body.assetAnalysisModel ?? null},
        ${body.promptBuilderModel ?? null},
        ${body.promptReviewerModel ?? null}
      )
      RETURNING *
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Response.json(rowToRun(rows[0] as any), { status: 201 });
  } catch (e) {
    console.error("[maszynka] create run failed:", e);
    return Response.json({ error: "Failed to create run" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka runs require Neon (see .env.local)." },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

  try {
    await ensureSchema(sql);
    const rows = await sql`
      SELECT * FROM maszynka_runs ORDER BY created_at DESC LIMIT ${limit}
    `;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Response.json({ runs: rows.map((r) => rowToRun(r as any)) });
  } catch (e) {
    console.error("[maszynka] list runs failed:", e);
    return Response.json({ error: "Failed to list runs" }, { status: 500 });
  }
}
