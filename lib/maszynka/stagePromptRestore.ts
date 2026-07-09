// Stage prompt restore + Content safety save-warning decisions (PRD 0002 "Maszynka form
// Configs and Stage prompts", issue #23 / PRD stories 21, 27-28). Pure, framework-free —
// same layering as stagePromptResolver.ts — so the *decisions* behind restore and the
// Content safety warning are testable without React, `window.confirm`, or a network
// round trip. The React shell (app/MaszynkaConfigs.tsx, app/MaszynkaStagePromptsForm.tsx)
// owns the actual UI/persistence; this module only computes "what should the next body
// look like" and "should we warn".
//
// Restore is scoped to exactly one Stage prompt "slot" at a time (ADR 0001 follow-up
// decision: "Stage prompts also support restore, scoped to one stage prompt at a time...
// We do not expose restore for hooks/presets/global rules in MVP because restoring a
// whole historical collection could silently revert unrelated item edits"). A slot is one
// of `StagePromptsConfig`'s five top-level stages (configSchemas.ts) — `assetAnalysis`
// restores its base instructions AND all four role instructions together as one unit
// (they're one conceptual prompt — PRD story 22), and `promptBuilder` restores its main
// prompt AND revision instruction template together (PRD story 25), never a lone role or
// the template alone. Restoring a slot only stages the change into the current draft —
// it does not persist by itself, matching how every other Config edit in this shell
// (add/edit/delete/reorder an item) only takes effect once the operator hits "Save as new
// version": one predictable save path, and one point where the Content safety warning
// below can fire.
import { validateConfigBody, type StagePromptsConfig } from "./configSchemas.ts";

/** Validate-then-cast in one step: `null` for a body that doesn't pass
 *  `validateConfigBody("stage_prompts", ...)` (e.g. a version written by some other path,
 *  or mid-migration data), the typed `StagePromptsConfig` otherwise. One shared helper
 *  instead of three call sites (app/MaszynkaConfigs.tsx's `openVersion`/`handleSave`,
 *  app/MaszynkaStagePromptsForm.tsx's restore-candidate list) each re-deriving the same
 *  "is this body actually shaped like a stage_prompts config" check by hand. */
export function parseValidStagePromptsBody(body: unknown): StagePromptsConfig | null {
  return validateConfigBody("stage_prompts", body).length === 0 ? (body as StagePromptsConfig) : null;
}

export type StagePromptSlot =
  | "contentSafety"
  | "assetAnalysis"
  | "promptImprovement"
  | "promptBuilder"
  | "promptReviewer";

/** Display metadata for all five slots, in the fixed pipeline order (content safety
 *  first, prompt reviewer last) — one place both the form's section titles and the
 *  `.check.ts` coverage test ("every slot is exercised") read from, instead of the slot
 *  list being restated as ad hoc string literals in more than one place. */
export const STAGE_PROMPT_SLOTS: { slot: StagePromptSlot; label: string }[] = [
  { slot: "contentSafety", label: "Content safety" },
  { slot: "assetAnalysis", label: "Asset analysis" },
  { slot: "promptImprovement", label: "Prompt improvement" },
  { slot: "promptBuilder", label: "Prompt builder" },
  { slot: "promptReviewer", label: "Prompt reviewer" },
];

/** `label` lookup for a single slot — thin wrapper over `STAGE_PROMPT_SLOTS` so callers
 *  that already know which slot they want (e.g. one `<Section>` in the form) don't have
 *  to `.find()` the array themselves. */
export function stagePromptSlotLabel(slot: StagePromptSlot): string {
  return STAGE_PROMPT_SLOTS.find((s) => s.slot === slot)?.label ?? slot;
}

/** Copy `slot`'s prompt content from `historical` (an older `stage_prompts` version's
 *  body) into `current` (the draft being edited), leaving every other slot untouched.
 *  Pure — returns a new object, never mutates either input, and never touches any
 *  historical version (ADR 0001 / PRD: append-only, restore never overwrites or deletes
 *  history — the caller persists the *result* as a brand new version, same as any other
 *  edit). */
export function restoreStagePromptSlot(
  current: StagePromptsConfig,
  historical: StagePromptsConfig,
  slot: StagePromptSlot,
): StagePromptsConfig {
  return { ...current, [slot]: historical[slot] };
}

/** Decide whether saving a `stage_prompts` version should show the operator the
 *  lightweight Content safety warning (PRD story 21 / ADR 0001: "Saving changes to the
 *  Content safety Stage prompt shows a lightweight warning/confirmation because this
 *  prompt controls the first pipeline gate. The warning informs the operator about risk;
 *  it does not prevent the save."). Compares the text about to be saved against the last
 *  actually-*saved* text (not merely whatever's in the draft) — an edit that changes it
 *  (typed directly, or staged in via `restoreStagePromptSlot` above) warns; re-saving the
 *  same text back unchanged does not. Leading/trailing whitespace differences don't count
 *  as a change (matches the trimmed-text semantics `stagePromptResolver.ts` already uses
 *  for "is this field configured"). */
export function shouldWarnOnContentSafetySave(previousSystemPrompt: string, nextSystemPrompt: string): boolean {
  return previousSystemPrompt.trim() !== nextSystemPrompt.trim();
}
