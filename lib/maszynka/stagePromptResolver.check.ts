// Runnable check for lib/maszynka/stagePromptResolver.ts — the Stage prompt resolver
// (issue #19 / PRD story 33) that turns a `stage_prompts` config snapshot plus stage
// parameters into the exact instruction text each stage's request builder sends. Run
// with:
//   node lib/maszynka/stagePromptResolver.check.ts   (or: npm run check:maszynka-stage-prompt-resolver)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import {
  resolveAssetAnalysisSystemPrompt,
  resolveContentSafetySystemPrompt,
  resolvePromptBuilderRevisionInstruction,
  resolvePromptBuilderSystemPrompt,
  resolvePromptImprovementSystemPrompt,
  resolvePromptReviewerSystemPrompt,
} from "./stagePromptResolver.ts";
import type { StagePromptsConfig } from "./configSchemas.ts";

const CONFIG: StagePromptsConfig = {
  contentSafety: { systemPrompt: "Configured content safety instructions." },
  assetAnalysis: {
    baseInstructions: "Configured base instructions.",
    roleInstructions: {
      packshot: "Configured packshot instructions.",
      style_reference: "Configured style_reference instructions.",
      brand_reference: "Configured brand_reference instructions.",
      campaign_reference: "Configured campaign_reference instructions.",
    },
  },
  promptImprovement: { systemPrompt: "Configured prompt improvement instructions." },
  promptBuilder: {
    systemPrompt: "Configured prompt builder instructions.",
    revisionInstructionTemplate: "Configured revision. Issues: {{issues}}. Instruction: {{revisionInstruction}}.",
  },
  promptReviewer: { systemPrompt: "Configured prompt reviewer instructions." },
};

// --- single-field stages: configured text wins over the fallback --------------------
assert.equal(resolveContentSafetySystemPrompt(CONFIG, "fallback"), CONFIG.contentSafety.systemPrompt);
assert.equal(resolvePromptImprovementSystemPrompt(CONFIG, "fallback"), CONFIG.promptImprovement.systemPrompt);
assert.equal(resolvePromptBuilderSystemPrompt(CONFIG, "fallback"), CONFIG.promptBuilder.systemPrompt);
assert.equal(resolvePromptReviewerSystemPrompt(CONFIG, "fallback"), CONFIG.promptReviewer.systemPrompt);

// --- no config / undefined config / blank field -> fallback text -------------------
assert.equal(resolveContentSafetySystemPrompt(null, "fallback"), "fallback");
assert.equal(resolveContentSafetySystemPrompt(undefined, "fallback"), "fallback");
assert.equal(
  resolveContentSafetySystemPrompt({ ...CONFIG, contentSafety: { systemPrompt: "   " } }, "fallback"),
  "fallback",
  "a blank (whitespace-only) configured field must fall back, never send blank instructions to the model",
);

// --- asset analysis: composes shared base + role-specific block, one call per role ---
const FALLBACK_BASE = "fallback base";
const FALLBACK_ROLES = {
  packshot: "fallback packshot",
  style_reference: "fallback style",
  brand_reference: "fallback brand",
  campaign_reference: "fallback campaign",
};
for (const role of ["packshot", "style_reference", "brand_reference", "campaign_reference"] as const) {
  const resolved = resolveAssetAnalysisSystemPrompt(CONFIG, role, FALLBACK_BASE, FALLBACK_ROLES);
  assert.ok(resolved.includes(CONFIG.assetAnalysis.baseInstructions), `${role}: must include the configured base`);
  assert.ok(
    resolved.includes(CONFIG.assetAnalysis.roleInstructions[role]),
    `${role}: must include that role's configured instruction, not another role's`,
  );
  for (const otherRole of ["packshot", "style_reference", "brand_reference", "campaign_reference"] as const) {
    if (otherRole === role) continue;
    assert.ok(
      !resolved.includes(CONFIG.assetAnalysis.roleInstructions[otherRole]),
      `${role}: must not include another role's ("${otherRole}") configured instruction`,
    );
  }
}

// base and role instructions fall back independently — an override of only one field
// still composes with the code-owned default for whatever was left blank
const baseOnlyConfig: StagePromptsConfig = {
  ...CONFIG,
  assetAnalysis: { baseInstructions: "", roleInstructions: CONFIG.assetAnalysis.roleInstructions },
};
const baseOnlyResolved = resolveAssetAnalysisSystemPrompt(baseOnlyConfig, "packshot", FALLBACK_BASE, FALLBACK_ROLES);
assert.ok(baseOnlyResolved.includes(FALLBACK_BASE), "a blank configured base must fall back to the hardcoded default");
assert.ok(
  baseOnlyResolved.includes(CONFIG.assetAnalysis.roleInstructions.packshot),
  "the role instruction should still be the configured one even though the base fell back",
);

assert.ok(
  resolveAssetAnalysisSystemPrompt(null, "packshot", FALLBACK_BASE, FALLBACK_ROLES).includes(FALLBACK_BASE),
  "no config at all -> falls back for both base and role instruction",
);
assert.ok(
  resolveAssetAnalysisSystemPrompt(undefined, "style_reference", FALLBACK_BASE, FALLBACK_ROLES).includes(
    FALLBACK_ROLES.style_reference,
  ),
);

// --- prompt builder revision instruction: {{issues}}/{{revisionInstruction}} substituted
const revised = resolvePromptBuilderRevisionInstruction(CONFIG, "fallback {{issues}} {{revisionInstruction}}", {
  issues: ["hook text was dropped", "wrong aspect ratio"],
  revisionInstruction: "re-add the hook verbatim",
});
assert.equal(revised, "Configured revision. Issues: hook text was dropped; wrong aspect ratio. Instruction: re-add the hook verbatim.");

// empty issues/instruction still substitute to a sensible default rather than blank text
const revisedEmpty = resolvePromptBuilderRevisionInstruction(CONFIG, "fallback", { issues: [], revisionInstruction: "" });
assert.ok(revisedEmpty.includes("(none listed)"), "empty issues must substitute a readable placeholder, not blank text");
assert.ok(
  revisedEmpty.includes("(none given — use the issues above)"),
  "empty revisionInstruction must substitute a readable placeholder, not blank text",
);

// regression: `issues`/`revisionInstruction` are freeform LLM text and could themselves
// contain a literal `{{revisionInstruction}}`/`{{issues}}` substring (e.g. the reviewer
// echoing the template back) — substitution must happen in one pass, never rescanning
// already-substituted text for the other placeholder
const revisedWithLiteralPlaceholder = resolvePromptBuilderRevisionInstruction(
  null,
  "fallback {{issues}} | {{revisionInstruction}}",
  {
    issues: ["the output still says {{revisionInstruction}}"],
    revisionInstruction: "drop the literal placeholder text",
  },
);
assert.equal(
  revisedWithLiteralPlaceholder,
  "fallback the output still says {{revisionInstruction}} | drop the literal placeholder text",
  "an issues string containing a literal {{revisionInstruction}} must not be rescanned/re-substituted",
);

// no config -> the fallback template itself is used (and still gets substituted)
const revisedFallback = resolvePromptBuilderRevisionInstruction(null, "fallback {{issues}}", {
  issues: ["x"],
  revisionInstruction: "y",
});
assert.equal(revisedFallback, "fallback x");

console.log("lib/maszynka/stagePromptResolver.ts — all checks passed");
