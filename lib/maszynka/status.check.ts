// Runnable check for lib/maszynka/status.ts — the only non-trivial pure logic this
// slice adds (run status transitions + FAL error classification). Run with:
//   node lib/maszynka/status.check.ts   (or: npm run check:maszynka)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { assertValidTransition, classifyFalError, isValidTransition } from "./status.ts";

// --- status transitions ---------------------------------------------------
assert.equal(isValidTransition("run_started", "fal_generation_started"), true);
assert.equal(isValidTransition("fal_generation_started", "generation_completed"), true);
assert.equal(isValidTransition("fal_generation_started", "fal_generation_failed"), true);
assert.equal(isValidTransition("fal_generation_started", "provider_policy_blocked"), true);

// Skipping a stage (e.g. run_started -> generation_completed) is invalid.
assert.equal(isValidTransition("run_started", "generation_completed"), false);
// A terminal status has no further moves in this slice.
assert.equal(isValidTransition("generation_completed", "run_completed"), false);
assert.throws(() => assertValidTransition("run_started", "generation_completed"));
assert.doesNotThrow(() => assertValidTransition("run_started", "fal_generation_started"));

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
