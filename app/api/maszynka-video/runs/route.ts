import { ensureVideoSchema, getSql, rowToVideoRun, type VideoRunRow } from "@/lib/maszynka-video/store";

export const runtime = "nodejs";

interface CreateVideoRunBody {
  name?: string;
  globalRules?: string;
  priorityLogic?: string;
}

export async function POST(req: Request) {
  let body: CreateVideoRunBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka Video runs require Neon (see .env.local)." },
      { status: 503 },
    );
  }

  try {
    await ensureVideoSchema(sql);
    const id = crypto.randomUUID();
    const rows = await sql`
      INSERT INTO maszynka_video_runs (id, name, global_rules, priority_logic)
      VALUES (${id}, ${name}, ${body.globalRules ?? ""}, ${body.priorityLogic ?? ""})
      RETURNING *
    `;
    return Response.json(rowToVideoRun(rows[0] as VideoRunRow), { status: 201 });
  } catch (e) {
    console.error("[maszynka-video] create run failed:", e);
    return Response.json({ error: "Failed to create Video run" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka Video runs require Neon (see .env.local)." },
      { status: 503 },
    );
  }
  const url = new URL(req.url);
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

  try {
    await ensureVideoSchema(sql);
    const rows = await sql`
      SELECT * FROM maszynka_video_runs ORDER BY created_at DESC LIMIT ${limit}
    `;
    return Response.json({ runs: rows.map((r) => rowToVideoRun(r as VideoRunRow)) });
  } catch (e) {
    console.error("[maszynka-video] list runs failed:", e);
    return Response.json({ error: "Failed to list Video runs" }, { status: 500 });
  }
}
