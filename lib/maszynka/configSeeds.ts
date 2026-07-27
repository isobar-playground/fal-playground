// Seed content for the Maszynka config kinds — ships with the code and populates
// Neon as version 1 of each kind on first use (see ensureSeeded in configStore.ts).
//
// Sources:
// - hooks: proposed hook library, example zaczepka texts per CONTEXT.md.
// - styles / camera_settings: field structure and the five starter presets per name
//   from `dump/Maszynka v2.0.md` sections 4 ("Preset library w MVP"). The dump only
//   specifies field *names* and why each preset is tested, not field content — the
//   actual visualIntent/lighting/etc. copy below is reasonable starter content
//   written for this seed, not transcribed from the spec. An operator should refine
//   it through the Configs editor once real test runs are underway.
// - global_rules: the seven rules per section 5 ("Global rules w MVP"), translated
//   from the Polish table to English to match the rest of the app's copy.
// - priority_logic: the rank list from CONTEXT.md / ADR 0001 ("content safety >
//   product/brand preservation > packshot analysis > hook > style > camera setting >
//   operator prompt") — pending UX author sign-off per the PRD's "Further Notes".
// - model_capability_matrix: derived programmatically from the existing FAL model
//   catalog (lib/models.ts) rather than hand-typed, so it can't drift from the models
//   the Run form actually offers. `supportsNegativePrompt` is false across the board —
//   none of the current FAL endpoints expose a dedicated negative_prompt field; the
//   FAL request mapper (a later slice) is expected to fold negative-prompt content
//   into `finalPrompt` for every current model.
// Relative + explicit extension (not the repo's usual "@/lib/models" alias) so this
// module stays importable by plain `node` in config.check.ts, which has no bundler to
// resolve the "@/" path alias — see status.check.ts for the same constraint.
import { MODELS, hasField, isFluxKontext } from "../models.ts";
import type { ConfigKind } from "./configSchemas.ts";

const HOOKS_SEED = [
  {
    id: "read_twice",
    text: "Przeczytaj to dwa razy, zanim podejmiesz decyzję",
    placementGuidance: "Upper third, clear of the product silhouette.",
    toneGuidance: "Direct, slightly urgent, second-person.",
  },
  {
    id: "specialists_recommend",
    text: "Specjaliści to polecają",
    placementGuidance: "Lower third or near a badge/seal element.",
    toneGuidance: "Authoritative, reassuring.",
  },
  {
    id: "game_changer",
    text: "Nowość, która zmienia zasady gry",
    placementGuidance: "Top of frame, large and bold.",
    toneGuidance: "Excited, novelty-forward.",
  },
  {
    id: "limited_offer",
    text: "Ograniczona oferta — sprawdź teraz",
    placementGuidance: "Corner badge or bottom banner.",
    toneGuidance: "Urgent, scarcity-driven.",
  },
  {
    id: "thousands_testing",
    text: "To już testują tysiące klientów",
    placementGuidance: "Lower third, near social-proof imagery if present.",
    toneGuidance: "Social-proof, conversational.",
  },
];

const STYLES_SEED = [
  {
    styleId: "premium_luxury",
    styleName: "Premium Luxury",
    visualIntent: "Elevated, editorial premium look that signals high value and craftsmanship.",
    lighting: "Soft directional key light with controlled specular highlights; deep, clean shadows.",
    colorDirection: "Rich, desaturated palette — deep neutrals, gold/bronze accents; no oversaturated pops.",
    compositionBias: "Centered or rule-of-thirds hero shot with generous negative space around the product.",
    typographyBehavior: "Minimal, refined typography; hook rendered small and elegant, never crowding the product.",
    avoid: ["harsh flat lighting", "cluttered background", "neon colors", "cheap plastic look"],
    recommendedModels: ["gpt-image-2-edit", "nano-banana-pro-edit"],
    scoringCriteria: ["perceived quality / premium feel", "lighting control", "product hero presence"],
  },
  {
    styleId: "social_native",
    styleName: "Social Native",
    visualIntent: "Looks native to a social feed — candid, unpolished, scroll-stopping.",
    lighting: "Natural or on-camera flash look; slightly uneven, authentic.",
    colorDirection: "Punchy, true-to-life color; no heavy grading.",
    compositionBias: "Off-center, handheld framing; product integrated into a lifestyle moment.",
    typographyBehavior: "Hook rendered like a caption/sticker overlay, casual and bold.",
    avoid: ["overly polished studio look", "stiff symmetrical framing", "corporate stock-photo feel"],
    recommendedModels: ["xai/grok-imagine-image", "nano-banana-2-edit"],
    scoringCriteria: ["authenticity", "native-feed fit", "hook legibility as overlay"],
  },
  {
    styleId: "clean_minimal",
    styleName: "Clean Minimal",
    visualIntent: "Maximum simplicity and clarity — product and message read instantly.",
    lighting: "Even, soft, shadowless lighting.",
    colorDirection: "Restrained palette — one or two colors plus a neutral background.",
    compositionBias: "Single clear focal point, large negative space, strict grid alignment.",
    typographyBehavior: "Hook set in clean sans-serif, high contrast, well clear of the product.",
    avoid: ["busy backgrounds", "multiple competing focal points", "heavy texture / noise"],
    recommendedModels: ["gpt-image-2-edit", "flux-2-pro-edit"],
    scoringCriteria: ["clarity", "legibility", "space control"],
  },
  {
    styleId: "hyperreal_cgi",
    styleName: "Hyperreal CGI",
    visualIntent: "Hyper-detailed, CGI-grade hero rendering of the product.",
    lighting: "Studio-grade multi-point lighting with crisp reflections and controlled specularity.",
    colorDirection: "High-fidelity, true material color with subtle rim-light accents.",
    compositionBias: "Tight hero framing emphasizing material, texture and form.",
    typographyBehavior: "Hook kept minimal so it doesn't compete with material detail.",
    avoid: ["flat / low-detail rendering", "visible artifacts", "texture smearing"],
    recommendedModels: ["nano-banana-pro-edit", "flux-2-max"],
    scoringCriteria: ["material / texture fidelity", "light realism", "product hero detail"],
  },
  {
    styleId: "performance_ad_creative",
    styleName: "Performance Ad Creative",
    visualIntent: "Direct-response ad look — hook and product both read instantly at thumbnail size.",
    lighting: "Bright, high-contrast lighting for feed visibility.",
    colorDirection: "Bold, saturated colors that stand out in a feed.",
    compositionBias: "Product and hook both in the top third; a single clear focal hierarchy.",
    typographyBehavior: "Hook rendered large, bold, high-contrast — must be legible at small thumbnail size.",
    avoid: [
      "small illegible text",
      "low-contrast text over a busy background",
      "hook competing with product for attention",
    ],
    recommendedModels: ["ideogram/v4", "gpt-image-2-edit"],
    scoringCriteria: ["hook legibility at thumbnail size", "ad-performance read", "product+hook balance"],
  },
];

const CAMERA_SETTINGS_SEED = [
  {
    cameraSettingId: "locked_tripod_studio",
    cameraSettingName: "Locked Tripod Studio",
    cameraIntent: "Stable, neutral baseline studio shot for packshot fidelity testing.",
    shotType: "Product hero shot.",
    framing: "Centered, product fills 60-70% of frame.",
    angle: "Eye-level, straight-on.",
    cameraDistance: "Medium — full product visible with a small margin.",
    lensFeel: "Neutral focal length, no distortion, no exaggerated depth of field.",
    motionIntensity: "None — fully static.",
    stability: "Locked-off, tripod-stable.",
    imageTranslation: "Renders as a single, perfectly stable static frame.",
    avoid: ["camera shake", "distorted wide-angle look", "off-center product"],
    recommendedModels: ["gpt-image-2-edit", "nano-banana-2-edit"],
    scoringCriteria: ["product stability / fidelity", "framing accuracy"],
  },
  {
    cameraSettingId: "macro_product_camera",
    cameraSettingName: "Macro Product Camera",
    cameraIntent: "Extreme close-up on product detail, texture and label.",
    shotType: "Macro / close-up.",
    framing: "Tight crop on a specific product detail (label, texture, cap).",
    angle: "Slight three-quarter angle to show depth.",
    cameraDistance: "Very close.",
    lensFeel: "Macro lens feel — shallow depth of field, high detail sharpness.",
    motionIntensity: "None — static.",
    stability: "Locked-off.",
    imageTranslation: "Static image emphasizing fine surface / texture detail.",
    avoid: ["blurry label text", "lost fine detail", "overly shallow focus that hides key info"],
    recommendedModels: ["nano-banana-pro-edit", "flux-2-max"],
    scoringCriteria: ["label / texture legibility", "detail sharpness"],
  },
  {
    cameraSettingId: "handheld_ugc_iphone",
    cameraSettingName: "Handheld UGC (iPhone Style)",
    cameraIntent: "Mimics a casual phone photo for social-native, UGC-style content.",
    shotType: "Casual lifestyle / product-in-use shot.",
    framing: "Slightly off-center, natural imperfect framing.",
    angle: "Natural eye-level or slightly-above phone angle.",
    cameraDistance: "Arm's length, close-to-medium.",
    lensFeel: "Phone-camera lens feel — wide-ish, mild natural distortion.",
    motionIntensity: "Slight — subtle handheld imperfection.",
    stability: "Handheld, not perfectly stable.",
    imageTranslation: "Static image should still read as 'captured', not 'staged'.",
    avoid: ["studio-perfect lighting", "overly stable / tripod look", "stock-photo polish"],
    recommendedModels: ["xai/grok-imagine-image", "nano-banana-2-edit"],
    scoringCriteria: ["authenticity of the UGC look", "native-feed credibility"],
  },
  {
    cameraSettingId: "overhead_tabletop",
    cameraSettingName: "Overhead Tabletop",
    cameraIntent: "Flat-lay / top-down view for tabletop, food or multi-item product demos.",
    shotType: "Flat lay / overhead.",
    framing: "Product(s) centered, viewed directly from above.",
    angle: "90° top-down.",
    cameraDistance: "Medium, full scene visible.",
    lensFeel: "Neutral, minimal distortion.",
    motionIntensity: "None — static.",
    stability: "Locked-off.",
    imageTranslation: "Static top-down composition, no perspective depth.",
    avoid: ["off-angle perspective", "product cut off at frame edge", "cluttered surface"],
    recommendedModels: ["gpt-image-2-edit", "flux-2-pro-edit"],
    scoringCriteria: ["top-down accuracy", "layout clarity"],
  },
  {
    cameraSettingId: "cinematic_commercial",
    cameraSettingName: "Cinematic Commercial",
    cameraIntent: "Polished, ad-grade cinematic framing for a premium commercial feel.",
    shotType: "Cinematic hero shot.",
    framing: "Wide-ish cinematic framing with intentional negative space.",
    angle: "Slight low angle or dynamic angle for drama.",
    cameraDistance: "Medium-wide.",
    lensFeel: "Cinematic lens feel — shallow depth of field, subtle lens flare/bokeh allowed.",
    motionIntensity: "None for stills; implies a motion-graded look.",
    stability: "Locked-off / gimbal-smooth feel.",
    imageTranslation: "Static frame should read like a still pulled from a commercial.",
    avoid: ["flat / amateur lighting", "snapshot framing", "harsh direct flash"],
    recommendedModels: ["nano-banana-pro-edit", "flux-2-max"],
    scoringCriteria: ["cinematic quality", "dramatic lighting / composition"],
  },
];

// A standalone Lighting preset library (mirrors the `lighting` instruction each Style
// preset above already carries, just factored out into its own reusable, addable list —
// same simple id/name/instruction shape as global_rules below).
const LIGHTING_SEED = [
  {
    id: "soft_directional_key",
    name: "Soft Directional Key",
    instruction: "Soft directional key light with controlled specular highlights; deep, clean shadows.",
  },
  {
    id: "natural_on_camera",
    name: "Natural / On-Camera",
    instruction: "Natural or on-camera flash look; slightly uneven, authentic.",
  },
  {
    id: "even_shadowless",
    name: "Even Shadowless",
    instruction: "Even, soft, shadowless lighting with no harsh shadows.",
  },
  {
    id: "studio_multi_point",
    name: "Studio Multi-Point",
    instruction: "Studio-grade multi-point lighting with crisp reflections and controlled specularity.",
  },
  {
    id: "bright_high_contrast",
    name: "Bright High-Contrast",
    instruction: "Bright, high-contrast lighting for feed visibility and thumbnail-scale legibility.",
  },
];

const GLOBAL_RULES_SEED = [
  {
    id: "content_safety_legal",
    name: "Content safety & legal guardrails",
    description: "Check whether the input can be used for generation at all (prohibited, regulated, or legally risky content).",
  },
  {
    id: "product_preservation",
    name: "Product preservation",
    description: "Check that the prompt protects the product, packaging, logo, label and variant of the packshot.",
  },
  {
    id: "brand_preservation",
    name: "Brand preservation",
    description: "Check that the prompt protects visible brand elements (palette, key visual, layout feel).",
  },
  {
    id: "remove_existing_copy",
    name: "Remove existing marketing copy",
    description: "Check that the prompt does not copy old overlay copy from reference images.",
  },
  {
    id: "language_override",
    name: "Language override",
    description: "Check that any text generated on the asset is in the operator-selected target language.",
  },
  {
    id: "typography_readability",
    name: "Typography and readability",
    description: "Check that on-asset text is readable and does not obscure the product.",
  },
  {
    id: "visual_composition",
    name: "Visual composition",
    description: "Check that the asset has a readable composition with a clear main focal point.",
  },
];

const PRIORITY_LOGIC_SEED = {
  layers: [
    { id: "content_safety", label: "Content safety" },
    { id: "product_brand_preservation", label: "Product & brand preservation" },
    { id: "packshot_analysis", label: "Packshot analysis" },
    { id: "hook", label: "Hook" },
    { id: "style", label: "Style" },
    { id: "camera_setting", label: "Camera setting" },
    { id: "operator_prompt", label: "Operator prompt" },
  ],
};

// Derived from the live FAL model catalog rather than hand-typed, so the matrix can't
// silently drift from the models the Run form actually offers. `maxInputImages` is a
// rough ceiling for MVP (edit models generally accept several reference images; FLUX
// Kontext is the one family limited to a single image_url) — the FAL request mapper
// (a later slice) is the place that should tighten this per real endpoint limits.
const MODEL_CAPABILITY_MATRIX_SEED = MODELS.map((m) => ({
  modelKey: m.key,
  modelId: m.id,
  modelLabel: m.label,
  supportsNegativePrompt: false,
  supportsSeed: hasField(m, "seed"),
  maxInputImages: m.mode === "edit" ? (isFluxKontext(m) ? 1 : 14) : 0,
  supportsMultiImage: m.mode === "edit" && !isFluxKontext(m),
  notes: "",
}));

// stage_prompts (issue #16): seeded verbatim from the hardcoded system prompts each
// stage module currently ships (lib/maszynka/contentSafety.ts, assetAnalysis.ts,
// promptImprovement.ts, promptBuilder.ts, promptReviewer.ts) so wiring the Run path to
// read from config (a later slice) is a behavior-preserving change — the operator sees
// exactly the same instructions on day one, just editable. Copied by hand rather than
// imported from those modules: they currently export a single baked-in constant, not a
// reusable "default text" value, and importing five stage modules into the config seed
// (itself imported by the Neon-free config.check.ts) would pull in ../chat/models.ts and
// friends for no reason. A later slice that makes the stage modules accept prompt-config
// input (PRD story 33) is the natural point to re-derive these constants from one
// shared source instead of two.
const STAGE_PROMPTS_SEED = {
  contentSafety: {
    systemPrompt: `You are the Content safety pre-check stage of the Maszynka Content Factory test bench — the FIRST stage of the pipeline, running before Asset analysis and before any FAL generation call. Priority logic ranks content safety at the very top: your verdict overrides every other layer (product/brand preservation, hook, style, camera setting, operator prompt).

You are given the operator's raw prompt and every uploaded asset image (if any). An asset's systemic role — packshot, style_reference, brand_reference, campaign_reference — is not relevant to this check; inspect every image's actual content regardless of role.

Check the prompt and every image for content that is prohibited, legally regulated, legally risky, or likely to violate a downstream image-generation model's own content policy — for example: sexual content involving minors, non-consensual intimate imagery, extreme violence or gore, instructions for illegal activity, hate symbols or hateful content, weapons in a threatening context, or regulated-product claims (e.g. medical/pharmaceutical claims) the operator has no right to make.

Respond with ONE JSON object (matching the required schema exactly):
- status: "content_safety_passed" if nothing of concern was found; "content_safety_allowed_with_constraints" if the run may proceed but only under specific constraints; "content_safety_revise_required" if the operator must change the prompt/assets before this run can proceed at all; "content_safety_blocked" if this run must stop outright and should not be retried.
- reasons: concrete findings behind the status (empty array only when status is "content_safety_passed").
- constraints: specific, operator-facing constraints the run must honor — populated only when status is "content_safety_allowed_with_constraints" (empty array for every other status).

Respond with the JSON object only.`,
  },
  assetAnalysis: {
    baseInstructions: `You are the Asset analysis stage of the Maszynka Content Factory test bench.

You are given exactly one uploaded image and its systemic role (derived from which upload field it came through, never from operator prose — see the role instruction below). Your job is to produce a structured description of THIS image for the Prompt builder stage to use instead of raw pixels.

Respond with ONE JSON object (matching the required schema exactly): description, attributes, preserveElements. Respond with the JSON object only.`,
    roleInstructions: {
      packshot:
        "This image's role is PACKSHOT — the product that must be preserved exactly in the generated asset. " +
        "Describe: product type, packaging shape, color, logo, label (including any visible label text), and " +
        "product variant. Put each of those as a key/value pair in `attributes` (keys: productType, " +
        "packagingShape, color, logo, label, variant — omit a key if genuinely not visible/applicable). List " +
        "every element that must NOT be changed (packaging, color, proportions, logo, label, variant) in " +
        "`preserveElements`.",
      style_reference:
        "This image's role is STYLE REFERENCE — it supplies visual look only: mood, lighting, color palette and " +
        "general aesthetic. It is NOT a product to preserve — do not describe packaging/logo/label, and leave " +
        "`preserveElements` as an empty array. Put style-relevant facts in `attributes` (keys such as " +
        "visualStyle, lighting, colorPalette, composition).",
      brand_reference:
        "This image's role is BRAND REFERENCE — it supplies brand elements only: palette, key visual, layout " +
        "feel, or brand visual rules. It is NOT a product to preserve — leave `preserveElements` as an empty " +
        "array. Put brand-relevant facts in `attributes` (keys such as brandElements, colorPalette, " +
        "typographyNotes, layoutFeel).",
      campaign_reference:
        "This image's role is CAMPAIGN REFERENCE — it supplies the rhythm/consistency of a series, not literal " +
        "copy to reuse. It is NOT a product to preserve — leave `preserveElements` as an empty array. Put " +
        "campaign-relevant facts in `attributes` (keys such as campaignTheme, seriesRhythm, moodTone) and do not " +
        "transcribe any old marketing copy 1:1.",
    },
  },
  promptImprovement: {
    systemPrompt: `You are the Prompt improvement stage of the Maszynka Content Factory test bench.

The operator has typed a raw creative prompt describing what they want an AI image-generation pipeline to produce. Your job is to propose a clearer, more specific, better-structured rewrite of that prompt — sharpen vague language, make implicit intent explicit, fix ambiguity or contradictions — WITHOUT inventing new creative direction the operator didn't imply, and without discarding their intent. This is a proposal only: the operator will explicitly accept or discard it before it is ever used.

Respond with ONE JSON object (matching the required schema exactly):
- userPromptImproved: the rewritten prompt.
- rationale: a short note on what changed and why (empty string if there's nothing worth calling out).

Respond with the JSON object only.`,
  },
  promptBuilder: {
    systemPrompt: `You are the Prompt builder stage of the Maszynka Content Factory test bench.

You receive a single JSON "Contract" object describing one test run: the operator's raw prompt, a "safetyConstraints" array (operator-facing constraints from the Content safety pre-check stage that ran before this Contract was even assembled — see below), any uploaded assets (asset "role" is systemic — packshot/style_reference/brand_reference/campaign_reference — never inferred from prose) each carrying an "analysis" object (the Asset analysis stage's structured description: "description", "attributes" as role-specific key/value facts, and "preserveElements" — packaging/color/proportions/logo/label/variant to preserve, populated only for the packshot), a selected Hook (short attention-grabbing marketing text to render on the asset), a selected Style preset, a selected Camera setting preset, a selected Lighting preset (a specific lighting instruction — e.g. rim light, soft key light — to apply alongside the Style preset's own broader "lighting" field), a set of global rules that always apply, an ordered Priority logic (most important first: content safety > product/brand preservation > packshot analysis > hook > style > camera setting > operator prompt — on conflict, the higher layer wins), the target model's capabilities, and generation settings (target language, aspect ratio, variant count).

"safetyConstraints" is rank 1 in the priority logic — higher than product/brand preservation, higher than the hook, higher than everything else. If it is non-empty, finalPrompt MUST honor every listed constraint exactly (e.g. "no visible alcohol branding" means finalPrompt must not describe or imply alcohol branding, even if the operator's raw prompt or a reference asset suggests otherwise); treat these as hard requirements, never as optional style guidance. An empty array means no extra constraints apply beyond the global content-safety rule already baked into the priority logic.

Use each asset strictly within its role and its "analysis" output: the packshot (its "preserveElements" list is non-negotiable — packaging, color, proportions, logo, label, variant MUST be preserved exactly, never mutated) is the product to feature; a style_reference informs only look/mood/lighting/palette; a brand_reference informs only brand elements/palette/layout feel; a campaign_reference informs only the series' rhythm/consistency — never treat a reference asset as a preservation target, and never copy old marketing text from a campaign_reference verbatim. If a packshot image is attached to this message directly (in addition to its analysis text), cross-check it visually against "preserveElements".

Your job: produce ONE JSON object (matching the required schema exactly) with:
- finalPrompt: the complete prompt to send to the image generation model, combining the operator's intent with the hook, style, camera setting, lighting preset and global rules per the priority logic.
- negativePrompt: things to avoid in the generated image (empty string if nothing specific applies).
- promptSummary: a short human-readable summary of what you built and why.
- appliedRules: the ids/names of the hook, style, camera setting, lighting preset and global rules you actually applied.
- riskNotes: anything ambiguous, conflicting, or risky you noticed while building the prompt (empty array if none).

Respond with the JSON object only.`,
    // {{issues}} / {{revisionInstruction}} are placeholders a later slice's Stage prompt
    // resolver substitutes with the Prompt reviewer's actual issues/instruction for this
    // attempt (see PromptBuilderRevisionContext in promptBuilder.ts) — kept as a literal
    // template string here, not a function, so it's plain JSON-storable config content.
    revisionInstructionTemplate:
      "The Prompt reviewer rejected this output. Issues: {{issues}}. " +
      "Revision instruction: {{revisionInstruction}}. " +
      "Produce a corrected JSON object (matching the same schema) that fixes these issues while still " +
      "respecting the Contract above. This is the only rebuild allowed — make it count.",
  },
  promptReviewer: {
    systemPrompt: `You are the Prompt reviewer stage of the Maszynka Content Factory test bench.

You receive the same Contract the Prompt builder used (operator's raw prompt, uploaded assets with their systemic roles — packshot, style_reference, brand_reference, campaign_reference — and each asset's Asset analysis output, a selected Hook, Style, Camera setting and Lighting preset, global rules, an ordered priority logic, the target model's capability entry, and generation settings) and the Prompt builder's output (finalPrompt, negativePrompt, promptSummary, appliedRules, riskNotes). Your job is to gate that output before it reaches FAL generation — never rewrite it yourself.

Check, at minimum:
1. If the Contract's "safetyConstraints" array is non-empty (constraints from the Content safety pre-check stage that ran before this Contract was assembled — rank 1 in the priority logic, above everything else including product/brand preservation), finalPrompt and negativePrompt must honor every one of them exactly. Any violation is not a minor style issue — treat it the same severity as a content-safety violation (see check 6).
2. Asset roles are honored — if a packshot is attached, finalPrompt must clearly treat it as the product to feature, not a generic/background reference. Any style/brand/campaign reference asset must only have influenced finalPrompt within its role's scope (look/mood for style, brand elements for brand, series rhythm for campaign) per its analysis output — never treated as a product to preserve, never a source of literal copy to reuse. Skip a role's check when no such asset is present.
3. Product preservation is present — if a packshot is attached, finalPrompt must explicitly preserve the product's packaging, color, proportions, logo, label, variant. Compare the packshot image (attached below, if present) against finalPrompt's description.
4. The selected Style, Camera setting and Lighting preset are actually reflected in finalPrompt (their visual intent, lighting/framing/angle etc. — not ignored, not replaced with something unrelated).
5. If the Contract carries a Hook, its exact text must appear (or be very clearly rendered) in finalPrompt — not dropped, not paraphrased into something different.
6. finalPrompt does not carry over stale marketing copy from the operator's raw prompt that conflicts with or duplicates the Hook.
7. finalPrompt and negativePrompt do not violate content safety (no illegal content, no sexualization of minors, no hateful or otherwise disallowed material).
8. finalPrompt and negativePrompt do not rely on fields the selected model's capability entry doesn't support — e.g. a populated negativePrompt when the model's capability entry says negative prompts aren't supported.

Respond with ONE JSON object (matching the required schema exactly):
- status: "pass" if every applicable check above passes; "revise" if there are fixable issues; "failed" if the output is fundamentally unsuitable and should not be retried (e.g. a safety violation).
- issues: the concrete problems you found (empty array only when status is "pass").
- revisionInstruction: a specific, actionable instruction for the Prompt builder's next attempt (empty string unless status is "revise").

Respond with the JSON object only.`,
  },
};

export const CONFIG_SEEDS: Record<ConfigKind, unknown> = {
  hooks: HOOKS_SEED,
  styles: STYLES_SEED,
  camera_settings: CAMERA_SETTINGS_SEED,
  lighting: LIGHTING_SEED,
  global_rules: GLOBAL_RULES_SEED,
  priority_logic: PRIORITY_LOGIC_SEED,
  model_capability_matrix: MODEL_CAPABILITY_MATRIX_SEED,
  stage_prompts: STAGE_PROMPTS_SEED,
};
