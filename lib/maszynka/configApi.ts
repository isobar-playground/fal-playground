"use client";

// Thin fetch wrappers around app/api/maszynka/configs — the only way the browser talks
// to the Neon-backed config store (ADR 0001). Mirrors lib/maszynka/api.ts.
import type { ConfigKind } from "./configSchemas";
import type { MaszynkaConfigVersion } from "./configStore";

export type { MaszynkaConfigVersion } from "./configStore";
export type { ConfigKind } from "./configSchemas";

async function asJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function apiError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "errors" in data && Array.isArray((data as { errors?: unknown }).errors)) {
    return (data as { errors: string[] }).errors.join("; ");
  }
  return data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : fallback;
}

export async function listLatestConfigs(): Promise<MaszynkaConfigVersion[]> {
  const res = await fetch("/api/maszynka/configs");
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to list configs"));
  return (data as { configs: MaszynkaConfigVersion[] }).configs;
}

export async function listConfigVersions(kind: ConfigKind): Promise<MaszynkaConfigVersion[]> {
  const res = await fetch(`/api/maszynka/configs/${kind}`);
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to load config versions"));
  return (data as { versions: MaszynkaConfigVersion[] }).versions;
}

export async function saveConfigVersion(kind: ConfigKind, body: unknown): Promise<MaszynkaConfigVersion> {
  const res = await fetch(`/api/maszynka/configs/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body }),
  });
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to save config"));
  return data as MaszynkaConfigVersion;
}
