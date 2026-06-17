// Local-dev convenience: exposes FAL_KEY / OPENROUTER_API_KEY from the environment so
// you don't have to paste them every time. Returns null in production so a deployed
// build never leaks a key.

export const runtime = "nodejs";

export function GET() {
  const dev = process.env.NODE_ENV !== "production";
  return Response.json({
    key: dev ? (process.env.FAL_KEY ?? null) : null,
    openrouterKey: dev ? (process.env.OPENROUTER_API_KEY ?? null) : null,
  });
}
