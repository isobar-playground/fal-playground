"use client";

// Thin fetch wrappers around app/api/maszynka-video/runs — the only way the browser
// talks to the Neon-backed Video run store (ADR 0001 rationale; PRD 0003).
import type { VideoRun } from "./runMapping";

export type { VideoRun } from "./runMapping";

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

export interface VideoRunPatch {
  name?: string;
  globalRules?: string;
  priorityLogic?: string;
}

export async function createVideoRun(input: {
  name: string;
  globalRules?: string;
  priorityLogic?: string;
}): Promise<VideoRun> {
  const res = await fetch("/api/maszynka-video/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to create Video run"));
  return data as VideoRun;
}

export async function patchVideoRun(id: string, patch: VideoRunPatch): Promise<VideoRun> {
  const res = await fetch(`/api/maszynka-video/runs/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to update Video run"));
  return data as VideoRun;
}

export async function listVideoRuns(limit = 50): Promise<VideoRun[]> {
  const res = await fetch(`/api/maszynka-video/runs?limit=${limit}`);
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to list Video runs"));
  return (data as { runs: VideoRun[] }).runs;
}

export async function getVideoRun(id: string): Promise<VideoRun> {
  const res = await fetch(`/api/maszynka-video/runs/${id}`);
  const data = await asJson(res);
  if (!res.ok) throw new Error(apiError(data, "Failed to load Video run"));
  return data as VideoRun;
}
