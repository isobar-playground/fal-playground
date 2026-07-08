"use client";

// Thin fetch wrappers around app/api/maszynka/runs — the only way the browser talks to
// the Neon-backed run store (ADR 0001: runs are server-side, not localStorage).
import type { RunStatus } from "./status";
import type { MaszynkaRun, RunAsset } from "./store";
import type { BlockerIssue, NextAction, ScoreDecision } from "./scoring";

export type { MaszynkaRun, RunAsset } from "./store";

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
  /** Prompt improvement (issue #8) — recorded once at creation, never patched; the
   *  stage runs client-side before the run exists (see lib/maszynka/promptImprovement.ts).
   *  `userPromptImproved` must be set whenever `promptImprovementAccepted` is true (the
   *  API route enforces this). */
  promptImprovementUsed?: boolean;
  promptImprovementAccepted?: boolean;
  userPromptImproved?: string | null;
  modelKey: string;
  modelId: string;
  modelLabel: string;
  /** Model recommendation (issue #9) — recorded once at creation, never patched; see
   *  lib/maszynka/recommend.ts. Image runs only — omit (or pass null) for video runs. */
  recommendedModel?: string | null;
  operatorSelectedModel?: string | null;
  modelOverrideUsed?: boolean;
  modelRecommendationReason?: string | null;
  /** Every uploaded asset (any/all of packshot/style_reference/brand_reference/
   *  campaign_reference — issue #6, replaces slice 1's single `packshotUrl`). */
  assets?: RunAsset[];
  /** The operator's chosen OpenRouter model for the Content safety pre-check stage —
   *  recorded on the run at creation, same reasoning as promptBuilderModel (see
   *  contentSafety.ts). This stage runs first, before Asset analysis. */
  contentSafetyModel?: string;
  /** The operator's chosen OpenRouter model for the Asset analysis stage — recorded on
   *  the run at creation, same reasoning as promptBuilderModel (see assetAnalysis.ts). */
  assetAnalysisModel?: string;
  /** The operator's chosen OpenRouter model for the Prompt builder stage — recorded on
   *  the run at creation since it's picked in the same Run form (see promptBuilder.ts). */
  promptBuilderModel?: string;
  /** The operator's chosen OpenRouter model for the Prompt reviewer stage — recorded on
   *  the run at creation, same reasoning as promptBuilderModel (see promptReviewer.ts). */
  promptReviewerModel?: string;
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
    // Optional as of issue #11: a scoring-only PATCH (see `assetScore` below) never
    // changes the run's status by itself.
    status?: RunStatus;
    detail?: string;
    /** Manual scoring (issue #11) — one asset's verdict; the server upserts it into the
     *  run's `manualScores` map keyed by `assetUrl`, so re-sending the same `assetUrl`
     *  re-scores it without touching any other asset's score. See lib/maszynka/scoring.ts
     *  for the fixed vocabularies. */
    assetScore?: {
      assetUrl: string;
      decision: ScoreDecision;
      blockerIssues?: BlockerIssue[];
      comment?: string;
      nextActions?: NextAction[];
    };
    /** The Content safety pre-check stage's request/response/parsed-output (issue #7) —
     *  full replace, see api route / contentSafety.ts. */
    contentSafetyRequest?: unknown;
    contentSafetyResponse?: unknown;
    contentSafetyOutput?: unknown;
    /** The FAL request mapper's mappingNotes (issue #10) — full replace, see api route /
     *  falMapper.ts. */
    falMappingNotes?: unknown;
    falRequest?: unknown;
    falResponse?: unknown;
    outputs?: { url: string; width?: number; height?: number }[];
    error?: string;
    contract?: unknown;
    promptBuilderRequest?: unknown;
    promptBuilderResponse?: unknown;
    promptBuilderOutput?: unknown;
    /** One Prompt builder attempt — appended to the run's attempt history, see api route. */
    promptBuilderAttempt?: unknown;
    /** One Prompt reviewer attempt — appended to the run's attempt history, see api route. */
    promptReviewerAttempt?: unknown;
    /** The Asset analysis stage's full per-asset record set — replaces (never appends
     *  to) the run's stored results, see api route / assetAnalysis.ts. */
    assetAnalysisResults?: unknown;
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
