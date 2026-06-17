// Returns the user's OpenRouter balance. Unlike Fal (which needs a server-side
// admin key for billing), an OpenRouter user key can read its own balance, so the
// key comes from the x-openrouter-key request header — NEVER from process.env.
// Response shape mirrors /api/credits so the UI chip is identical.
// GET https://openrouter.ai/api/v1/credits → { data: { total_credits, total_usage } }

export const runtime = "nodejs";

export async function GET(req: Request) {
  const key = req.headers.get("x-openrouter-key")?.trim();
  if (!key) return Response.json({ available: false });

  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return Response.json({ available: false, error: `OpenRouter credits ${res.status}` });
    }
    const data = await res.json();
    const d = data?.data;
    if (!d || typeof d.total_credits !== "number") return Response.json({ available: false });
    const total = d.total_credits;
    const used = typeof d.total_usage === "number" ? d.total_usage : 0;
    return Response.json({
      available: true,
      balance: total - used,
      used,
      total,
      currency: "USD",
    });
  } catch (e) {
    return Response.json({ available: false, error: e instanceof Error ? e.message : "request failed" });
  }
}
