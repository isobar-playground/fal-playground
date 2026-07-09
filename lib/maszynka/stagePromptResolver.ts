// Stage prompt resolver (PRD 0002 "Maszynka form Configs and Stage prompts", issue #19 /
// story 33). Converts the `stage_prompts` Config kind's operator-editable instruction
// text (see configSchemas.ts's `StagePromptsConfig`, seeded in configSeeds.ts's
// `STAGE_PROMPTS_SEED`) into the exact instruction text each stage's request builder
// sends — the "Stage prompt resolver" deep module called out in the PRD's "Deep module
// opportunities".
//
// Deliberately pure and framework-free (no Neon/React import), same layering as
// contract.ts/configSchemas.ts: every stage module (contentSafety.ts, assetAnalysis.ts,
// promptImprovement.ts, promptBuilder.ts, promptReviewer.ts) keeps owning its own
// hardcoded default text — used both as the seed content (configSeeds.ts) and as the
// fallback here whenever a run has no `stage_prompts` config yet (or the operator left a
// field blank) — so a stage module never has to know whether its prompt text came from
// Neon or from code. This module only knows how to pick configured-vs-fallback text and,
// for Asset analysis, how to compose shared base instructions with the role-specific
// block (PRD story 22).
//
// Response schemas / JSON Schema response formats / runtime validators are NEVER touched
// here (PRD "LLM response schemas and validators stay fixed in code") — this module only
// ever produces plain instruction strings that become a `system` message's content.
import type { StagePromptsConfig } from "./configSchemas";
import type { AssetRole } from "./contract";

function textOrFallback(configured: string | undefined, fallback: string): string {
  const trimmed = configured?.trim();
  return trimmed ? trimmed : fallback;
}

/** Content safety stage system prompt: configured text if present and non-blank, else
 *  the stage module's hardcoded default. */
export function resolveContentSafetySystemPrompt(
  config: StagePromptsConfig | null | undefined,
  fallback: string,
): string {
  return textOrFallback(config?.contentSafety?.systemPrompt, fallback);
}

/** Asset analysis stage system prompt: shared base instructions plus the role-specific
 *  instruction block for the asset actually being analyzed (PRD story 22) — never the
 *  base alone, never the role block alone. Falls back per-field, independently, so a
 *  config that only overrides the base (or only one role) still composes correctly with
 *  the code-owned defaults for whatever it left blank. */
export function resolveAssetAnalysisSystemPrompt(
  config: StagePromptsConfig | null | undefined,
  role: AssetRole,
  fallbackBaseInstructions: string,
  fallbackRoleInstructions: Record<AssetRole, string>,
): string {
  const base = textOrFallback(config?.assetAnalysis?.baseInstructions, fallbackBaseInstructions);
  const roleInstruction = textOrFallback(config?.assetAnalysis?.roleInstructions?.[role], fallbackRoleInstructions[role]);
  return `${base}\n\n${roleInstruction}`;
}

/** Prompt improvement stage system prompt: configured text if present and non-blank,
 *  else the stage module's hardcoded default. */
export function resolvePromptImprovementSystemPrompt(
  config: StagePromptsConfig | null | undefined,
  fallback: string,
): string {
  return textOrFallback(config?.promptImprovement?.systemPrompt, fallback);
}

/** Prompt builder stage main system prompt: configured text if present and non-blank,
 *  else the stage module's hardcoded default. */
export function resolvePromptBuilderSystemPrompt(
  config: StagePromptsConfig | null | undefined,
  fallback: string,
): string {
  return textOrFallback(config?.promptBuilder?.systemPrompt, fallback);
}

/** Prompt builder's one-allowed-rebuild revision instruction (PRD story 25): the
 *  configured `revisionInstructionTemplate` (or the stage module's hardcoded default)
 *  with its `{{issues}}`/`{{revisionInstruction}}` placeholders substituted with the
 *  Prompt reviewer's actual issues/instruction for this attempt. A template with no
 *  placeholders at all is still honored verbatim — substitution is a no-op replace, not
 *  a required marker. */
export function resolvePromptBuilderRevisionInstruction(
  config: StagePromptsConfig | null | undefined,
  fallbackTemplate: string,
  vars: { issues: string[]; revisionInstruction: string },
): string {
  const template = textOrFallback(config?.promptBuilder?.revisionInstructionTemplate, fallbackTemplate);
  const issuesText = vars.issues.join("; ") || "(none listed)";
  const revisionText = vars.revisionInstruction || "(none given — use the issues above)";
  // Single pass over the template, not two chained `.replaceAll()` calls: the Prompt
  // reviewer's `issues`/`revisionInstruction` are freeform LLM text and could themselves
  // contain the literal substring `{{revisionInstruction}}` (e.g. echoing the template
  // back) — a first `.replaceAll("{{issues}}", issuesText)` would then have a second
  // `.replaceAll("{{revisionInstruction}}", ...)` re-match inside its own output and
  // corrupt the substituted text. Replacing both placeholders in one regex pass means
  // substituted text is never rescanned for the other placeholder.
  return template.replace(/\{\{issues\}\}|\{\{revisionInstruction\}\}/g, (match) =>
    match === "{{issues}}" ? issuesText : revisionText,
  );
}

/** Prompt reviewer stage system prompt: configured text if present and non-blank, else
 *  the stage module's hardcoded default. */
export function resolvePromptReviewerSystemPrompt(
  config: StagePromptsConfig | null | undefined,
  fallback: string,
): string {
  return textOrFallback(config?.promptReviewer?.systemPrompt, fallback);
}
