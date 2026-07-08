// Runnable check for lib/maszynka/promptBuilder.ts — the new non-trivial logic this
// slice adds (the builder's request shape and the output JSON-Schema validation gate
// that decides prompt_builder_completed vs prompt_builder_output_validation_failed).
// Run with:
//   node lib/maszynka/promptBuilder.check.ts   (or: npm run check:maszynka-prompt-builder)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import {
  DEFAULT_PROMPT_BUILDER_MODEL,
  PROMPT_BUILDER_MODELS,
  buildPromptBuilderRequestBody,
  parsePromptBuilderContent,
  validatePromptBuilderOutput,
} from "./promptBuilder.ts";
import type { Contract } from "./contract.ts";

// --- model catalog ----------------------------------------------------------
assert.ok(PROMPT_BUILDER_MODELS.length > 0, "at least one vision + structured-output model must be offered");
assert.ok(
  PROMPT_BUILDER_MODELS.some((m) => m.id === DEFAULT_PROMPT_BUILDER_MODEL),
  "the default builder model must be one of the offered options",
);

// --- request building ---------------------------------------------------------
const CONTRACT_WITH_PACKSHOT: Contract = {
  userInput: { userPromptRaw: "a red shoe on a white background" },
  assets: [
    {
      id: "asset-1",
      role: "packshot",
      url: "https://example.com/packshot.png",
      analysis: { description: "d", attributes: [], preserveElements: [] },
    },
  ],
  hook: { id: "h1", version: 1, snapshot: { id: "h1", text: "Hook" } },
  style: { id: "s1", version: 1, snapshot: null },
  cameraSetting: { id: "c1", version: 1, snapshot: null },
  globalRules: { version: 1, snapshot: [] },
  priorityLogic: { version: 1, snapshot: null },
  modelCapability: { modelKey: "nano-banana", version: 1, snapshot: null },
  generationSettings: { targetLanguage: "Polish", aspectRatio: "1:1", variantsCount: 1 },
};

const reqWithPackshot = buildPromptBuilderRequestBody(CONTRACT_WITH_PACKSHOT, "test/model");
assert.equal(reqWithPackshot.model, "test/model");
assert.equal(reqWithPackshot.stream, false);
assert.equal(reqWithPackshot.response_format.json_schema.strict, true);
assert.deepEqual(reqWithPackshot.response_format.json_schema.schema.required, [
  "finalPrompt",
  "negativePrompt",
  "promptSummary",
  "appliedRules",
  "riskNotes",
]);
const userMsg = reqWithPackshot.messages.find((m) => m.role === "user");
assert.ok(Array.isArray(userMsg?.content), "a packshot must force the content-parts array form");
assert.ok(
  (userMsg!.content as { type: string }[]).some((p) => p.type === "image_url"),
  "the packshot must be attached as an image_url part so a vision model can see it",
);

const CONTRACT_NO_PACKSHOT: Contract = { ...CONTRACT_WITH_PACKSHOT, assets: [] };
const reqNoPackshot = buildPromptBuilderRequestBody(CONTRACT_NO_PACKSHOT, "test/model");
const userMsgNoPackshot = reqNoPackshot.messages.find((m) => m.role === "user");
assert.equal(typeof userMsgNoPackshot?.content, "string", "no packshot -> plain string content, no image part");

// --- output validation --------------------------------------------------------
const GOOD_OUTPUT = {
  finalPrompt: "a red shoe on a white background, studio lighting",
  negativePrompt: "blurry, low quality",
  promptSummary: "Applied style + camera preset to the raw prompt.",
  appliedRules: ["style:s1", "camera:c1"],
  riskNotes: [],
};
assert.deepEqual(validatePromptBuilderOutput(GOOD_OUTPUT), []);

// empty negativePrompt/riskNotes are valid (nothing to flag is a legitimate outcome)
assert.deepEqual(validatePromptBuilderOutput({ ...GOOD_OUTPUT, negativePrompt: "", riskNotes: [] }), []);

assert.ok(validatePromptBuilderOutput(null).length, "null is not a valid output");
assert.ok(validatePromptBuilderOutput("not an object").length);
assert.ok(
  validatePromptBuilderOutput({ ...GOOD_OUTPUT, finalPrompt: "" }).length,
  "finalPrompt must be non-empty",
);
assert.ok(
  validatePromptBuilderOutput({ ...GOOD_OUTPUT, negativePrompt: 42 }).length,
  "negativePrompt must be a string",
);
assert.ok(
  validatePromptBuilderOutput({ ...GOOD_OUTPUT, appliedRules: "not-an-array" }).length,
  "appliedRules must be an array of strings",
);
assert.ok(
  validatePromptBuilderOutput({ ...GOOD_OUTPUT, riskNotes: [1, 2] }).length,
  "riskNotes entries must be strings",
);

// --- parsePromptBuilderContent: JSON parsing + validation together -------------
const parsedGood = parsePromptBuilderContent(JSON.stringify(GOOD_OUTPUT));
assert.deepEqual(parsedGood.errors, []);
assert.equal(parsedGood.output?.finalPrompt, GOOD_OUTPUT.finalPrompt);

const parsedBadJson = parsePromptBuilderContent("not json at all {");
assert.equal(parsedBadJson.output, null);
assert.ok(parsedBadJson.errors.length, "invalid JSON must fail with output = null");

const parsedBadSchema = parsePromptBuilderContent(JSON.stringify({ finalPrompt: "x" }));
assert.equal(parsedBadSchema.output, null);
assert.ok(parsedBadSchema.errors.length, "JSON missing required fields must fail with output = null");

console.log("lib/maszynka/promptBuilder.ts — all checks passed");
