// Runnable check for lib/maszynka/contract.ts — the new non-trivial logic this slice
// adds (Contract assembly + the JSON validation gate before the Prompt builder). Run
// with:
//   node lib/maszynka/contract.check.ts   (or: npm run check:maszynka-contract)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { assembleContract, validateContract, type AssembleContractInput } from "./contract.ts";
import type {
  CameraSettingConfig,
  GlobalRuleConfig,
  HookConfig,
  ModelCapabilityEntry,
  PriorityLogicConfig,
  StyleConfig,
} from "./configSchemas.ts";

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
    packshotUrl: "https://example.com/packshot.png",
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

// --- no packshot uploaded -> no packshot asset, contract is still otherwise valid -----
const noPackshot = assembleContract(baseInput({ packshotUrl: null }));
assert.deepEqual(noPackshot.assets, []);
assert.deepEqual(validateContract(noPackshot), []);

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
