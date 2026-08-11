// Runnable check for lib/maszynka/promptImprovement.ts — the new non-trivial logic
// issue #8 adds (the request builder's text-only shape, and the schema validation gate
// that decides whether a proposal is usable at all before the operator ever sees an
// accept/discard choice). Run with:
//   node lib/maszynka/promptImprovement.check.ts   (or: npm run check:maszynka-prompt-improvement)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import {
  PROMPT_IMPROVEMENT_MODELS,
  DEFAULT_PROMPT_IMPROVEMENT_MODEL,
  buildPromptImprovementRequestBody,
  parsePromptImprovementContent,
  validatePromptImprovementOutput,
  resolveEffectivePrompt,
} from "./promptImprovement.ts";

// --- model catalog ----------------------------------------------------------
assert.ok(PROMPT_IMPROVEMENT_MODELS.length > 0, "at least one structured-output model must be offered");
assert.ok(
  PROMPT_IMPROVEMENT_MODELS.some((m) => m.id === DEFAULT_PROMPT_IMPROVEMENT_MODEL),
  "the default prompt-improvement model must be one of the offered options",
);

// --- request building: text-only, no image parts --------------------------------
const req = buildPromptImprovementRequestBody("a red shoe on a white background", "test/model");
assert.equal(req.model, "test/model");
assert.equal(req.stream, false);
assert.equal(req.response_format.json_schema.strict, true);
assert.deepEqual(req.response_format.json_schema.schema.required, ["userPromptImproved", "rationale"]);
const userMsg = req.messages.find((m) => m.role === "user");
assert.equal(typeof userMsg?.content, "string", "this stage is text-only — no image_url parts, ever");
assert.ok((userMsg!.content as string).includes("a red shoe on a white background"));

const systemMsg = req.messages.find((m) => m.role === "system");
assert.ok(typeof systemMsg?.content === "string" && systemMsg.content.length > 0);

// --- output validation --------------------------------------------------------
const GOOD = { userPromptImproved: "A vivid red running shoe, studio-lit, on a seamless white backdrop.", rationale: "Added lighting/backdrop specificity." };
assert.deepEqual(validatePromptImprovementOutput(GOOD), []);

const GOOD_EMPTY_RATIONALE = { userPromptImproved: "A red shoe.", rationale: "" };
assert.deepEqual(validatePromptImprovementOutput(GOOD_EMPTY_RATIONALE), [], "empty rationale is valid");

assert.ok(validatePromptImprovementOutput(null).length, "null is not a valid output");
assert.ok(validatePromptImprovementOutput("not an object").length);
assert.ok(
  validatePromptImprovementOutput({ ...GOOD, userPromptImproved: "" }).length,
  "userPromptImproved must be non-empty",
);
assert.ok(
  validatePromptImprovementOutput({ ...GOOD, userPromptImproved: undefined }).length,
  "userPromptImproved is required",
);
assert.ok(validatePromptImprovementOutput({ ...GOOD, rationale: 42 }).length, "rationale must be a string");

// --- parsePromptImprovementContent: JSON parsing + validation together ------------------
const parsedGood = parsePromptImprovementContent(JSON.stringify(GOOD));
assert.deepEqual(parsedGood.errors, []);
assert.equal(parsedGood.output?.userPromptImproved, GOOD.userPromptImproved);

const parsedBadJson = parsePromptImprovementContent("not json at all {");
assert.equal(parsedBadJson.output, null);
assert.ok(parsedBadJson.errors.length, "invalid JSON must fail with output = null");

const parsedBadSchema = parsePromptImprovementContent(JSON.stringify({ rationale: "x" }));
assert.equal(parsedBadSchema.output, null);
assert.ok(parsedBadSchema.errors.length, "JSON missing required fields must fail with output = null");

// --- resolveEffectivePrompt: the accept/discard state handling (MaszynkaView's
// ImprovementState) — this is the non-trivial new logic issue #8 adds on the client
// side, extracted here so it's testable without React. ---------------------------
const RAW = "a red shoe on a white background";
const IMPROVED = "A single red running shoe centered on a seamless white backdrop, studio lighting.";
const MODEL = "openai/gpt-4o-mini";

// idle: never invoked -> raw prompt flows through, nothing recorded as used.
assert.deepEqual(resolveEffectivePrompt(RAW, { status: "idle" }, MODEL), {
  promptImprovementUsed: false,
  promptImprovementAccepted: false,
  userPromptImproved: null,
  effectivePrompt: RAW,
});

// proposed but not yet accepted -> not used/accepted yet, raw prompt still flows through
// (nothing changes until the operator explicitly accepts).
assert.deepEqual(
  resolveEffectivePrompt(RAW, { status: "proposed", sourcePromptRaw: RAW, proposal: { userPromptImproved: IMPROVED }, accepted: false }, MODEL),
  { promptImprovementUsed: true, promptImprovementAccepted: false, userPromptImproved: null, effectivePrompt: RAW },
);

// accepted -> used + accepted, the improved text is what actually flows downstream.
assert.deepEqual(
  resolveEffectivePrompt(RAW, { status: "proposed", sourcePromptRaw: RAW, proposal: { userPromptImproved: IMPROVED }, accepted: true }, MODEL),
  { promptImprovementUsed: true, promptImprovementAccepted: true, userPromptImproved: IMPROVED, effectivePrompt: IMPROVED },
);

// discarded -> `used` stays true (the operator DID use the feature) but `accepted` is
// false and the raw prompt is what flows through — this is the exact bug this check
// guards against: a naive "reset everything on discard" implementation would wrongly
// report promptImprovementUsed = false here.
assert.deepEqual(resolveEffectivePrompt(RAW, { status: "discarded", sourcePromptRaw: RAW }, MODEL), {
  promptImprovementUsed: true,
  promptImprovementAccepted: false,
  userPromptImproved: null,
  effectivePrompt: RAW,
});

// stale: the raw prompt was edited after the proposal/acceptance/discard was generated
// -> never treated as live, regardless of status, even an "accepted" one.
assert.deepEqual(
  resolveEffectivePrompt("a different prompt entirely", {
    status: "proposed",
    sourcePromptRaw: RAW,
    proposal: { userPromptImproved: IMPROVED },
    accepted: true,
  }, MODEL),
  { promptImprovementUsed: false, promptImprovementAccepted: false, userPromptImproved: null, effectivePrompt: "a different prompt entirely" },
);
assert.deepEqual(resolveEffectivePrompt("a different prompt entirely", { status: "discarded", sourcePromptRaw: RAW }, MODEL), {
  promptImprovementUsed: false,
  promptImprovementAccepted: false,
  userPromptImproved: null,
  effectivePrompt: "a different prompt entirely",
});

// error -> used (the operator did try), never accepted, raw prompt flows through.
assert.deepEqual(resolveEffectivePrompt(RAW, { status: "error", sourcePromptRaw: RAW, error: "boom" }, MODEL), {
  promptImprovementUsed: true,
  promptImprovementAccepted: false,
  userPromptImproved: null,
  effectivePrompt: RAW,
});

// model "none" (empty / omitted): feature fully disabled — even an accepted leftover
// proposal is ignored; raw prompt only, nothing recorded as used.
assert.deepEqual(
  resolveEffectivePrompt(RAW, {
    status: "proposed",
    sourcePromptRaw: RAW,
    proposal: { userPromptImproved: IMPROVED },
    accepted: true,
  }, ""),
  { promptImprovementUsed: false, promptImprovementAccepted: false, userPromptImproved: null, effectivePrompt: RAW },
);
assert.deepEqual(
  resolveEffectivePrompt(RAW, {
    status: "proposed",
    sourcePromptRaw: RAW,
    proposal: { userPromptImproved: IMPROVED },
    accepted: true,
  }),
  { promptImprovementUsed: false, promptImprovementAccepted: false, userPromptImproved: null, effectivePrompt: RAW },
);

console.log("lib/maszynka/promptImprovement.ts — all checks passed");
