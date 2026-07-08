"use client";

// Thin fetch wrappers around app/api/maszynka/runs — the only way the browser talks to
// the Neon-backed run store (ADR 0001: runs are server-side, not localStorage).
import type { RunStatus } from "./status";
import type { MaszynkaRun } from "./store";

export type { MaszynkaRun } from "./store";

async function asJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function apiError(data: unknown, fallback: string): string {
  return data && typeof data === "object" && "error" in data && typeof (data as { error?: unknown }).error === "string"
    ? (data as { error: string }).error
    : fallback;
}

export async function createRun(input: {
  assetType?: "image" | "video";
  userPromptRaw: string;
  modelKey: string;
  modelId: string;
  modelLabel: string;
  packshotUrl?: string;
  /** The operator's chosen OpenRouter model for the Prompt builder stage — recorded on
   *  the run at creation since it's picked in the same Run form (see promptBuilder.ts). */
  promptBuilderModel?: string;
}): Promise<MaszynkaRun> {
  const res = await fetch("/api/maszynka/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to create run"));
  return data as MaszynkaRun;
}

export async function patchRun(
  id: string,
  patch: {
    status: RunStatus;
    detail?: string;
    falRequest?: unknown;
    falResponse?: unknown;
    outputs?: { url: string; width?: number; height?: number }[];
    error?: string;
    contract?: unknown;
    promptBuilderRequest?: unknown;
    promptBuilderResponse?: unknown;
    promptBuilderOutput?: unknown;
  },
): Promise<MaszynkaRun> {
  const res = await fetch(`/api/maszynka/runs/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to update run"));
  return data as MaszynkaRun;
}

export async function listRuns(limit = 50): Promise<MaszynkaRun[]> {
  const res = await fetch(`/api/maszynka/runs?limit=${limit}`);
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to list runs"));
  return (data as { runs: MaszynkaRun[] }).runs;
}

export async function getRun(id: string): Promise<MaszynkaRun> {
  const res = await fetch(`/api/maszynka/runs/${id}`);
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to load run"));
  return data as MaszynkaRun;
}
