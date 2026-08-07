import { ensureVideoSchema, getSql, rowToVideoRun, type VideoRunRow } from "@/lib/maszynka-video/store";

export const runtime = "nodejs";

interface PatchVideoRunBody {
  name?: string;
  globalRules?: string;
  priorityLogic?: string;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka Video runs require Neon (see .env.local)." },
      { status: 503 },
    );
  }
  try {
    await ensureVideoSchema(sql);
    const rows = await sql`SELECT * FROM maszynka_video_runs WHERE id = ${id}`;
    if (rows.length === 0) return Response.json({ error: "Video run not found" }, { status: 404 });
    return Response.json(rowToVideoRun(rows[0] as VideoRunRow));
  } catch (e) {
    console.error("[maszynka-video] get run failed:", e);
    return Response.json({ error: "Failed to load Video run" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: PatchVideoRunBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  // A provided name must stay non-empty (it's the handle in the shared history);
  // the paste fields may be blanked — "" passes COALESCE untouched since it's not NULL.
  if (body.name !== undefined && !body.name.trim()) {
    return Response.json({ error: "name cannot be blank" }, { status: 400 });
  }

  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka Video runs require Neon (see .env.local)." },
      { status: 503 },
    );
  }

  try {
    await ensureVideoSchema(sql);
    const rows = await sql`
      UPDATE maszynka_video_runs SET
        name = COALESCE(${body.name?.trim() ?? null}, name),
        global_rules = COALESCE(${body.globalRules ?? null}, global_rules),
        priority_logic = COALESCE(${body.priorityLogic ?? null}, priority_logic),
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    if (rows.length === 0) return Response.json({ error: "Video run not found" }, { status: 404 });
    return Response.json(rowToVideoRun(rows[0] as VideoRunRow));
  } catch (e) {
    console.error("[maszynka-video] update run failed:", e);
    return Response.json({ error: "Failed to update Video run" }, { status: 500 });
  }
}
