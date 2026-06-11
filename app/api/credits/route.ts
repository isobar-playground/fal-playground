// Returns the Fal account credit balance using the server-side FAL_ADMIN_KEY.
// The normal (per-user) key can't read billing (403), so this needs an admin key.
// The admin key never leaves the server — only the resulting balance is returned.
// GET https://api.fal.ai/v1/account/billing?expand=credits

export const runtime = "nodejs";

export async function GET() {
  const key = process.env.FAL_ADMIN_KEY;
  if (!key) return Response.json({ available: false });

  try {
    const res = await fetch("https://api.fal.ai/v1/account/billing?expand=credits", {
      headers: { Authorization: `Key ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return Response.json({ available: false, error: `Fal billing ${res.status}` });
    }
    const data = await res.json();
    const c = data?.credits;
    if (!c || typeof c.current_balance !== "number") return Response.json({ available: false });
    return Response.json({ available: true, balance: c.current_balance, currency: c.currency ?? "USD" });
  } catch (e) {
    return Response.json({ available: false, error: e instanceof Error ? e.message : "request failed" });
  }
}
