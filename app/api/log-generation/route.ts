export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  console.log("[fal-generation]", JSON.stringify(body));

  return new Response(null, { status: 204 });
}
