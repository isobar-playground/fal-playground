// Runnable check for lib/maszynka/contentSafety.ts — the new non-trivial logic issue #7
// adds (the request builder's single-call-covers-prompt-plus-every-asset shape, and the
// four-way output JSON-Schema validation gate that decides
// content_safety_passed/allowed_with_constraints/revise_required/blocked). Run with:
//   node lib/maszynka/contentSafety.check.ts   (or: npm run check:maszynka-content-safety)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import {
  CONTENT_SAFETY_MODELS,
  DEFAULT_CONTENT_SAFETY_MODEL,
  buildContentSafetyRequestBody,
  parseContentSafetyContent,
  validateContentSafetyOutput,
} from "./contentSafety.ts";

// --- model catalog ----------------------------------------------------------
assert.ok(CONTENT_SAFETY_MODELS.length > 0, "at least one vision + structured-output model must be offered");
assert.ok(
  CONTENT_SAFETY_MODELS.some((m) => m.id === DEFAULT_CONTENT_SAFETY_MODEL),
  "the default content-safety model must be one of the offered options",
);

// --- request building: one call covers the prompt + every asset at once -------------
const reqNoAssets = buildContentSafetyRequestBody("a red shoe on a white background", [], "test/model");
assert.equal(reqNoAssets.model, "test/model");
assert.equal(reqNoAssets.stream, false);
assert.equal(reqNoAssets.response_format.json_schema.strict, true);
assert.deepEqual(reqNoAssets.response_format.json_schema.schema.required, ["status", "reasons", "constraints"]);
const userMsgNoAssets = reqNoAssets.messages.find((m) => m.role === "user");
assert.equal(typeof userMsgNoAssets?.content, "string", "no assets -> plain string content, no image parts");

const assets = [
  { role: "packshot" as const, url: "https://example.com/packshot.png" },
  { role: "style_reference" as const, url: "https://example.com/style.png" },
];
const reqWithAssets = buildContentSafetyRequestBody("a red shoe on a white background", assets, "test/model");
const userMsgWithAssets = reqWithAssets.messages.find((m) => m.role === "user");
assert.ok(Array.isArray(userMsgWithAssets?.content), "uploaded assets must force the content-parts array form");
const imageParts = (userMsgWithAssets!.content as { type: string }[]).filter((p) => p.type === "image_url");
assert.equal(imageParts.length, assets.length, "every uploaded asset must be attached as its own image_url part");

// --- output validation --------------------------------------------------------
const GOOD_PASSED = { status: "content_safety_passed", reasons: [], constraints: [] };
assert.deepEqual(validateContentSafetyOutput(GOOD_PASSED), []);

const GOOD_ALLOWED_WITH_CONSTRAINTS = {
  status: "content_safety_allowed_with_constraints",
  reasons: ["prompt implies alcohol branding"],
  constraints: ["no visible alcohol branding on the generated asset"],
};
assert.deepEqual(validateContentSafetyOutput(GOOD_ALLOWED_WITH_CONSTRAINTS), []);

const GOOD_REVISE_REQUIRED = {
  status: "content_safety_revise_required",
  reasons: ["prompt makes an unverified medical claim"],
  constraints: [],
};
assert.deepEqual(validateContentSafetyOutput(GOOD_REVISE_REQUIRED), []);

const GOOD_BLOCKED = { status: "content_safety_blocked", reasons: ["depicts illegal activity"], constraints: [] };
assert.deepEqual(validateContentSafetyOutput(GOOD_BLOCKED), []);

assert.ok(validateContentSafetyOutput(null).length, "null is not a valid output");
assert.ok(validateContentSafetyOutput("not an object").length);
assert.ok(
  validateContentSafetyOutput({ ...GOOD_PASSED, status: "not_a_real_status" }).length,
  "status must be one of the four defined statuses",
);
assert.ok(
  validateContentSafetyOutput({ ...GOOD_PASSED, reasons: "not-an-array" }).length,
  "reasons must be an array of strings",
);
assert.ok(
  validateContentSafetyOutput({ ...GOOD_PASSED, constraints: [1, 2] }).length,
  "constraints entries must be strings",
);

// --- parseContentSafetyContent: JSON parsing + validation together ------------------
const parsedGood = parseContentSafetyContent(JSON.stringify(GOOD_ALLOWED_WITH_CONSTRAINTS));
assert.deepEqual(parsedGood.errors, []);
assert.equal(parsedGood.output?.status, "content_safety_allowed_with_constraints");
assert.deepEqual(parsedGood.output?.constraints, GOOD_ALLOWED_WITH_CONSTRAINTS.constraints);

const parsedBadJson = parseContentSafetyContent("not json at all {");
assert.equal(parsedBadJson.output, null);
assert.ok(parsedBadJson.errors.length, "invalid JSON must fail with output = null");

const parsedBadSchema = parseContentSafetyContent(JSON.stringify({ status: "content_safety_passed" }));
assert.equal(parsedBadSchema.output, null);
assert.ok(parsedBadSchema.errors.length, "JSON missing required fields must fail with output = null");

console.log("lib/maszynka/contentSafety.ts — all checks passed");
