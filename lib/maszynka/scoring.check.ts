// Runnable check for lib/maszynka/scoring.ts — Manual scoring (issue #11 / PRD section
// 17). Run with:
//   node lib/maszynka/scoring.check.ts   (or: npm run check:maszynka-scoring)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import {
  BLOCKER_ISSUE_IDS,
  NEXT_ACTION_IDS,
  SCORE_DECISIONS,
  isRunFullyScored,
  validateAssetScoreInput,
  type AssetScore,
  type ScoresByAsset,
} from "./scoring.ts";

// --- vocabularies are exactly the spec section 17 lists (count + a few spot checks) ---
assert.equal(SCORE_DECISIONS.length, 3);
assert.deepEqual(SCORE_DECISIONS, ["accept", "reject", "mixed"]);
assert.equal(BLOCKER_ISSUE_IDS.length, 21);
assert.ok(BLOCKER_ISSUE_IDS.includes("missing_hook"));
assert.ok(BLOCKER_ISSUE_IDS.includes("brand_reference_ignored"));
assert.ok(BLOCKER_ISSUE_IDS.includes("other"));
assert.equal(NEXT_ACTION_IDS.length, 12);
assert.ok(NEXT_ACTION_IDS.includes("keep"));
assert.ok(NEXT_ACTION_IDS.includes("needs_manual_review"));

// --- validateAssetScoreInput ------------------------------------------------
assert.deepEqual(
  validateAssetScoreInput({ assetUrl: "https://x/1.png", decision: "accept", blockerIssues: [], nextActions: ["keep"] }),
  [],
  "a valid, minimal score input must pass with no errors",
);
assert.deepEqual(
  validateAssetScoreInput({
    assetUrl: "https://x/1.png",
    decision: "reject",
    blockerIssues: ["missing_hook", "poor_visual_quality"],
    comment: "hook never rendered",
    nextActions: ["retry_different_seed", "update_hook_config"],
  }),
  [],
  "a fully populated score input must pass with no errors",
);
assert.ok(validateAssetScoreInput({ decision: "accept" }).some((e) => /assetUrl/.test(e)), "missing assetUrl must fail");
assert.ok(
  validateAssetScoreInput({ assetUrl: "https://x/1.png", decision: "maybe" }).some((e) => /decision/.test(e)),
  "a decision outside the fixed vocabulary must fail",
);
assert.ok(
  validateAssetScoreInput({ assetUrl: "https://x/1.png", decision: "accept", blockerIssues: ["not_a_real_blocker"] }).some((e) =>
    /blockerIssues/.test(e),
  ),
  "a blocker outside the fixed vocabulary must fail",
);
assert.ok(
  validateAssetScoreInput({ assetUrl: "https://x/1.png", decision: "accept", nextActions: ["not_a_real_action"] }).some((e) =>
    /nextActions/.test(e),
  ),
  "a next action outside the fixed vocabulary must fail",
);
assert.deepEqual(
  validateAssetScoreInput({ assetUrl: "https://x/1.png", decision: "mixed" }),
  [],
  "blockerIssues/nextActions are optional (an accept with nothing to flag)",
);

// --- isRunFullyScored: the completeness check gating manual_scoring_completed --------
function score(assetUrl: string): AssetScore {
  return { assetUrl, decision: "accept", blockerIssues: [], comment: "", nextActions: ["keep"], scoredAt: new Date().toISOString() };
}

assert.equal(isRunFullyScored([], {}), false, "a run with zero generated assets is never 'fully scored'");
const twoOutputs = [{ url: "a" }, { url: "b" }];
assert.equal(isRunFullyScored(twoOutputs, {}), false, "no scores yet");
const oneScored: ScoresByAsset = { a: score("a") };
assert.equal(isRunFullyScored(twoOutputs, oneScored), false, "only one of two assets scored");
const bothScored: ScoresByAsset = { a: score("a"), b: score("b") };
assert.equal(isRunFullyScored(twoOutputs, bothScored), true, "every generated asset has a score");
const rescored: ScoresByAsset = { ...bothScored, a: { ...score("a"), decision: "reject" } };
assert.equal(isRunFullyScored(twoOutputs, rescored), true, "re-scoring an asset (overwriting its entry) stays fully scored");
const extraKey: ScoresByAsset = { ...bothScored, c: score("c") };
assert.equal(isRunFullyScored(twoOutputs, extraKey), true, "an unrelated extra key doesn't break completeness");

console.log("lib/maszynka/scoring.ts — all checks passed");
