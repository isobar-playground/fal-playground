// Runnable check for lib/maszynka/stagePromptRestore.ts — per-prompt Stage prompt
// restore and the Content safety save-warning decision (issue #23 / PRD stories 21,
// 27-28). Run with:
//   node lib/maszynka/stagePromptRestore.check.ts   (or: npm run check:maszynka-stage-prompt-restore)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import { restoreStagePromptSlot, shouldWarnOnContentSafetySave, STAGE_PROMPT_SLOTS } from "./stagePromptRestore.ts";
import { validateConfigBody, type StagePromptsConfig } from "./configSchemas.ts";

const CURRENT: StagePromptsConfig = {
  contentSafety: { systemPrompt: "current: content safety" },
  assetAnalysis: {
    baseInstructions: "current: base",
    roleInstructions: {
      packshot: "current: packshot",
      style_reference: "current: style_reference",
      brand_reference: "current: brand_reference",
      campaign_reference: "current: campaign_reference",
    },
  },
  promptImprovement: { systemPrompt: "current: prompt improvement" },
  promptBuilder: { systemPrompt: "current: prompt builder", revisionInstructionTemplate: "current: revision" },
  promptReviewer: { systemPrompt: "current: prompt reviewer" },
};

const HISTORICAL: StagePromptsConfig = {
  contentSafety: { systemPrompt: "historical: content safety" },
  assetAnalysis: {
    baseInstructions: "historical: base",
    roleInstructions: {
      packshot: "historical: packshot",
      style_reference: "historical: style_reference",
      brand_reference: "historical: brand_reference",
      campaign_reference: "historical: campaign_reference",
    },
  },
  promptImprovement: { systemPrompt: "historical: prompt improvement" },
  promptBuilder: { systemPrompt: "historical: prompt builder", revisionInstructionTemplate: "historical: revision" },
  promptReviewer: { systemPrompt: "historical: prompt reviewer" },
};

// --- STAGE_PROMPT_SLOTS covers exactly the five StagePromptsConfig keys, once each ------
{
  const slots = STAGE_PROMPT_SLOTS.map((s) => s.slot).sort();
  const expected = [
    "assetAnalysis",
    "contentSafety",
    "promptBuilder",
    "promptImprovement",
    "promptReviewer",
  ].sort();
  assert.deepEqual(slots, expected);
}

// --- restore copies exactly one slot, leaves every other slot untouched -----------------
for (const { slot } of STAGE_PROMPT_SLOTS) {
  const restored = restoreStagePromptSlot(CURRENT, HISTORICAL, slot);
  assert.deepEqual(restored[slot], HISTORICAL[slot], `restoring ${slot} pulls in the historical content`);
  for (const other of STAGE_PROMPT_SLOTS.map((s) => s.slot)) {
    if (other === slot) continue;
    assert.deepEqual(restored[other], CURRENT[other], `restoring ${slot} must not touch ${other}`);
  }
  // Result is still a schema-valid stage_prompts body — a partial/malformed restore
  // could otherwise slip past client-side validation straight into "Save".
  assert.deepEqual(validateConfigBody("stage_prompts", restored), []);
}

// --- assetAnalysis restore is whole-object: base AND every role move together ----------
{
  const restored = restoreStagePromptSlot(CURRENT, HISTORICAL, "assetAnalysis");
  assert.equal(restored.assetAnalysis.baseInstructions, "historical: base");
  assert.equal(restored.assetAnalysis.roleInstructions.packshot, "historical: packshot");
  assert.equal(restored.assetAnalysis.roleInstructions.campaign_reference, "historical: campaign_reference");
}

// --- promptBuilder restore is whole-object: main prompt AND revision template together --
{
  const restored = restoreStagePromptSlot(CURRENT, HISTORICAL, "promptBuilder");
  assert.equal(restored.promptBuilder.systemPrompt, "historical: prompt builder");
  assert.equal(restored.promptBuilder.revisionInstructionTemplate, "historical: revision");
}

// --- restore is pure: never mutates either input --------------------------------------
{
  const currentSnapshot = JSON.parse(JSON.stringify(CURRENT));
  const historicalSnapshot = JSON.parse(JSON.stringify(HISTORICAL));
  restoreStagePromptSlot(CURRENT, HISTORICAL, "contentSafety");
  assert.deepEqual(CURRENT, currentSnapshot, "current must not be mutated");
  assert.deepEqual(HISTORICAL, historicalSnapshot, "historical must not be mutated");
}

// --- Content safety save warning: fires only on an actual change ----------------------
assert.equal(shouldWarnOnContentSafetySave("same text", "same text"), false, "unchanged text never warns");
assert.equal(shouldWarnOnContentSafetySave("old text", "new text"), true, "a real edit warns");
assert.equal(
  shouldWarnOnContentSafetySave("  padded text  ", "padded text"),
  false,
  "leading/trailing whitespace-only differences don't count as a change",
);
assert.equal(shouldWarnOnContentSafetySave("", "first content safety prompt ever set"), true, "first-ever text counts as a change");
assert.equal(shouldWarnOnContentSafetySave("", ""), false, "blank-vs-blank never warns");

console.log("lib/maszynka/stagePromptRestore.check.ts — all checks passed");
