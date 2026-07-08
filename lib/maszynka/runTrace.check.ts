// Runnable check for lib/maszynka/runTrace.ts — the run detail view's "selected configs +
// versions" summarizer (issue #12). Run with:
//   node lib/maszynka/runTrace.check.ts   (or: npm run check:maszynka-run-trace)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { summarizeSelectedConfigs } from "./runTrace.ts";
import type { Contract } from "./contract.ts";

// --- a run that never reached the Contract stage (e.g. blocked at content safety, or a
// slice-1/2 run from before the Contract stage existed) must render as "nothing to show",
// not throw. ---
assert.deepEqual(summarizeSelectedConfigs(null), []);
assert.deepEqual(summarizeSelectedConfigs(undefined), []);

// --- a fully-resolved Contract summarizes every kind with its real name + version ---
const fullContract: Contract = {
  userInput: { userPromptRaw: "test" },
  assets: [],
  safetyConstraints: [],
  hook: { id: "hook-1", version: 3, snapshot: { id: "hook-1", text: "Read this twice" } },
  style: {
    id: "style-1",
    version: 2,
    snapshot: {
      styleId: "style-1",
      styleName: "Clean studio",
      visualIntent: "",
      lighting: "",
      colorDirection: "",
      compositionBias: "",
      typographyBehavior: "",
      avoid: [],
      recommendedModels: [],
      scoringCriteria: [],
    },
  },
  cameraSetting: {
    id: "cam-1",
    version: 1,
    snapshot: {
      cameraSettingId: "cam-1",
      cameraSettingName: "Eye-level product shot",
      cameraIntent: "",
      shotType: "",
      framing: "",
      angle: "",
      cameraDistance: "",
      lensFeel: "",
      motionIntensity: "",
      stability: "",
      imageTranslation: "",
      avoid: [],
      recommendedModels: [],
      scoringCriteria: [],
    },
  },
  globalRules: { version: 5, snapshot: [{ id: "g1", name: "Safety", description: "" }] },
  priorityLogic: { version: 1, snapshot: { layers: [{ id: "l1", label: "Content safety" }, { id: "l2", label: "Product" }] } },
  modelCapability: {
    modelKey: "nano-banana",
    version: 4,
    snapshot: {
      modelKey: "nano-banana",
      modelId: "fal-ai/nano-banana",
      modelLabel: "Nano Banana",
      supportsNegativePrompt: true,
      supportsSeed: true,
      maxInputImages: 1,
      supportsMultiImage: false,
    },
  },
  generationSettings: { targetLanguage: "Polish", aspectRatio: "1:1", variantsCount: 1 },
};

const full = summarizeSelectedConfigs(fullContract);
assert.equal(full.length, 6, "every one of the six config kinds must be summarized");
assert.deepEqual(
  full.find((i) => i.kind === "hook"),
  { kind: "hook", id: "hook-1", version: 3, label: "Read this twice", resolved: true },
);
assert.deepEqual(
  full.find((i) => i.kind === "style"),
  { kind: "style", id: "style-1", version: 2, label: "Clean studio", resolved: true },
);
assert.deepEqual(
  full.find((i) => i.kind === "cameraSetting"),
  { kind: "cameraSetting", id: "cam-1", version: 1, label: "Eye-level product shot", resolved: true },
);
assert.deepEqual(
  full.find((i) => i.kind === "globalRules"),
  { kind: "globalRules", id: "", version: 5, label: "1 rule", resolved: true },
);
assert.deepEqual(
  full.find((i) => i.kind === "priorityLogic"),
  { kind: "priorityLogic", id: "", version: 1, label: "2 layers", resolved: true },
);
assert.deepEqual(
  full.find((i) => i.kind === "modelCapability"),
  { kind: "modelCapability", id: "nano-banana", version: 4, label: "Nano Banana", resolved: true },
);

// --- an unresolved selection (snapshot null — id didn't match anything in that config
// version's body) must be flagged, never crash --------------------------------------
const unresolvedContract: Contract = {
  ...fullContract,
  hook: { id: "deleted-hook", version: 3, snapshot: null },
  globalRules: { version: 5, snapshot: [] },
  priorityLogic: { version: 1, snapshot: null },
};
const partial = summarizeSelectedConfigs(unresolvedContract);
assert.deepEqual(
  partial.find((i) => i.kind === "hook"),
  { kind: "hook", id: "deleted-hook", version: 3, label: "(unresolved)", resolved: false },
);
assert.deepEqual(
  partial.find((i) => i.kind === "globalRules"),
  { kind: "globalRules", id: "", version: 5, label: "0 rules", resolved: false },
);
assert.deepEqual(
  partial.find((i) => i.kind === "priorityLogic"),
  { kind: "priorityLogic", id: "", version: 1, label: "0 layers", resolved: false },
);
// style/cameraSetting/modelCapability were untouched by the spread above — still resolved
assert.equal(partial.find((i) => i.kind === "style")?.resolved, true);

console.log("lib/maszynka/runTrace.ts — all checks passed");
