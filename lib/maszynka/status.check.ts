// Runnable check for lib/maszynka/status.ts — the only non-trivial pure logic this
// slice adds (run status transitions + FAL error classification). Run with:
//   node lib/maszynka/status.check.ts   (or: npm run check:maszynka)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { assertValidTransition, classifyFalError, isValidTransition } from "./status.ts";

// --- status transitions ---------------------------------------------------
assert.equal(isValidTransition("content_safety_passed", "asset_analysis_completed"), true);
assert.equal(isValidTransition("content_safety_passed", "asset_analysis_failed"), true);
assert.equal(isValidTransition("content_safety_allowed_with_constraints", "asset_analysis_completed"), true);
assert.equal(isValidTransition("content_safety_allowed_with_constraints", "asset_analysis_failed"), true);
assert.equal(isValidTransition("asset_analysis_completed", "prompt_builder_contract_created"), true);
assert.equal(isValidTransition("asset_analysis_completed", "prompt_builder_contract_validation_failed"), true);
assert.equal(isValidTransition("prompt_builder_contract_created", "prompt_builder_completed"), true);
assert.equal(isValidTransition("prompt_builder_contract_created", "prompt_builder_output_validation_failed"), true);
assert.equal(isValidTransition("prompt_reviewer_passed", "fal_request_mapping_completed"), true);
assert.equal(isValidTransition("fal_request_mapping_completed", "fal_generation_started"), true);
assert.equal(isValidTransition("fal_generation_started", "generation_completed"), true);
assert.equal(isValidTransition("fal_generation_started", "fal_generation_failed"), true);
assert.equal(isValidTransition("fal_generation_started", "provider_policy_blocked"), true);

// --- issue #7: Content safety pre-check is now the FIRST stage --------------------
// run_started can only land on one of the four content_safety_* statuses.
assert.equal(isValidTransition("run_started", "content_safety_passed"), true);
assert.equal(isValidTransition("run_started", "content_safety_allowed_with_constraints"), true);
assert.equal(isValidTransition("run_started", "content_safety_revise_required"), true);
assert.equal(isValidTransition("run_started", "content_safety_blocked"), true);
// Skipping straight to Asset analysis (or anywhere else) is no longer legal — every run
// must clear the safety pre-check first (before any FAL cost, and before the asset
// analysis vision calls too).
assert.equal(isValidTransition("run_started", "asset_analysis_completed"), false);
assert.equal(isValidTransition("run_started", "asset_analysis_failed"), false);
// content_safety_revise_required and content_safety_blocked are terminal — the whole
// point is stopping the run before any further cost is incurred.
assert.equal(isValidTransition("content_safety_revise_required", "asset_analysis_completed"), false);
assert.equal(isValidTransition("content_safety_blocked", "asset_analysis_completed"), false);
assert.equal(isValidTransition("content_safety_revise_required", "asset_analysis_failed"), false);
assert.equal(isValidTransition("content_safety_blocked", "asset_analysis_failed"), false);
assert.doesNotThrow(() => assertValidTransition("run_started", "content_safety_passed"));
assert.doesNotThrow(() => assertValidTransition("content_safety_allowed_with_constraints", "asset_analysis_completed"));
assert.throws(() => assertValidTransition("content_safety_blocked", "asset_analysis_completed"));
assert.throws(() => assertValidTransition("content_safety_revise_required", "asset_analysis_completed"));

// Issue #6: skipping the Asset analysis stage is no longer legal either — every run
// must land on asset_analysis_completed/failed before a Contract can be assembled
// (the Contract needs each asset's analysis output).
assert.equal(isValidTransition("content_safety_passed", "prompt_builder_contract_created"), false);
assert.equal(isValidTransition("content_safety_passed", "prompt_builder_contract_validation_failed"), false);
// asset_analysis_failed is terminal — no further moves.
assert.equal(isValidTransition("asset_analysis_failed", "prompt_builder_contract_created"), false);

// Skipping the Contract stage (slice 3) is no longer legal — every run must produce a
// contract, valid or not, before it may reach FAL generation.
assert.equal(isValidTransition("run_started", "fal_generation_started"), false);
// Skipping the Prompt builder LLM stage (slice 4) is no longer legal either — a valid
// contract must go through the builder before FAL generation.
assert.equal(isValidTransition("prompt_builder_contract_created", "fal_generation_started"), false);
// Skipping a stage (e.g. run_started -> generation_completed) is invalid.
assert.equal(isValidTransition("run_started", "generation_completed"), false);
// Terminal statuses have no further moves in this slice — a failed contract or a failed
// builder output both end the run.
assert.equal(isValidTransition("generation_completed", "run_completed"), false);
assert.equal(isValidTransition("prompt_builder_contract_validation_failed", "fal_generation_started"), false);
assert.equal(isValidTransition("prompt_builder_output_validation_failed", "fal_generation_started"), false);
assert.equal(isValidTransition("prompt_builder_output_validation_failed", "prompt_builder_completed"), false);
assert.throws(() => assertValidTransition("run_started", "generation_completed"));
assert.throws(() => assertValidTransition("run_started", "fal_generation_started"));
assert.throws(() => assertValidTransition("prompt_builder_contract_created", "fal_generation_started"));
assert.doesNotThrow(() => assertValidTransition("content_safety_passed", "asset_analysis_completed"));
assert.doesNotThrow(() => assertValidTransition("asset_analysis_completed", "prompt_builder_contract_created"));
assert.doesNotThrow(() => assertValidTransition("prompt_builder_contract_created", "prompt_builder_completed"));

// --- slice 5: Prompt reviewer gate + revise loop ----------------------------
// Skipping the Prompt reviewer gate (slice 5) is no longer legal — a completed builder
// output must go through review before FAL generation.
assert.equal(isValidTransition("prompt_builder_completed", "fal_generation_started"), false);
// A completed builder output can only land on one of the three reviewer verdicts.
assert.equal(isValidTransition("prompt_builder_completed", "prompt_reviewer_passed"), true);
assert.equal(isValidTransition("prompt_builder_completed", "prompt_reviewer_revise_required"), true);
assert.equal(isValidTransition("prompt_builder_completed", "prompt_build_failed"), true);
// `revise` loops back through exactly one more builder attempt — either it succeeds
// (back to prompt_builder_completed, to be reviewed again) or the rebuild call itself
// fails validation/network (prompt_builder_output_validation_failed). It can never go
// straight to FAL or straight to prompt_build_failed without another builder attempt.
assert.equal(isValidTransition("prompt_reviewer_revise_required", "prompt_builder_completed"), true);
assert.equal(isValidTransition("prompt_reviewer_revise_required", "prompt_builder_output_validation_failed"), true);
assert.equal(isValidTransition("prompt_reviewer_revise_required", "fal_generation_started"), false);
assert.equal(isValidTransition("prompt_reviewer_revise_required", "prompt_build_failed"), false);
// Only a `pass` verdict may proceed to FAL generation.
assert.equal(isValidTransition("prompt_build_failed", "fal_generation_started"), false);
assert.doesNotThrow(() => assertValidTransition("prompt_builder_completed", "prompt_reviewer_revise_required"));
assert.doesNotThrow(() => assertValidTransition("prompt_reviewer_revise_required", "prompt_builder_completed"));
assert.doesNotThrow(() => assertValidTransition("prompt_reviewer_passed", "fal_request_mapping_completed"));

// --- issue #10: FAL request mapper sits between the reviewer gate and FAL generation --
// A reviewer `pass` can only land on one of the two mapper outcomes, never straight to
// FAL generation anymore.
assert.equal(isValidTransition("prompt_reviewer_passed", "fal_generation_started"), false);
assert.equal(isValidTransition("prompt_reviewer_passed", "fal_request_mapping_failed"), true);
// fal_request_mapping_failed is terminal — no further moves (same shape as
// asset_analysis_failed / prompt_builder_contract_validation_failed).
assert.equal(isValidTransition("fal_request_mapping_failed", "fal_generation_started"), false);
assert.throws(() => assertValidTransition("prompt_reviewer_passed", "fal_generation_started"));
assert.doesNotThrow(() => assertValidTransition("prompt_reviewer_passed", "fal_request_mapping_failed"));

// --- FAL error classification ---------------------------------------------
assert.equal(
  classifyFalError(new Error("Content flagged by our safety system")),
  "provider_policy_blocked",
);
assert.equal(
  classifyFalError({ name: "ApiError", status: 422, body: { detail: "NSFW content detected" }, message: "" }),
  "provider_policy_blocked",
);
assert.equal(classifyFalError(new Error("upstream timeout")), "fal_generation_failed");
assert.equal(classifyFalError({ status: 500, message: "Internal error" }), "fal_generation_failed");

console.log("lib/maszynka/status.ts — all checks passed");
