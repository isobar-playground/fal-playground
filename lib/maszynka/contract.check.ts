// Runnable check for lib/maszynka/contract.ts — the new non-trivial logic this slice
// adds (Contract assembly + the JSON validation gate before the Prompt builder). Run
// with:
//   node lib/maszynka/contract.check.ts   (or: npm run check:maszynka-contract)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { assembleContract, validateContract, type AssembleContractInput, type ContractAsset } from "./contract.ts";
import type {
  CameraSettingConfig,
  GlobalRuleConfig,
  HookConfig,
  ModelCapabilityEntry,
  PriorityLogicConfig,
  StyleConfig,
} from "./configSchemas.ts";
import type { AssetAnalysisOutput } from "./assetAnalysis.ts";

const ANALYSIS: AssetAnalysisOutput = {
  description: "A red running shoe on a white background.",
  attributes: [{ key: "color", value: "red" }],
  preserveElements: ["packaging", "logo"],
};
const PACKSHOT_ASSET: ContractAsset = {
  id: "asset-1",
  role: "packshot",
  url: "https://example.com/packshot.png",
  analysis: ANALYSIS,
};

const HOOKS: HookConfig[] = [{ id: "h1", text: "Hook text" }];
const STYLES: StyleConfig[] = [
  {
    styleId: "s1",
    styleName: "S",
    visualIntent: "i",
    lighting: "l",
    colorDirection: "c",
    compositionBias: "b",
    typographyBehavior: "t",
    avoid: [],
    recommendedModels: [],
    scoringCriteria: [],
  },
];
const CAMERAS: CameraSettingConfig[] = [
  {
    cameraSettingId: "c1",
    cameraSettingName: "C",
    cameraIntent: "i",
    shotType: "s",
    framing: "f",
    angle: "a",
    cameraDistance: "d",
    lensFeel: "l",
    motionIntensity: "m",
    stability: "st",
    imageTranslation: "it",
    avoid: [],
    recommendedModels: [],
    scoringCriteria: [],
  },
];
const GLOBAL_RULES: GlobalRuleConfig[] = [{ id: "g1", name: "G", description: "d" }];
const PRIORITY_LOGIC: PriorityLogicConfig = { layers: [{ id: "p1", label: "P" }] };
const CAPABILITY: ModelCapabilityEntry[] = [
  {
    modelKey: "nano-banana",
    modelId: "fal-ai/nano-banana",
    modelLabel: "Nano Banana",
    supportsNegativePrompt: false,
    supportsSeed: true,
    maxInputImages: 0,
    supportsMultiImage: false,
  },
];

function baseInput(overrides: Partial<AssembleContractInput> = {}): AssembleContractInput {
  return {
    userPromptRaw: "a red shoe on a white background",
    assets: [PACKSHOT_ASSET],
    hooks: { version: 3, body: HOOKS },
    selectedHookId: "h1",
    styles: { version: 1, body: STYLES },
    selectedStyleId: "s1",
    cameraSettings: { version: 1, body: CAMERAS },
    selectedCameraSettingId: "c1",
    globalRules: { version: 2, body: GLOBAL_RULES },
    priorityLogic: { version: 1, body: PRIORITY_LOGIC },
    modelCapabilityMatrix: { version: 1, body: CAPABILITY },
    modelKey: "nano-banana",
    targetLanguage: "Polish",
    aspectRatio: "1:1",
    variantsCount: 2,
    ...overrides,
  };
}

// --- a fully-formed contract is valid and carries the exact versions/snapshots used ---
const good = assembleContract(baseInput());
assert.deepEqual(validateContract(good), []);
assert.equal(good.hook.version, 3, "contract must carry the exact config version used, not just its id");
assert.equal(good.hook.snapshot?.text, "Hook text", "contract must carry the config snapshot, not just an id");
assert.equal(good.modelCapability.snapshot?.modelKey, "nano-banana");
assert.equal(good.assets[0]?.role, "packshot");
assert.equal(good.assets[0]?.url, "https://example.com/packshot.png");
assert.equal(good.assets[0]?.analysis?.description, ANALYSIS.description, "contract must carry the asset's analysis output");

// --- no assets uploaded -> empty assets array, contract is still otherwise valid ------
const noAssets = assembleContract(baseInput({ assets: [] }));
assert.deepEqual(noAssets.assets, []);
assert.deepEqual(validateContract(noAssets), []);

// --- multiple roles, all optional per spec section 3 (packshot + every reference) -----
const allRoles: ContractAsset[] = [
  PACKSHOT_ASSET,
  { id: "asset-2", role: "style_reference", url: "https://example.com/style.png", analysis: ANALYSIS },
  { id: "asset-3", role: "brand_reference", url: "https://example.com/brand.png", analysis: ANALYSIS },
  { id: "asset-4", role: "campaign_reference", url: "https://example.com/campaign.png", analysis: ANALYSIS },
];
const fullAssets = assembleContract(baseInput({ assets: allRoles }));
assert.equal(fullAssets.assets.length, 4);
assert.deepEqual(validateContract(fullAssets), []);

// --- an asset missing its Asset analysis output fails validation (issue #6: the
// Contract must never be assembled from raw uploads alone) ---------------------------
const missingAnalysis = assembleContract(
  baseInput({ assets: [{ ...PACKSHOT_ASSET, analysis: null }] }),
);
assert.ok(
  validateContract(missingAnalysis).length,
  "an asset with no Asset analysis output must fail Contract validation",
);

// --- a malformed asset (no id/url, or an unknown role) also fails validation ----------
assert.ok(
  validateContract(assembleContract(baseInput({ assets: [{ ...PACKSHOT_ASSET, id: "" }] }))).length,
  "an asset with no id must fail validation",
);
assert.ok(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validateContract(assembleContract(baseInput({ assets: [{ ...PACKSHOT_ASSET, role: "not-a-role" as any }] })))
    .length,
  "an asset with an unknown role must fail validation",
);

// --- an unresolvable selection produces a null snapshot, which fails validation -------
const badHook = assembleContract(baseInput({ selectedHookId: "does-not-exist" }));
assert.equal(badHook.hook.snapshot, null);
assert.ok(validateContract(badHook).length, "an unresolved hook id must fail validation");

const badStyle = assembleContract(baseInput({ selectedStyleId: "does-not-exist" }));
assert.ok(validateContract(badStyle).length, "an unresolved style id must fail validation");

const badCamera = assembleContract(baseInput({ selectedCameraSettingId: "does-not-exist" }));
assert.ok(validateContract(badCamera).length, "an unresolved camera setting id must fail validation");

const badModel = assembleContract(baseInput({ modelKey: "unknown-model" }));
assert.ok(
  validateContract(badModel).length,
  "a model missing from the capability matrix must fail validation — this is exactly the " +
    "prompt_builder_contract_validation_failed path the run status machine needs",
);

// --- malformed generation settings / user input fail validation too -------------------
assert.ok(validateContract(assembleContract(baseInput({ userPromptRaw: "   " }))).length, "a blank prompt must fail");
assert.ok(validateContract(assembleContract(baseInput({ variantsCount: 0 }))).length, "variantsCount must be >= 1");
assert.ok(validateContract(assembleContract(baseInput({ aspectRatio: "" }))).length, "aspectRatio must be non-empty");
assert.ok(
  validateContract(assembleContract(baseInput({ globalRules: { version: 1, body: [] } }))).length,
  "global rules must be a non-empty snapshot",
);

console.log("lib/maszynka/contract.ts — all checks passed");
