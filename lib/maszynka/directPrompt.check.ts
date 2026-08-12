// Runnable check for lib/maszynka/directPrompt.ts — deterministic RUN-preset merge on
// the OpenRouter bypass path. Run with:
//   node lib/maszynka/directPrompt.check.ts   (or: npm run check:maszynka-direct-prompt)
import assert from "node:assert/strict";
import {
  buildDirectFalPrompt,
  resolveRunPresetSelections,
} from "./directPrompt.ts";
import type { CameraSettingConfig, HookConfig, LightingConfig, StyleConfig } from "./configSchemas.ts";

const HOOK: HookConfig = {
  id: "read_twice",
  text: "Read this twice before you decide",
  placementGuidance: "Upper third",
  toneGuidance: "Direct",
};

const STYLE: StyleConfig = {
  styleId: "cozy_lifestyle",
  styleName: "Cozy Lifestyle",
  visualIntent: "Warm, approachable lifestyle scene.",
  lighting: "Soft natural window light.",
  colorDirection: "Warm neutrals.",
  compositionBias: "Product slightly off-center.",
  typographyBehavior: "Minimal overlay text.",
  avoid: ["harsh flash", "clinical studio"],
  recommendedModels: ["nano-banana-pro-edit"],
  scoringCriteria: ["warmth"],
};

const CAMERA: CameraSettingConfig = {
  cameraSettingId: "overhead_tabletop",
  cameraSettingName: "Overhead Tabletop",
  cameraIntent: "Flat-lay product hero.",
  shotType: "Overhead",
  framing: "Centered product with props.",
  angle: "90° top-down.",
  cameraDistance: "Medium.",
  lensFeel: "Crisp, minimal distortion.",
  motionIntensity: "None.",
  stability: "Locked-off.",
  imageTranslation: "Static flat-lay.",
  avoid: ["tilted horizon"],
  recommendedModels: ["nano-banana-pro-edit"],
  scoringCriteria: ["clarity"],
};

const LIGHTING: LightingConfig = {
  id: "golden-hour",
  name: "Golden Hour",
  instruction: "Warm golden-hour sunlight with long soft shadows and rich amber highlights.",
};

// --- resolveRunPresetSelections ------------------------------------------------
const resolved = resolveRunPresetSelections({
  selectedHookId: "",
  selectedStyleId: STYLE.styleId,
  selectedCameraSettingId: "",
  selectedLightingId: LIGHTING.id,
  hooks: [HOOK],
  styles: [STYLE],
  cameraSettings: [CAMERA],
  lightings: [LIGHTING],
});
assert.equal(resolved.hook, null, "empty hook id → none");
assert.equal(resolved.style?.styleId, STYLE.styleId);
assert.equal(resolved.cameraSetting, null);
assert.equal(resolved.lighting?.id, LIGHTING.id);

assert.equal(
  resolveRunPresetSelections({
    selectedHookId: "missing",
    selectedStyleId: "",
    selectedCameraSettingId: "",
    selectedLightingId: "",
    hooks: [HOOK],
    styles: [],
    cameraSettings: [],
    lightings: [],
  }).hook,
  null,
  "unknown id → none (no throw)",
);

// --- buildDirectFalPrompt: prompt only -----------------------------------------
const promptOnly = buildDirectFalPrompt({
  userPromptRaw: "A red shoe on white background",
  hook: null,
  style: null,
  cameraSetting: null,
  lighting: null,
});
assert.equal(promptOnly.finalPrompt, "A red shoe on white background");
assert.equal(promptOnly.negativePrompt, "");
assert.deepEqual(promptOnly.appliedLayers, []);

// --- buildDirectFalPrompt: lighting preset merged ------------------------------
const withLighting = buildDirectFalPrompt({
  userPromptRaw: "A red shoe on white background",
  hook: null,
  style: null,
  cameraSetting: null,
  lighting: LIGHTING,
});
assert.ok(withLighting.finalPrompt.includes("A red shoe on white background"));
assert.ok(withLighting.finalPrompt.includes("Golden Hour"));
assert.ok(withLighting.finalPrompt.includes(LIGHTING.instruction));
assert.deepEqual(withLighting.appliedLayers, ["lighting:golden-hour"]);

// --- buildDirectFalPrompt: all layers + negative prompt ------------------------
const full = buildDirectFalPrompt({
  userPromptRaw: "A red shoe on white background",
  hook: HOOK,
  style: STYLE,
  cameraSetting: CAMERA,
  lighting: LIGHTING,
});
assert.ok(full.finalPrompt.includes(HOOK.text));
assert.ok(full.finalPrompt.includes("Cozy Lifestyle"));
assert.ok(full.finalPrompt.includes("Overhead Tabletop"));
assert.ok(full.finalPrompt.includes("Golden Hour"));
assert.ok(full.finalPrompt.includes(CAMERA.motionIntensity));
assert.ok(full.finalPrompt.includes(CAMERA.stability));
assert.ok(full.negativePrompt.includes("harsh flash"));
assert.ok(full.negativePrompt.includes("tilted horizon"));
assert.deepEqual(full.appliedLayers, [
  "hook:read_twice",
  "style:cozy_lifestyle",
  "camera:overhead_tabletop",
  "lighting:golden-hour",
]);

console.log("directPrompt.check.ts: all assertions passed");
