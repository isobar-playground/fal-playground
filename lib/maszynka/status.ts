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

// Slice 3 inserted the Prompt builder Contract stage between run creation and FAL
// generation: every run must produce a contract (valid or not) before it may reach
// `fal_generation_started` — `run_started -> fal_generation_started` directly is no
// longer legal. Slice 4 adds the real Prompt builder LLM stage: a valid contract now
// goes to OpenRouter and must come back as schema-valid structured output before
// generation may start — `prompt_builder_contract_created -> fal_generation_started`
// directly is no longer legal either. Slice 5 inserts the Prompt reviewer gate: a
// completed builder output must now pass review before FAL generation —
// `prompt_builder_completed -> fal_generation_started` directly is no longer legal
// either. A `revise` verdict loops back through exactly one more builder attempt
// (`prompt_reviewer_revise_required -> prompt_builder_completed`, or straight to
// `prompt_builder_output_validation_failed` if that rebuild call itself fails); the
// one-rebuild-only rule itself is an orchestrator invariant (see MaszynkaView's
// handleRun), not something this graph can express — a second `revise` verdict is
// still a structurally legal `prompt_builder_completed -> prompt_reviewer_revise_
// required` edge, the caller just never takes it twice. Encoded explicitly — rather
// than trusting every caller to send a sane `status` — so a bug in the client pipeline
// fails loudly (400 from the API route) instead of silently writing a run history that
// looks legit but lies about what happened. Extend this map, not around it, when later
// slices add real stages (safety pre-check, FAL request mapper).
//
// Issue #6 inserts the Asset analysis stage right after run creation, before the
// Contract is assembled — the Contract needs every asset's analysis output (see
// contract.ts's `ContractAsset.analysis`), so it can no longer be built from just the
// raw uploads. `run_started -> prompt_builder_contract_created` directly is therefore
// no longer legal: every run must land on `asset_analysis_completed` first (even a run
// with zero uploaded assets — there is simply nothing to analyze, so the stage
// completes trivially) or `asset_analysis_failed`. `asset_analysis_failed` is terminal —
// a bad/unreadable asset ends the run right there, same shape as
// `prompt_builder_contract_validation_failed`.
//
// Issue #7 inserts the Content safety pre-check stage in front of even that — it is now
// the FIRST stage, running before Asset analysis and before any FAL cost is incurred
// (PRD section 6 / CONTEXT.md priority logic: content safety ranks above product/brand
// preservation, i.e. above everything else). `run_started -> asset_analysis_completed`
// directly is therefore no longer legal either: every run must land on one of the four
// `content_safety_*` statuses first (see lib/maszynka/contentSafety.ts). Only
// `content_safety_passed` and `content_safety_allowed_with_constraints` may proceed to
// Asset analysis; `content_safety_revise_required` and `content_safety_blocked` are
// terminal — no further moves, same shape as `asset_analysis_failed` — because the whole
// point of running this stage first is that a blocked/revise-required run must stop
// before any FAL generation cost, and asset analysis' own vision calls aren't free
// either, so it doesn't run for those two outcomes.
//
// Issue #10 inserts the FAL request mapper between the Prompt reviewer gate and FAL
// generation — a reviewer `pass` used to go straight to `fal_generation_started`; now it
// must first produce a mapped FAL payload (see lib/maszynka/falMapper.ts).
// `prompt_reviewer_passed -> fal_generation_started` directly is therefore no longer
// legal either. `fal_request_mapping_failed` is terminal (no further moves), same shape
// as `asset_analysis_failed`/`prompt_builder_contract_validation_failed` — it means the
// Contract/reviewer output couldn't be mapped to any valid FAL request for the selected
// model (e.g. an edit model with zero uploaded assets), so there is nothing sane FAL
// generation could do with it.
export const ALLOWED_NEXT: Partial<Record<RunStatus, RunStatus[]>> = {
  run_started: [
    "content_safety_passed",
    "content_safety_allowed_with_constraints",
    "content_safety_revise_required",
    "content_safety_blocked",
  ],
  content_safety_passed: ["asset_analysis_completed", "asset_analysis_failed"],
  content_safety_allowed_with_constraints: ["asset_analysis_completed", "asset_analysis_failed"],
  asset_analysis_completed: ["prompt_builder_contract_created", "prompt_builder_contract_validation_failed"],
  prompt_builder_contract_created: ["prompt_builder_completed", "prompt_builder_output_validation_failed"],
  prompt_builder_completed: ["prompt_reviewer_passed", "prompt_reviewer_revise_required", "prompt_build_failed"],
  prompt_reviewer_revise_required: ["prompt_builder_completed", "prompt_builder_output_validation_failed"],
  prompt_reviewer_passed: ["fal_request_mapping_completed", "fal_request_mapping_failed"],
  fal_request_mapping_completed: ["fal_generation_started"],
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
