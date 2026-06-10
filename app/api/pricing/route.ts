// Thin proxy to Fal's pricing endpoint. Keeps the user's key out of the URL and
// avoids browser CORS (the key arrives per-request in a header, never stored server-side).
// GET https://api.fal.ai/v1/models/pricing?endpoint_id=a,b,c

export const runtime = "nodejs";

export async function POST(req: Request) {
  const key = req.headers.get("x-fal-key");
  if (!key) return Response.json({ error: "Missing Fal key" }, { status: 400 });

  let endpointIds: unknown;
  try {
    ({ endpointIds } = await req.json());
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!Array.isArray(endpointIds) || endpointIds.length === 0) {
    return Response.json({ prices: [] });
  }

  const ids = [...new Set(endpointIds.filter((x): x is string => typeof x === "string"))].slice(0, 50);
  const url = `https://api.fal.ai/v1/models/pricing?endpoint_id=${encodeURIComponent(ids.join(","))}`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Key ${key}` } });
    const text = await res.text();
    if (!res.ok) {
      return Response.json({ error: `Fal pricing ${res.status}: ${text.slice(0, 300)}` }, { status: res.status });
    }
    const data = JSON.parse(text);
    return Response.json({ prices: data.prices ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Pricing request failed" }, { status: 502 });
  }
}
