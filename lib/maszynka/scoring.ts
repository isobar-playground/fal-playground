// Manual scoring — the operator's per-asset quality verdict after generation (PRD
// section 17 / dump/Maszynka v2.0.md "Manual scoring"; CONTEXT.md "Manual scoring").
// Pure, framework-free (no Neon/React import) — same layering as status.ts/contract.ts.
//
// The three vocabularies below (decisions, blocker issues, next actions) are hardcoded
// here, not a config kind — an explicit PRD decision ("Scoring vocabulary ... is fixed
// in code from spec section 17 — not a config — since the reviewer/scoring
// comparability depends on a stable vocabulary"), unlike the six config kinds from
// issue #2 (hooks, styles, camera settings, global rules, priority logic, model
// capability matrix), which ARE operator-editable. Changing these vocabularies means
// editing this file and shipping a deploy, by design.
//
// Every generated asset (`MaszynkaRun.outputs`, written once at `generation_completed`
// — see store.ts) gets scored independently and can be re-scored later (issue #11
// acceptance criteria), so scores are stored keyed by asset URL in a jsonb map
// (`ScoresByAsset`/`manual_scores` column), not a single scalar on the run — re-scoring
// an asset simply overwrites its entry, leaving every other asset's score untouched.

export type ScoreDecision = "accept" | "reject" | "mixed";

/** Spec section 17, "Minimalne pola" -> `decision`. */
export const SCORE_DECISIONS: ScoreDecision[] = ["accept", "reject", "mixed"];

export type BlockerIssue =
  | "missing_hook"
  | "wrong_hook_text"
  | "unreadable_copy"
  | "bad_typography"
  | "too_much_text"
  | "product_changed"
  | "product_not_visible"
  | "logo_removed_or_damaged"
  | "label_changed"
  | "old_marketing_copy_visible"
  | "style_not_followed"
  | "camera_setting_not_followed"
  | "preset_conflict"
  | "model_not_suitable_for_preset"
  | "reference_misused"
  | "brand_reference_ignored"
  | "wrong_language"
  | "wrong_format"
  | "model_artifacts"
  | "poor_visual_quality"
  | "other";

/** Spec section 17, "Minimalne blockery" table — verbatim, id + English gloss of the
 *  Polish "Kiedy używać" (when to use) column. */
export const BLOCKER_ISSUES: { id: BlockerIssue; label: string }[] = [
  { id: "missing_hook", label: "Missing hook — the hook did not appear on the asset." },
  { id: "wrong_hook_text", label: "Wrong hook text — the hook is distorted or wrong." },
  { id: "unreadable_copy", label: "Unreadable copy — text is illegible." },
  { id: "bad_typography", label: "Bad typography — typography is weak." },
  { id: "too_much_text", label: "Too much text — the asset has too much text." },
  { id: "product_changed", label: "Product changed — the product itself was altered." },
  { id: "product_not_visible", label: "Product not visible — the product is barely visible." },
  { id: "logo_removed_or_damaged", label: "Logo removed or damaged." },
  { id: "label_changed", label: "Label changed — the product's label was altered." },
  { id: "old_marketing_copy_visible", label: "Old marketing copy still visible from a reference." },
  { id: "style_not_followed", label: "Style not followed — the asset ignores the chosen style." },
  { id: "camera_setting_not_followed", label: "Camera setting not followed." },
  { id: "preset_conflict", label: "Preset conflict — style and camera produced an inconsistent result." },
  { id: "model_not_suitable_for_preset", label: "Model clearly can't handle the chosen preset." },
  { id: "reference_misused", label: "Reference misused — a reference was used against its role." },
  { id: "brand_reference_ignored", label: "Brand reference ignored." },
  { id: "wrong_language", label: "Wrong language — text is in the wrong language." },
  { id: "wrong_format", label: "Wrong format — the asset's format is incorrect." },
  { id: "model_artifacts", label: "Model artifacts are visible." },
  { id: "poor_visual_quality", label: "Poor visual quality." },
  { id: "other", label: "Other problem." },
];
export const BLOCKER_ISSUE_IDS: BlockerIssue[] = BLOCKER_ISSUES.map((b) => b.id);

export type NextAction =
  | "keep"
  | "retry_same_settings"
  | "retry_different_seed"
  | "retry_different_model"
  | "update_user_prompt"
  | "update_hook_config"
  | "update_style_config"
  | "update_camera_setting_config"
  | "update_global_rule"
  | "update_asset_analysis"
  | "update_negative_prompt"
  | "needs_manual_review";

/** Spec section 17, "Minimalne next actions" table — verbatim. */
export const NEXT_ACTIONS: { id: NextAction; label: string }[] = [
  { id: "keep", label: "Keep — the result is good." },
  { id: "retry_same_settings", label: "Retry with the same settings." },
  { id: "retry_different_seed", label: "Retry with a different seed." },
  { id: "retry_different_model", label: "Try a different model." },
  { id: "update_user_prompt", label: "Fix the operator prompt." },
  { id: "update_hook_config", label: "Fix the hook config." },
  { id: "update_style_config", label: "Fix the style config." },
  { id: "update_camera_setting_config", label: "Fix the camera setting config." },
  { id: "update_global_rule", label: "Fix a global rule." },
  { id: "update_asset_analysis", label: "Fix the asset analysis." },
  { id: "update_negative_prompt", label: "Strengthen the negative prompt." },
  { id: "needs_manual_review", label: "Needs a human decision." },
];
export const NEXT_ACTION_IDS: NextAction[] = NEXT_ACTIONS.map((a) => a.id);

/** One operator scoring verdict for one generated asset, keyed externally by
 *  `assetUrl` in `ScoresByAsset` (see below). `scoredAt` is server-set and overwritten
 *  on every re-score — the store never keeps prior scoring attempts, unlike the Prompt
 *  builder/reviewer's append-only attempt histories, since re-scoring an asset
 *  supersedes rather than extends the previous verdict (spec section 17 has no notion
 *  of scoring "attempts"). */
export interface AssetScore {
  assetUrl: string;
  decision: ScoreDecision;
  blockerIssues: BlockerIssue[];
  comment: string;
  nextActions: NextAction[];
  scoredAt: string; // ISO
}

/** The run's full manual-scoring state — every scored asset, keyed by its output URL
 *  (unique per generated asset within a run; see MaszynkaRun.outputs in store.ts). */
export type ScoresByAsset = Record<string, AssetScore>;

/** Field-level validation shared by the API route (server-side, defense in depth) and
 *  the scoring form (client-side, so the operator gets an inline error instead of a
 *  round-trip). Never throws. */
export function validateAssetScoreInput(input: {
  assetUrl?: unknown;
  decision?: unknown;
  blockerIssues?: unknown;
  comment?: unknown;
  nextActions?: unknown;
}): string[] {
  const errors: string[] = [];
  if (typeof input.assetUrl !== "string" || !input.assetUrl.trim()) {
    errors.push("assetUrl is required.");
  }
  if (typeof input.decision !== "string" || !SCORE_DECISIONS.includes(input.decision as ScoreDecision)) {
    errors.push(`decision must be one of: ${SCORE_DECISIONS.join(", ")}.`);
  }
  const blockerIssues = input.blockerIssues;
  if (blockerIssues !== undefined) {
    if (!Array.isArray(blockerIssues) || blockerIssues.some((b) => !BLOCKER_ISSUE_IDS.includes(b))) {
      errors.push(`blockerIssues must be a list drawn from: ${BLOCKER_ISSUE_IDS.join(", ")}.`);
    }
  }
  const nextActions = input.nextActions;
  if (nextActions !== undefined) {
    if (!Array.isArray(nextActions) || nextActions.some((a) => !NEXT_ACTION_IDS.includes(a))) {
      errors.push(`nextActions must be a list drawn from: ${NEXT_ACTION_IDS.join(", ")}.`);
    }
  }
  if (input.comment !== undefined && typeof input.comment !== "string") {
    errors.push("comment must be a string.");
  }
  return errors;
}

/** The per-asset scoring completeness check that gates the
 *  `generation_completed -> manual_scoring_completed` transition (see status.ts):
 *  every asset the run actually generated must have a score before the run can be
 *  marked as manually scored. A run with zero generated assets is never "fully scored"
 *  — there's nothing to score, so it can't reach this milestone (matching
 *  `asset_analysis_completed`'s trivial-but-explicit handling of the zero-asset case
 *  elsewhere in this pipeline would be a category error here: no outputs means the run
 *  never reached `generation_completed` successfully in the first place). */
export function isRunFullyScored(outputs: { url: string }[], scores: ScoresByAsset): boolean {
  if (!outputs.length) return false;
  return outputs.every((o) => scores[o.url] != null);
}
