// Local-dev convenience: exposes FAL_KEY from the environment so you don't have to
// paste it every time. Returns null in production so a deployed build never leaks a key.

export const runtime = "nodejs";

export function GET() {
  const key = process.env.NODE_ENV !== "production" ? (process.env.FAL_KEY ?? null) : null;
  return Response.json({ key });
}
