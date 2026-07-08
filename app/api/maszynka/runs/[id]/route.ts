import { assertValidTransition, type RunStatus } from "@/lib/maszynka/status";
import { ensureSchema, getSql, rowToRun, type MaszynkaStatusEvent } from "@/lib/maszynka/store";

export const runtime = "nodejs";

interface PatchRunBody {
  status?: RunStatus;
  detail?: string;
  falRequest?: unknown;
  falResponse?: unknown;
  outputs?: { url: string; width?: number; height?: number }[];
  error?: string;
  contract?: unknown;
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
    const falRequestJson = body.falRequest !== undefined ? JSON.stringify(body.falRequest) : null;
    const falResponseJson = body.falResponse !== undefined ? JSON.stringify(body.falResponse) : null;
    const outputsJson = body.outputs !== undefined ? JSON.stringify(body.outputs) : null;
    const contractJson = body.contract !== undefined ? JSON.stringify(body.contract) : null;

    const rows = await sql`
      UPDATE maszynka_runs SET
        status = ${body.status},
        status_history = status_history || ${JSON.stringify([event])}::jsonb,
        fal_request = COALESCE(${falRequestJson}::jsonb, fal_request),
        fal_response = COALESCE(${falResponseJson}::jsonb, fal_response),
        outputs = COALESCE(${outputsJson}::jsonb, outputs),
        error = COALESCE(${body.error ?? null}, error),
        contract = COALESCE(${contractJson}::jsonb, contract),
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
