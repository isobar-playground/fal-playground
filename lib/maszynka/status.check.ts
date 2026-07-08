// Runnable check for lib/maszynka/status.ts — the only non-trivial pure logic this
// slice adds (run status transitions + FAL error classification). Run with:
//   node lib/maszynka/status.check.ts   (or: npm run check:maszynka)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { assertValidTransition, classifyFalError, isValidTransition } from "./status.ts";

// --- status transitions ---------------------------------------------------
assert.equal(isValidTransition("run_started", "prompt_builder_contract_created"), true);
assert.equal(isValidTransition("run_started", "prompt_builder_contract_validation_failed"), true);
assert.equal(isValidTransition("prompt_builder_contract_created", "prompt_builder_completed"), true);
assert.equal(isValidTransition("prompt_builder_contract_created", "prompt_builder_output_validation_failed"), true);
assert.equal(isValidTransition("prompt_builder_completed", "fal_generation_started"), true);
assert.equal(isValidTransition("fal_generation_started", "generation_completed"), true);
assert.equal(isValidTransition("fal_generation_started", "fal_generation_failed"), true);
assert.equal(isValidTransition("fal_generation_started", "provider_policy_blocked"), true);

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
assert.doesNotThrow(() => assertValidTransition("run_started", "prompt_builder_contract_created"));
assert.doesNotThrow(() => assertValidTransition("prompt_builder_contract_created", "prompt_builder_completed"));

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
