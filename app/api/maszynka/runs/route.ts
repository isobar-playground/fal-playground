import { ensureSchema, getSql, rowToRun, type MaszynkaStatusEvent } from "@/lib/maszynka/store";

export const runtime = "nodejs";

interface CreateRunBody {
  assetType?: "image" | "video";
  userPromptRaw?: string;
  modelKey?: string;
  modelId?: string;
  modelLabel?: string;
  packshotUrl?: string | null;
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
        id, asset_type, status, status_history, user_prompt_raw, model_key, model_id, model_label, packshot_url, prompt_builder_model, prompt_reviewer_model
      ) VALUES (
        ${id},
        ${body.assetType === "video" ? "video" : "image"},
        'run_started',
        ${JSON.stringify([firstEvent])}::jsonb,
        ${userPromptRaw},
        ${body.modelKey},
        ${body.modelId},
        ${body.modelLabel},
        ${body.packshotUrl ?? null},
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
