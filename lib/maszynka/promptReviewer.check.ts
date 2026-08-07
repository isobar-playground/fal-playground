// Runnable check for lib/maszynka/promptReviewer.ts — the new non-trivial logic this
// slice adds (the reviewer's request shape, including the packshot image attachment,
// and the output JSON-Schema validation gate that decides pass/revise/failed vs an
// unparseable response). Run with:
//   node lib/maszynka/promptReviewer.check.ts   (or: npm run check:maszynka-prompt-reviewer)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import {
  DEFAULT_PROMPT_REVIEWER_MODEL,
  PROMPT_REVIEWER_MODELS,
  buildPromptReviewerRequestBody,
  parsePromptReviewerContent,
  validatePromptReviewerOutput,
} from "./promptReviewer.ts";
import type { Contract } from "./contract.ts";
import type { PromptBuilderOutput } from "./promptBuilder.ts";
import type { StagePromptsConfig } from "./configSchemas.ts";

// --- model catalog ----------------------------------------------------------
assert.ok(PROMPT_REVIEWER_MODELS.length > 0, "at least one vision + structured-output model must be offered");
assert.ok(
  PROMPT_REVIEWER_MODELS.some((m) => m.id === DEFAULT_PROMPT_REVIEWER_MODEL),
  "the default reviewer model must be one of the offered options",
);

// --- request building ---------------------------------------------------------
// issue #19: a stage_prompts snapshot with distinctive reviewer text, so tests below can
// assert the request actually used the *configured* system prompt rather than the
// module's hardcoded default.
const STAGE_PROMPTS: StagePromptsConfig = {
  contentSafety: { systemPrompt: "x" },
  assetAnalysis: {
    baseInstructions: "x",
    roleInstructions: { packshot: "x", style_reference: "x", brand_reference: "x", campaign_reference: "x" },
  },
  promptImprovement: { systemPrompt: "x" },
  promptBuilder: { systemPrompt: "x", revisionInstructionTemplate: "x" },
  promptReviewer: { systemPrompt: "CONFIGURED reviewer system prompt — gate the builder output." },
};

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
  safetyConstraints: [],
  hook: { id: "h1", version: 1, snapshot: { id: "h1", text: "Hook" } },
  style: { id: "s1", version: 1, snapshot: null },
  cameraSetting: { id: "c1", version: 1, snapshot: null },
  lighting: { id: "l1", version: 1, snapshot: null },
  globalRules: { version: 1, snapshot: [] },
  priorityLogic: { version: 1, snapshot: null },
  modelCapability: { modelKey: "nano-banana", version: 1, snapshot: null },
  stagePrompts: { version: 1, snapshot: STAGE_PROMPTS },
  generationSettings: { aspectRatio: "1:1", variantsCount: 1 },
};

const BUILDER_OUTPUT: PromptBuilderOutput = {
  finalPrompt: "a red shoe on a white background, studio lighting",
  negativePrompt: "blurry, low quality",
  promptSummary: "Applied style + camera preset to the raw prompt.",
  appliedRules: ["style:s1", "camera:c1"],
  riskNotes: [],
};

const reqWithPackshot = buildPromptReviewerRequestBody(CONTRACT_WITH_PACKSHOT, BUILDER_OUTPUT, "test/model");
assert.equal(reqWithPackshot.model, "test/model");
assert.equal(reqWithPackshot.stream, false);
assert.equal(reqWithPackshot.response_format.json_schema.strict, true);
assert.deepEqual(reqWithPackshot.response_format.json_schema.schema.required, ["status", "issues", "revisionInstruction"]);
const userMsg = reqWithPackshot.messages.find((m) => m.role === "user");
assert.ok(Array.isArray(userMsg?.content), "a packshot must force the content-parts array form");
assert.ok(
  (userMsg!.content as { type: string }[]).some((p) => p.type === "image_url"),
  "the packshot must be attached as an image_url part so a vision model can cross-check it",
);

const CONTRACT_NO_PACKSHOT: Contract = { ...CONTRACT_WITH_PACKSHOT, assets: [] };
const reqNoPackshot = buildPromptReviewerRequestBody(CONTRACT_NO_PACKSHOT, BUILDER_OUTPUT, "test/model");
const userMsgNoPackshot = reqNoPackshot.messages.find((m) => m.role === "user");
assert.equal(typeof userMsgNoPackshot?.content, "string", "no packshot -> plain string content, no image part");

// --- issue #19: the request builder must use the Contract's configured stage_prompts
// text, never only the hardcoded default -------------------------------------------
const systemMsg = reqWithPackshot.messages.find((m) => m.role === "system");
assert.equal(
  systemMsg?.content,
  STAGE_PROMPTS.promptReviewer.systemPrompt,
  "the reviewer's system prompt must be the Contract's configured promptReviewer.systemPrompt",
);

const CONTRACT_NO_STAGE_PROMPTS: Contract = { ...CONTRACT_WITH_PACKSHOT, stagePrompts: { version: 0, snapshot: null } };
const reqFallback = buildPromptReviewerRequestBody(CONTRACT_NO_STAGE_PROMPTS, BUILDER_OUTPUT, "test/model");
const fallbackSystemMsg = reqFallback.messages.find((m) => m.role === "system");
assert.ok(
  typeof fallbackSystemMsg?.content === "string" && fallbackSystemMsg.content.length > 0,
  "with no stage_prompts snapshot, the reviewer must still fall back to its hardcoded default system prompt",
);
assert.notEqual(
  fallbackSystemMsg?.content,
  STAGE_PROMPTS.promptReviewer.systemPrompt,
  "the fallback system prompt must not be the configured one from the other Contract",
);

// --- output validation --------------------------------------------------------
const PASS_OUTPUT = { status: "pass", issues: [], revisionInstruction: "" };
assert.deepEqual(validatePromptReviewerOutput(PASS_OUTPUT), []);

const REVISE_OUTPUT = {
  status: "revise",
  issues: ["Hook text was dropped from finalPrompt"],
  revisionInstruction: "Re-add the exact Hook text verbatim.",
};
assert.deepEqual(validatePromptReviewerOutput(REVISE_OUTPUT), []);

const FAILED_OUTPUT = { status: "failed", issues: ["Content safety violation"], revisionInstruction: "" };
assert.deepEqual(validatePromptReviewerOutput(FAILED_OUTPUT), []);

assert.ok(validatePromptReviewerOutput(null).length, "null is not a valid output");
assert.ok(validatePromptReviewerOutput("not an object").length);
assert.ok(
  validatePromptReviewerOutput({ ...PASS_OUTPUT, status: "maybe" }).length,
  "status must be one of pass/revise/failed",
);
assert.ok(
  validatePromptReviewerOutput({ ...PASS_OUTPUT, issues: "not-an-array" }).length,
  "issues must be an array of strings",
);
assert.ok(
  validatePromptReviewerOutput({ ...PASS_OUTPUT, revisionInstruction: 42 }).length,
  "revisionInstruction must be a string",
);

// --- parsePromptReviewerContent: JSON parsing + validation together -------------
const parsedGood = parsePromptReviewerContent(JSON.stringify(REVISE_OUTPUT));
assert.deepEqual(parsedGood.errors, []);
assert.equal(parsedGood.output?.status, "revise");

const parsedBadJson = parsePromptReviewerContent("not json at all {");
assert.equal(parsedBadJson.output, null);
assert.ok(parsedBadJson.errors.length, "invalid JSON must fail with output = null");

const parsedBadSchema = parsePromptReviewerContent(JSON.stringify({ status: "pass" }));
assert.equal(parsedBadSchema.output, null);
assert.ok(parsedBadSchema.errors.length, "JSON missing required fields must fail with output = null");

console.log("lib/maszynka/promptReviewer.ts — all checks passed");
