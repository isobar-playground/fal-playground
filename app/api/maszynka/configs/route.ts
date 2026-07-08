import { ensureReady, getSql, listLatestConfigs } from "@/lib/maszynka/configStore";

export const runtime = "nodejs";

// Overview for the Configs section: latest version of all six kinds in one call. An
// empty database self-seeds here (see ensureSeeded in configStore.ts) so the operator
// never has to run a separate migration/seed step.
export async function GET() {
  const sql = getSql();
  if (!sql) {
    return Response.json(
      { error: "DATABASE_URL not configured — Maszynka configs require Neon (see .env.local)." },
      { status: 503 },
    );
  }

  try {
    await ensureReady(sql);
    const configs = await listLatestConfigs(sql);
    return Response.json({ configs });
  } catch (e) {
    console.error("[maszynka] list configs failed:", e);
    return Response.json({ error: "Failed to list configs" }, { status: 500 });
  }
}
