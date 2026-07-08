// Run status vocabulary — see docs/prd/0001-maszynka-test-bench.md section 16 (spec's
// `dump/Maszynka v2.0.md`). The full 22-status list is the DB/API contract so later
// pipeline slices (safety, asset analysis, prompt builder/reviewer, mapper) can append
// their own statuses without a column migration or a type change here.
export type RunStatus =
  | "run_started"
  | "content_safety_passed"
  | "content_safety_allowed_with_constraints"
  | "content_safety_revise_required"
  | "content_safety_blocked"
  | "asset_analysis_completed"
  | "asset_analysis_failed"
  | "prompt_builder_contract_created"
  | "prompt_builder_contract_validation_failed"
  | "prompt_builder_completed"
  | "prompt_builder_output_validation_failed"
  | "prompt_reviewer_passed"
  | "prompt_reviewer_revise_required"
  | "prompt_build_failed"
  | "fal_request_mapping_completed"
  | "fal_request_mapping_failed"
  | "fal_generation_started"
  | "fal_generation_failed"
  | "provider_policy_blocked"
  | "generation_completed"
  | "manual_scoring_completed"
  | "run_completed";

// This slice (walking skeleton: prompt + packshot straight to FAL, no LLM stages) only
// drives three transitions. Encoded explicitly — rather than trusting every caller to
// send a sane `status` — so a bug in the client pipeline fails loudly (400 from the API
// route) instead of silently writing a run history that looks legit but lies about what
// happened. Extend this map, not around it, when later slices add real stages.
export const ALLOWED_NEXT: Partial<Record<RunStatus, RunStatus[]>> = {
  run_started: ["fal_generation_started"],
  fal_generation_started: ["generation_completed", "fal_generation_failed", "provider_policy_blocked"],
};

export function isValidTransition(from: RunStatus, to: RunStatus): boolean {
  return ALLOWED_NEXT[from]?.includes(to) ?? false;
}

export function assertValidTransition(from: RunStatus, to: RunStatus): void {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid Maszynka run status transition: ${from} -> ${to}`);
  }
}

// fal.ai has no single universal error code for "the provider's own content/safety
// policy rejected this request" across every model endpoint — it shows up as a 422
// ValidationError on some models and a plain 4xx/500 with a policy-flavored message on
// others. We distinguish it from a technical failure (timeout, bad params, outage) by
// status + message/body keyword sniffing. Good enough for the two run statuses the PRD
// requires to be distinguishable (`provider_policy_blocked` vs `fal_generation_failed`);
// tighten this if a specific model's real error shape turns out to slip through.
const POLICY_KEYWORDS = /polic|nsfw|flagged|safety|moderat|blocked|violat|not allowed|prohibited/i;

export function classifyFalError(e: unknown): "provider_policy_blocked" | "fal_generation_failed" {
  const status = (e as { status?: number } | null)?.status;
  const body = (e as { body?: unknown } | null)?.body;
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const haystack = `${message} ${body ? JSON.stringify(body) : ""}`;
  if (status === 422 && POLICY_KEYWORDS.test(haystack)) return "provider_policy_blocked";
  if (POLICY_KEYWORDS.test(haystack)) return "provider_policy_blocked";
  return "fal_generation_failed";
}
