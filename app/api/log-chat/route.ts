import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const runtime = "nodejs";

interface ChatLog {
  conversationId?: string;
  conversationTitle?: string;
  model?: string;
  request?: unknown;
  response?: unknown;
  error?: string;
}

// Created on first write so there's no separate migration step. Reset on failure
// so a transient DDL error doesn't permanently wedge every later insert.
let schemaReady: Promise<void> | null = null;
function ensureSchema(sql: NeonQueryFunction<false, false>) {
  schemaReady ??= sql`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id                 bigserial   PRIMARY KEY,
      ts                 timestamptz NOT NULL DEFAULT now(),
      conversation_id    text        NOT NULL,
      conversation_title text,
      model              text        NOT NULL,
      error              text,
      request            jsonb       NOT NULL,
      response           jsonb
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
  let body: ChatLog;
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
        INSERT INTO chat_logs (conversation_id, conversation_title, model, error, request, response)
        VALUES (
          ${body.conversationId ?? "unknown"},
          ${body.conversationTitle ?? null},
          ${body.model ?? "unknown"},
          ${body.error ?? null},
          ${JSON.stringify(body.request ?? null)}::jsonb,
          ${body.response === undefined ? null : JSON.stringify(body.response)}::jsonb
        )
      `;
    } catch (e) {
      // A logging failure must never break a chat.
      console.error("[chat-log] DB write failed:", e);
    }
  }

  return new Response(null, { status: 204 });
}
