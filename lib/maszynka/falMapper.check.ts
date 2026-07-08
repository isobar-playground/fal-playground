// Runnable check for lib/maszynka/falMapper.ts — the FAL request mapper (issue #10 /
// PRD section 13). Run with:
//   node lib/maszynka/falMapper.check.ts   (or: npm run check:maszynka-fal-mapper)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, MODEL_BY_KEY, type ModelSettings } from "../models.ts";
import { mapContractToFalRequest, type FalMapperAsset, type FalMapperInput } from "./falMapper.ts";
import type { ModelCapabilityEntry } from "./configSchemas.ts";

const SETTINGS: ModelSettings = { ...DEFAULT_SETTINGS, numImages: 1, aspectRatio: "1:1" };

const PACKSHOT: FalMapperAsset = { id: "a1", role: "packshot", url: "https://example.com/packshot.png" };
const STYLE_REF: FalMapperAsset = { id: "a2", role: "style_reference", url: "https://example.com/style.png" };
const BRAND_REF: FalMapperAsset = { id: "a3", role: "brand_reference", url: "https://example.com/brand.png" };

function capability(overrides: Partial<ModelCapabilityEntry> = {}): ModelCapabilityEntry {
  return {
    modelKey: "test-model",
    modelId: "fal-ai/test-model",
    modelLabel: "Test Model",
    supportsNegativePrompt: false,
    supportsSeed: false,
    maxInputImages: 0,
    supportsMultiImage: false,
    ...overrides,
  };
}

function baseInput(overrides: Partial<FalMapperInput> = {}): FalMapperInput {
  return {
    finalPrompt: "A red running shoe on a white background, studio lighting.",
    negativePrompt: "blurry, low quality",
    seed: "",
    assets: [PACKSHOT],
    model: MODEL_BY_KEY["gpt-image-2-edit"],
    capability: capability({ modelKey: "gpt-image-2-edit", supportsSeed: true }),
    settings: SETTINGS,
    ...overrides,
  };
}

// --- negativePrompt: separate field vs folded — the two payloads must genuinely differ,
// same finalPrompt/negativePrompt on both sides (issue #10 acceptance criterion 1) ------
const capablePrompt = mapContractToFalRequest(baseInput({ capability: capability({ supportsNegativePrompt: true }) }));
const incapablePrompt = mapContractToFalRequest(baseInput({ capability: capability({ supportsNegativePrompt: false }) }));
assert.deepEqual(capablePrompt.errors, []);
assert.deepEqual(incapablePrompt.errors, []);
assert.equal(capablePrompt.falInput?.negative_prompt, "blurry, low quality", "capable model must get a separate negative_prompt field");
assert.equal(incapablePrompt.falInput?.negative_prompt, undefined, "incapable model must never get a negative_prompt field");
assert.match(
  String(incapablePrompt.falInput?.prompt),
  /Avoid \/ Constraints:\n- blurry, low quality/,
  "incapable model must fold negativePrompt into finalPrompt's Avoid / Constraints section",
);
assert.equal(capablePrompt.falInput?.prompt, "A red running shoe on a white background, studio lighting.", "capable model's prompt must stay unfolded");
assert.notDeepEqual(capablePrompt.falInput, incapablePrompt.falInput, "the two payloads must genuinely differ");
assert.ok(capablePrompt.mappingNotes.some((n) => n.includes("supportsNegativePrompt=true")));
assert.ok(incapablePrompt.mappingNotes.some((n) => n.includes("supportsNegativePrompt=false")));

// empty negativePrompt is a no-op either way
const noNegative = mapContractToFalRequest(baseInput({ negativePrompt: "  ", capability: capability({ supportsNegativePrompt: true }) }));
assert.equal(noNegative.falInput?.negative_prompt, undefined);
assert.ok(noNegative.mappingNotes.some((n) => n.startsWith("negativePrompt: empty")));

// --- seed: unsupported is omitted + noted; supported + provided is sent; nothing
// provided is omitted regardless of capability (issue #10 acceptance criterion 2) ------
const seedUnsupported = mapContractToFalRequest(baseInput({ seed: "42", capability: capability({ supportsSeed: false }) }));
assert.equal(seedUnsupported.falInput?.seed, undefined, "unsupported seed must be omitted from the payload");
assert.ok(
  seedUnsupported.mappingNotes.some((n) => /seed:.*42.*supportsSeed=false.*omitted/.test(n)),
  "an omitted seed must be explained in mappingNotes",
);

const seedSupported = mapContractToFalRequest(baseInput({ seed: "42", capability: capability({ supportsSeed: true }) }));
assert.equal(seedSupported.falInput?.seed, 42, "a supported, operator-provided seed must be sent");

const seedNotProvided = mapContractToFalRequest(baseInput({ seed: "", capability: capability({ supportsSeed: true }) }));
assert.equal(seedNotProvided.falInput?.seed, undefined, "no seed provided means nothing to send, even when supported");
assert.ok(seedNotProvided.mappingNotes.some((n) => n.startsWith("seed: none provided")));

// --- images: multi-image capability sends every asset (packshot first), capped at
// maxInputImages; incapable models fall back to packshot-only (issue #10 acceptance
// criterion 3 / issue #6's asset roles) -------------------------------------------------
const multiImage = mapContractToFalRequest(
  baseInput({
    assets: [BRAND_REF, PACKSHOT, STYLE_REF], // deliberately out of role order
    capability: capability({ supportsMultiImage: true, maxInputImages: 14 }),
  }),
);
assert.deepEqual(multiImage.falInput?.image_urls, [PACKSHOT.url, STYLE_REF.url, BRAND_REF.url], "packshot must be first regardless of upload order");

const cappedMultiImage = mapContractToFalRequest(
  baseInput({
    assets: [PACKSHOT, STYLE_REF, BRAND_REF],
    capability: capability({ supportsMultiImage: true, maxInputImages: 2 }),
  }),
);
assert.deepEqual(cappedMultiImage.falInput?.image_urls, [PACKSHOT.url, STYLE_REF.url]);
assert.ok(cappedMultiImage.mappingNotes.some((n) => n.includes("Dropped 1 asset(s) over the cap: brand_reference")));

const packshotFallback = mapContractToFalRequest(
  baseInput({
    assets: [PACKSHOT, STYLE_REF, BRAND_REF],
    capability: capability({ supportsMultiImage: false, maxInputImages: 1 }),
  }),
);
assert.deepEqual(packshotFallback.falInput?.image_urls, [PACKSHOT.url]);
assert.ok(packshotFallback.mappingNotes.some((n) => n.includes("falling back to a single image (packshot)")));

// generate-mode models never receive image inputs at all, even with assets uploaded
const generateModel = mapContractToFalRequest(
  baseInput({ model: MODEL_BY_KEY["nano-banana-2"], capability: capability({ modelKey: "nano-banana-2" }) }),
);
assert.equal(generateModel.falInput?.image_urls, undefined);
assert.equal(generateModel.falInput?.image_url, undefined);
assert.ok(generateModel.mappingNotes.some((n) => n.includes("generate-mode model")));

// --- an edit model with zero uploaded assets can never be mapped to a valid FAL
// request — this is exactly the fal_request_mapping_failed path (see status.ts) --------
const noAssetsOnEdit = mapContractToFalRequest(baseInput({ assets: [] }));
assert.equal(noAssetsOnEdit.falInput, null);
assert.ok(noAssetsOnEdit.errors.length > 0, "an edit model with no assets must fail mapping, not silently send an empty request");

console.log("lib/maszynka/falMapper.ts — all checks passed");
