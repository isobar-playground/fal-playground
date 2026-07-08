// Runnable check for lib/maszynka/recommend.ts — the six-rule model recommendation
// table (spec section 12). Run with:
//   node lib/maszynka/recommend.check.ts   (or: npm run check:maszynka-recommend)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { recommendModel, type ModelRecommendationInput } from "./recommend.ts";

const NONE: ModelRecommendationInput = {
  hasPackshot: false,
  hasMultipleVisualReferences: false,
  hasHeavyTextOrPosterLayout: false,
  hasSocialNativeUgcLook: false,
};

// --- row 1: packshot present (product must be preserved) -> gpt-image-2-edit ---------
assert.equal(recommendModel({ ...NONE, hasPackshot: true }).recommendedModelKey, "gpt-image-2-edit");

// --- row 2: packshot + several visual references -> nano-banana-2-edit ---------------
assert.equal(
  recommendModel({ ...NONE, hasPackshot: true, hasMultipleVisualReferences: true }).recommendedModelKey,
  "nano-banana-2-edit",
);

// --- row 3: heavy text / poster layout -> ideogram-v4 ---------------------------------
assert.equal(recommendModel({ ...NONE, hasHeavyTextOrPosterLayout: true }).recommendedModelKey, "ideogram-v4");

// --- row 4: generated from scratch, no packshot -> ideogram-v4 (deterministic default,
// spec also allows xai/grok-imagine-image — see recommend.ts header) ------------------
assert.equal(recommendModel(NONE).recommendedModelKey, "ideogram-v4");
assert.match(recommendModel(NONE).reason, /grok-imagine-image/, "the reason must name the spec's alternative model");

// --- row 5: social-native/UGC look, no packshot -> grok-imagine-image -----------------
assert.equal(
  recommendModel({ ...NONE, hasSocialNativeUgcLook: true }).recommendedModelKey,
  "grok-imagine-image",
);

// --- row 6: social-native/UGC look, with packshot -> nano-banana-2-edit --------------
assert.equal(
  recommendModel({ ...NONE, hasPackshot: true, hasSocialNativeUgcLook: true }).recommendedModelKey,
  "nano-banana-2-edit",
);

// --- every recommendation carries a non-empty, operator-facing reason ----------------
for (const input of [
  NONE,
  { ...NONE, hasPackshot: true },
  { ...NONE, hasPackshot: true, hasMultipleVisualReferences: true },
  { ...NONE, hasHeavyTextOrPosterLayout: true },
  { ...NONE, hasSocialNativeUgcLook: true },
  { ...NONE, hasPackshot: true, hasSocialNativeUgcLook: true },
]) {
  assert.ok(recommendModel(input).reason.trim().length > 0, "every recommendation must carry a reason");
}

// --- priority: heavy text/poster wins over a bare packshot, but not over a packshot's
// more specific multi-reference / UGC-look signals (see recommend.ts's documented order) --
assert.equal(
  recommendModel({ ...NONE, hasPackshot: true, hasHeavyTextOrPosterLayout: true }).recommendedModelKey,
  "ideogram-v4",
  "heavy text/poster layout must win over the bare packshot default",
);
assert.equal(
  recommendModel({ ...NONE, hasPackshot: true, hasHeavyTextOrPosterLayout: true, hasSocialNativeUgcLook: true })
    .recommendedModelKey,
  "nano-banana-2-edit",
  "packshot + UGC-look must win over heavy text/poster layout",
);

console.log("lib/maszynka/recommend.ts — all checks passed");
