// Model recommendation — the six-rule table from `dump/Maszynka v2.0.md` section 12 /
// docs/prd/0001-maszynka-test-bench.md ("Model recommendation"). Pure, framework-free
// (no Neon/React import), same layering as contract.ts: a plain input -> output
// function the caller (MaszynkaView) drives from the operator's asset uploads and two
// creative-config checkboxes (see below) — never an LLM call, never a Neon read.
//
// Image runs only (PRD "Out of Scope": no video model recommendation rules yet — the
// spec's table is image-only and video recommendation rules "await the UX author").
// The caller is expected to only invoke this for `assetType === "image"` runs.
//
// The spec's table (Polish, section 12):
//   | Warunek                                                     | Rekomendowany model                        |
//   |--------------------------------------------------------------------------------------------------------|
//   | Jest packshot i trzeba zachować produkt                     | openai/gpt-image-2/edit                    |
//   | Jest packshot i kilka referencji wizualnych                 | fal-ai/nano-banana-2/edit                  |
//   | Asset ma dużo tekstu albo posterowy layout                  | ideogram/v4                                |
//   | Asset jest generowany od zera, bez packshotu                | ideogram/v4 albo xai/grok-imagine-image    |
//   | Asset ma social-native / UGC look bez packshotu              | xai/grok-imagine-image                     |
//   | Asset ma social-native / UGC look z packshotem                | fal-ai/nano-banana-2/edit                  |
//
// Model identifiers in the table are fal.ai endpoint ids; this module returns the
// app's catalog *keys* (lib/models.ts) so callers can look the recommendation straight
// up in MODEL_BY_KEY, same as every other model reference in the run schema
// (modelKey/operatorSelectedModel). "openai/gpt-image-2/edit" -> "gpt-image-2-edit",
// "fal-ai/nano-banana-2/edit" -> "nano-banana-2-edit", "ideogram/v4" -> "ideogram-v4",
// "xai/grok-imagine-image" -> "grok-imagine-image" (the latter two added by this slice,
// see lib/models.ts).
//
// The table's rows aren't fully mutually exclusive (a run can have a packshot *and* a
// social-native/UGC look *and* several references *and* heavy text, all at once — the
// operator picks these independently). This module resolves overlaps with an explicit
// priority order, most-specific-and-highest-signal first, documented inline below.
// Every row is still reachable and independently testable — see recommend.check.ts,
// which drives exactly the six single-condition scenarios from the table above.

export interface ModelRecommendationInput {
  /** A packshot asset was uploaded (CONTEXT.md "Packshot" — the product to preserve). */
  hasPackshot: boolean;
  /** More than one non-packshot reference asset uploaded (style/brand/campaign
   *  reference roles combined) — "kilka referencji wizualnych". */
  hasMultipleVisualReferences: boolean;
  /** The creative config (operator's call, ahead of the Prompt builder) expects heavy
   *  on-asset text or a poster-style layout — "dużo tekstu albo posterowy layout". */
  hasHeavyTextOrPosterLayout: boolean;
  /** The creative config expects a social-native / UGC look — "social-native / UGC look". */
  hasSocialNativeUgcLook: boolean;
}

export interface ModelRecommendation {
  /** A lib/models.ts catalog key (see MODEL_BY_KEY). */
  recommendedModelKey: string;
  /** Short operator-facing explanation of why — recorded on the run as
   *  `modelRecommendationReason`. */
  reason: string;
}

/** Applies the six-rule table above, in this priority order (highest first):
 *   1. packshot + social-native/UGC look           -> nano-banana-2-edit  (row 6)
 *   2. packshot + several visual references        -> nano-banana-2-edit  (row 2)
 *   3. heavy text / poster layout (packshot-agnostic — Ideogram's core strength is
 *      on-image typography, so this can win even with a packshot present) -> ideogram-v4 (row 3)
 *   4. packshot present, no more specific signal    -> gpt-image-2-edit    (row 1, default
 *      packshot case: "trzeba zachować produkt" is implied by a packshot existing at all —
 *      see CONTEXT.md's Packshot definition)
 *   5. no packshot + social-native/UGC look         -> grok-imagine-image  (row 5)
 *   6. no packshot, no more specific signal         -> ideogram-v4         (row 4, default
 *      "generated from scratch" case — the spec allows either ideogram/v4 or
 *      xai/grok-imagine-image here; ideogram/v4 is picked as the deterministic default
 *      so the recommendation is always a single model, with the alternative named in
 *      the reason text)
 */
export function recommendModel(input: ModelRecommendationInput): ModelRecommendation {
  const { hasPackshot, hasMultipleVisualReferences, hasHeavyTextOrPosterLayout, hasSocialNativeUgcLook } = input;

  if (hasPackshot && hasSocialNativeUgcLook) {
    return {
      recommendedModelKey: "nano-banana-2-edit",
      reason:
        "Packshot present and the creative config calls for a social-native/UGC look — Nano Banana 2/edit " +
        "preserves the packshot while matching that native-feed look.",
    };
  }
  if (hasPackshot && hasMultipleVisualReferences) {
    return {
      recommendedModelKey: "nano-banana-2-edit",
      reason:
        "Packshot present alongside several visual references — Nano Banana 2/edit accepts multiple " +
        "reference images while preserving the packshot.",
    };
  }
  if (hasHeavyTextOrPosterLayout) {
    return {
      recommendedModelKey: "ideogram-v4",
      reason:
        "The creative config calls for heavy on-asset text or a poster layout — Ideogram V4 is built for " +
        "sharp, accurate typography.",
    };
  }
  if (hasPackshot) {
    return {
      recommendedModelKey: "gpt-image-2-edit",
      reason:
        "A packshot is present and must be preserved (packaging, color, proportions, logo, label, variant) — " +
        "GPT Image 2/edit is the default packshot-preserving model.",
    };
  }
  if (hasSocialNativeUgcLook) {
    return {
      recommendedModelKey: "grok-imagine-image",
      reason:
        "No packshot and the creative config calls for a social-native/UGC look — Grok Imagine Image is built " +
        "for that native-feed aesthetic.",
    };
  }
  return {
    recommendedModelKey: "ideogram-v4",
    reason:
      "No packshot — the asset is generated from scratch. Ideogram V4 is the default pick for this case " +
      "(xai/grok-imagine-image is an equally valid alternative per the spec table).",
  };
}
