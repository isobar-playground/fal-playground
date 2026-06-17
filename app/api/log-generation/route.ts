import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const runtime = "nodejs";

interface GenerationLog {
  kind?: string;
  model?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

// Created on first write so there's no separate migration step. Reset on failure
// so a transient DDL error doesn't permanently wedge every later insert.
let schemaReady: Promise<void> | null = null;
function ensureSchema(sql: NeonQueryFunction<false, false>) {
  schemaReady ??= sql`
    CREATE TABLE IF NOT EXISTS generations (
      id     bigserial   PRIMARY KEY,
      ts     timestamptz NOT NULL DEFAULT now(),
      kind   text        NOT NULL,
      model  text        NOT NULL,
      input  jsonb       NOT NULL,
      output jsonb,
      error  text
    )
  `
    .then(() => undefined)
    .catch((e) => {
      schemaReady = null;
      throw e;
    });
  return schemaReady;
}

export async function POST(req: Request) {
  let body: GenerationLog;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  // No DATABASE_URL (e.g. local dev without `vercel env pull`) → no-op, not an error.
  const url = process.env.DATABASE_URL;
  if (url) {
    try {
      const sql = neon(url);
      await ensureSchema(sql);
      await sql`
        INSERT INTO generations (kind, model, input, output, error)
        VALUES (
          ${body.kind ?? "unknown"},
          ${body.model ?? "unknown"},
          ${JSON.stringify(body.input ?? null)}::jsonb,
          ${body.output === undefined ? null : JSON.stringify(body.output)}::jsonb,
          ${body.error ?? null}
        )
      `;
    } catch (e) {
      // A logging failure must never break a generation.
      console.error("[fal-generation] DB write failed:", e);
    }
  }

  return new Response(null, { status: 204 });
}
