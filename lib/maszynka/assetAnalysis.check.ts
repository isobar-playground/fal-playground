// Runnable check for lib/maszynka/assetAnalysis.ts — the new non-trivial logic issue
// #6 adds (role -> analysis-scope mapping via the request builder, and the output
// JSON-Schema validation gate that decides asset_analysis_completed vs
// asset_analysis_failed). Run with:
//   node lib/maszynka/assetAnalysis.check.ts   (or: npm run check:maszynka-asset-analysis)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import {
  ASSET_ANALYSIS_MODELS,
  DEFAULT_ASSET_ANALYSIS_MODEL,
  buildAssetAnalysisRequestBody,
  parseAssetAnalysisContent,
  validateAssetAnalysisOutput,
} from "./assetAnalysis.ts";
import { ASSET_ROLES, type AssetRole } from "./contract.ts";
import type { StagePromptsConfig } from "./configSchemas.ts";

// --- model catalog ----------------------------------------------------------
assert.ok(ASSET_ANALYSIS_MODELS.length > 0, "at least one vision + structured-output model must be offered");
assert.ok(
  ASSET_ANALYSIS_MODELS.some((m) => m.id === DEFAULT_ASSET_ANALYSIS_MODEL),
  "the default asset-analysis model must be one of the offered options",
);

// --- request building: role -> scoped system prompt -------------------------------
// Every role must produce a request whose system prompt is scoped to that role only —
// this is the acceptance-critical "role derives from the field, never from operator
// description" rule, and "reference analysis stays within its role".
for (const role of ASSET_ROLES) {
  const req = buildAssetAnalysisRequestBody({ role, url: "https://example.com/a.png" }, "test/model");
  assert.equal(req.model, "test/model");
  assert.equal(req.stream, false);
  assert.equal(req.response_format.json_schema.strict, true);
  assert.deepEqual(req.response_format.json_schema.schema.required, ["description", "attributes", "preserveElements"]);
  const systemMsg = req.messages.find((m) => m.role === "system");
  assert.ok(typeof systemMsg?.content === "string" && systemMsg.content.length > 0);
  const userMsg = req.messages.find((m) => m.role === "user");
  assert.ok(Array.isArray(userMsg?.content), "the asset image must be attached as a content-parts array");
  assert.ok(
    (userMsg!.content as { type: string }[]).some((p) => p.type === "image_url"),
    "the asset must be attached as an image_url part so a vision model can see it",
  );
}

// The packshot's system prompt must ask for preservation-critical elements; every
// reference role's system prompt must explicitly say preserveElements stays empty and
// must NOT ask for packaging/logo/label like the packshot prompt does.
const packshotReq = buildAssetAnalysisRequestBody({ role: "packshot", url: "https://x/a.png" }, "m");
const packshotSystem = packshotReq.messages.find((m) => m.role === "system")!.content as string;
assert.match(packshotSystem, /preserve/i);
assert.match(packshotSystem, /packaging/i);

const referenceRoles: AssetRole[] = ["style_reference", "brand_reference", "campaign_reference"];
for (const role of referenceRoles) {
  const req = buildAssetAnalysisRequestBody({ role, url: "https://x/a.png" }, "m");
  const system = req.messages.find((m) => m.role === "system")!.content as string;
  assert.match(system, /empty array/i, `${role} system prompt must instruct preserveElements to stay empty`);
  assert.ok(!/packagingShape/i.test(system), `${role} system prompt must not ask for packshot-only fields`);
}

// --- issue #19: composes the Contract's/config's shared base instructions with the
// role-specific instruction for the analyzed asset's role, not just the hardcoded
// defaults; omitting the config preserves the old hardcoded-only behavior -----------
const STAGE_PROMPTS: StagePromptsConfig = {
  contentSafety: { systemPrompt: "x" },
  assetAnalysis: {
    baseInstructions: "CONFIGURED base instructions.",
    roleInstructions: {
      packshot: "CONFIGURED packshot instructions.",
      style_reference: "CONFIGURED style_reference instructions.",
      brand_reference: "CONFIGURED brand_reference instructions.",
      campaign_reference: "CONFIGURED campaign_reference instructions.",
    },
  },
  promptImprovement: { systemPrompt: "x" },
  promptBuilder: { systemPrompt: "x", revisionInstructionTemplate: "x" },
  promptReviewer: { systemPrompt: "x" },
};
for (const role of ASSET_ROLES) {
  const req = buildAssetAnalysisRequestBody({ role, url: "https://x/a.png" }, "m", STAGE_PROMPTS);
  const system = req.messages.find((m) => m.role === "system")!.content as string;
  assert.ok(system.includes(STAGE_PROMPTS.assetAnalysis.baseInstructions), `${role}: must include the configured base`);
  assert.ok(
    system.includes(STAGE_PROMPTS.assetAnalysis.roleInstructions[role]),
    `${role}: must include that role's configured instruction`,
  );
}

const reqDefault = buildAssetAnalysisRequestBody({ role: "packshot", url: "https://x/a.png" }, "m");
const systemDefault = reqDefault.messages.find((m) => m.role === "system")!.content as string;
assert.ok(
  !systemDefault.includes(STAGE_PROMPTS.assetAnalysis.baseInstructions),
  "omitting stagePrompts must not accidentally pick up unrelated configured text",
);

// --- output validation --------------------------------------------------------
const GOOD_PACKSHOT_OUTPUT = {
  description: "A red running shoe on a white background.",
  attributes: [
    { key: "productType", value: "running shoe" },
    { key: "color", value: "red" },
  ],
  preserveElements: ["packaging", "color", "logo"],
};
assert.deepEqual(validateAssetAnalysisOutput(GOOD_PACKSHOT_OUTPUT), []);

const GOOD_REFERENCE_OUTPUT = {
  description: "A moody, low-key lit studio scene.",
  attributes: [{ key: "visualStyle", value: "moody, low-key" }],
  preserveElements: [],
};
assert.deepEqual(validateAssetAnalysisOutput(GOOD_REFERENCE_OUTPUT), [], "empty preserveElements is valid for a reference");

assert.ok(validateAssetAnalysisOutput(null).length, "null is not a valid output");
assert.ok(validateAssetAnalysisOutput("not an object").length);
assert.ok(
  validateAssetAnalysisOutput({ ...GOOD_PACKSHOT_OUTPUT, description: "" }).length,
  "description must be non-empty",
);
assert.ok(
  validateAssetAnalysisOutput({ ...GOOD_PACKSHOT_OUTPUT, attributes: [{ key: "", value: "x" }] }).length,
  "attributes entries must have a non-empty key",
);
assert.ok(
  validateAssetAnalysisOutput({ ...GOOD_PACKSHOT_OUTPUT, attributes: "not-an-array" }).length,
  "attributes must be an array",
);
assert.ok(
  validateAssetAnalysisOutput({ ...GOOD_PACKSHOT_OUTPUT, preserveElements: [1, 2] }).length,
  "preserveElements entries must be strings",
);

// --- parseAssetAnalysisContent: JSON parsing + validation together -------------
const parsedGood = parseAssetAnalysisContent(JSON.stringify(GOOD_PACKSHOT_OUTPUT));
assert.deepEqual(parsedGood.errors, []);
assert.equal(parsedGood.output?.description, GOOD_PACKSHOT_OUTPUT.description);

const parsedBadJson = parseAssetAnalysisContent("not json at all {");
assert.equal(parsedBadJson.output, null);
assert.ok(parsedBadJson.errors.length, "invalid JSON must fail with output = null");

const parsedBadSchema = parseAssetAnalysisContent(JSON.stringify({ description: "x" }));
assert.equal(parsedBadSchema.output, null);
assert.ok(parsedBadSchema.errors.length, "JSON missing required fields must fail with output = null");

console.log("lib/maszynka/assetAnalysis.ts — all checks passed");
