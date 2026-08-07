// Runnable check for lib/maszynka-video/planner.ts — the Planner request builder
// (issue #25 acceptance: json_object + reasoning.effort always sent; 0/empty
// max_tokens / temperature / top_p omitted entirely). Run with:
//   node lib/maszynka-video/planner.check.ts   (or: npm run check:maszynka-video-planner)
// No test framework in this repo by design — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import { DEFAULT_PLANNER_CONFIG, buildPlannerRequestBody, type PlannerConfig } from "./planner.ts";

const BASE: PlannerConfig = {
  ...DEFAULT_PLANNER_CONFIG,
  systemPrompt: "You are the planner.",
  inputJson: '{"targetFinalDurationSeconds": 12}',
};
const NO_COMMON = { globalRules: "", priorityLogic: "" };

// --- response_format json_object + reasoning.effort are ALWAYS sent ------------------
const bare = buildPlannerRequestBody(BASE, NO_COMMON);
assert.deepEqual(bare.response_format, { type: "json_object" });
assert.deepEqual(bare.reasoning, { effort: "medium" });
assert.equal(bare.stream, false);
assert.equal(bare.model, "openai/gpt-5.6-luna");

// --- empty/zero knobs are omitted from the request entirely --------------------------
assert.ok(!("max_tokens" in bare), "empty max_tokens must be omitted");
assert.ok(!("temperature" in bare), "empty temperature must be omitted");
assert.ok(!("top_p" in bare), "empty top_p must be omitted");
const zeros = buildPlannerRequestBody({ ...BASE, maxTokens: "0", temperature: "0", topP: "0" }, NO_COMMON);
assert.ok(!("max_tokens" in zeros), "zero max_tokens must be omitted (PRD: 0/empty = omit)");
assert.ok(!("temperature" in zeros), "zero temperature must be omitted");
assert.ok(!("top_p" in zeros), "zero top_p must be omitted");

// --- filled knobs are sent as numbers ------------------------------------------------
const filled = buildPlannerRequestBody({ ...BASE, maxTokens: "4000", temperature: "0.2", topP: "0.9" }, NO_COMMON);
assert.equal(filled.max_tokens, 4000);
assert.equal(filled.temperature, 0.2);
assert.equal(filled.top_p, 0.9);

// --- messages: pasted system prompt first, then the input JSON as the user message ---
assert.deepEqual(bare.messages, [
  { role: "system", content: "You are the planner." },
  { role: "user", content: '{"targetFinalDurationSeconds": 12}' },
]);

// --- non-empty common fields ride along as their own verbatim system messages --------
const withCommon = buildPlannerRequestBody(BASE, { globalRules: "No competitor logos.", priorityLogic: "safety first" });
assert.deepEqual(
  withCommon.messages.map((m) => m.role),
  ["system", "system", "system", "user"],
);
assert.equal(withCommon.messages[1].content, "No competitor logos.");
assert.equal(withCommon.messages[2].content, "safety first");

// --- reference files become image parts alongside the input JSON (issue #26) ---------
const withRefs = buildPlannerRequestBody(BASE, NO_COMMON, ["https://v3.fal.media/files/a.png"]);
const userContent = withRefs.messages.at(-1)!.content;
assert.deepEqual(userContent, [
  { type: "text", text: '{"targetFinalDurationSeconds": 12}' },
  { type: "image_url", image_url: { url: "https://v3.fal.media/files/a.png" } },
]);

console.log("lib/maszynka-video/planner.ts — all checks passed");
