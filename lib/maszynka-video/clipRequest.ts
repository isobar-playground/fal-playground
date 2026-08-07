// Clip generation helpers (issue #29). Pure on purpose (same story as
// gridRequest.ts): the view composes these around lib/video/models.ts's
// buildVideoInput, so this module stays runnable under plain `node` for its check.
// The one HARD validation of the stage lives here: a Clip must come from the Crop
// with the SAME sceneId — never from a panel that merely sits in the right place.

import type { PlannerScene } from "./plannerContract";

/** The hard gate (issue #29 / PRD story 14): returns the operator-facing error when
 *  generation must NOT send a request — no Crop for the Scene yet, or the Crop's
 *  sceneId doesn't equal the scene JSON's sceneId. Null means "clear to generate". */
export function validateSceneClip(
  crop: { sceneId: string } | undefined | null,
  scene: Pick<PlannerScene, "sceneId">,
): string | null {
  if (!scene.sceneId) return "The scene JSON has no sceneId — fix the planner output first.";
  if (!crop) return `No Crop exists for ${scene.sceneId} yet — generate and crop its grid first.`;
  if (crop.sceneId !== scene.sceneId) {
    return `Crop sceneId "${crop.sceneId}" does not match scene JSON sceneId "${scene.sceneId}" — refusing to animate the wrong panel.`;
  }
  return null;
}

/** The image-to-video prompt for a Scene: its own `videoPrompt`/`prompt` when the
 *  planner emitted one, otherwise the whole scene fragment verbatim — the scene
 *  JSON is the instruction; the app never rewrites it (same rule as the grid
 *  stage's gridPromptFromPayload). */
export function clipPromptFromScene(sceneRaw: Record<string, unknown>): string {
  if (typeof sceneRaw.videoPrompt === "string" && sceneRaw.videoPrompt.trim() !== "") return sceneRaw.videoPrompt;
  if (typeof sceneRaw.prompt === "string" && sceneRaw.prompt.trim() !== "") return sceneRaw.prompt;
  return JSON.stringify(sceneRaw);
}
