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

export const CONFIG_SEEDS: Record<ConfigKind, unknown> = {
  hooks: HOOKS_SEED,
  styles: STYLES_SEED,
  camera_settings: CAMERA_SETTINGS_SEED,
  lighting: LIGHTING_SEED,
  global_rules: GLOBAL_RULES_SEED,
  priority_logic: PRIORITY_LOGIC_SEED,
  model_capability_matrix: MODEL_CAPABILITY_MATRIX_SEED,
};
