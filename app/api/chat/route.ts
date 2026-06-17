// Thin proxy to OpenRouter chat completions. Reads the user's BYOK key from the
// x-openrouter-key request header (NEVER from process.env), forwards the verbatim
// body to OpenRouter with attribution headers, and pipes the SSE response body
// straight back to the client (pass-through, no re-buffering). All chat logic
// lives client-side; this route only injects the Authorization header.

export const runtime = "nodejs";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req: Request) {
  const key = req.headers.get("x-openrouter-key")?.trim();
  if (!key) {
    return Response.json(
      { error: { message: "Missing OpenRouter key." } },
      { status: 401 },
    );
  }

  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // OpenRouter attribution headers (shown on their activity dashboard).
        "HTTP-Referer": req.headers.get("origin") ?? "http://localhost:3000",
        "X-Title": "Fal Prompt Playground - Chat",
      },
      body,
    });
  } catch (e) {
    return Response.json(
      { error: { message: e instanceof Error ? e.message : "Upstream request failed." } },
      { status: 502 },
    );
  }

  // On error, forward OpenRouter's JSON (status + message) so the client can show it.
  if (!upstream.ok) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "application/json" },
    });
  }

  // Stream OK: pass the body straight through with SSE headers.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
