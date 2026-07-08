import { isConfigKind, validateConfigBody } from "@/lib/maszynka/configSchemas";
import {
  ConfigVersionConflictError,
  ensureReady,
  getSql,
  insertConfigVersion,
  listConfigVersions,
} from "@/lib/maszynka/configStore";

export const runtime = "nodejs";

interface SaveConfigBody {
  body?: unknown;
}

// Full version history for one kind, oldest first — GET /api/maszynka/configs/hooks
// returns every version (the last element is the latest), so "view versions" and
// "read the latest" are the same call.
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isConfigKind(kind)) return Response.json({ error: `Unknown config kind "${kind}"` }, { status: 404 });

  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka configs require Neon (see .env.local)." },
      { status: 503 },
    );
  }

  try {
    await ensureReady(sql);
    const versions = await listConfigVersions(sql, kind);
    return Response.json({ kind, versions });
  } catch (e) {
    console.error(`[maszynka] list config versions failed (${kind}):`, e);
    return Response.json({ error: "Failed to load config versions" }, { status: 500 });
  }
}

// Save-as-new-version: validates the JSON body against the kind's shape before ever
// touching Neon (append-only — a rejected save must never create a version).
export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isConfigKind(kind)) return Response.json({ error: `Unknown config kind "${kind}"` }, { status: 404 });

  let payload: SaveConfigBody;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (payload.body === undefined) return Response.json({ error: "body is required" }, { status: 400 });

  const errors = validateConfigBody(kind, payload.body);
  if (errors.length) return Response.json({ error: "Config failed validation", errors }, { status: 422 });

  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka configs require Neon (see .env.local)." },
      { status: 503 },
    );
  }

  try {
    await ensureReady(sql);
    const version = await insertConfigVersion(sql, kind, payload.body);
    return Response.json(version, { status: 201 });
  } catch (e) {
    if (e instanceof ConfigVersionConflictError) {
      return Response.json({ error: e.message }, { status: 409 });
    }
    console.error(`[maszynka] save config failed (${kind}):`, e);
    return Response.json({ error: "Failed to save config" }, { status: 500 });
  }
}
