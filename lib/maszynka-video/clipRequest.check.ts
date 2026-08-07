// Runnable check for lib/maszynka-video/clipRequest.ts — the Clip stage's hard
// sceneId validation (issue #29 acceptance: mismatched crop.sceneId vs
// sceneJson.sceneId blocks generation) and prompt selection. Run with:
//   node lib/maszynka-video/clipRequest.check.ts   (or: npm run check:maszynka-video-clip-request)
// No test framework in this repo by design — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import { clipPromptFromScene, validateSceneClip } from "./clipRequest.ts";

// --- matching sceneIds → clear to generate -------------------------------------------
assert.equal(validateSceneClip({ sceneId: "scene-03" }, { sceneId: "scene-03" }), null);

// --- mismatch → blocked with an operator-facing error (PRD story 14) -----------------
const mismatch = validateSceneClip({ sceneId: "scene-04" }, { sceneId: "scene-03" });
assert.ok(mismatch && mismatch.includes("scene-04") && mismatch.includes("scene-03"), "error names both sceneIds");

// --- no crop yet / no sceneId in the scene JSON → blocked ----------------------------
assert.ok(validateSceneClip(undefined, { sceneId: "scene-03" }));
assert.ok(validateSceneClip(null, { sceneId: "scene-03" }));
assert.ok(validateSceneClip({ sceneId: "scene-03" }, { sceneId: "" }), "a blank scene sceneId can never match");

// --- prompt selection: videoPrompt > prompt > whole fragment verbatim ----------------
assert.equal(clipPromptFromScene({ videoPrompt: "slow dolly-in", prompt: "unused" }), "slow dolly-in");
assert.equal(clipPromptFromScene({ prompt: "hero shot" }), "hero shot");
const fragment = { sceneId: "scene-01", mood: "warm" };
assert.equal(clipPromptFromScene(fragment), JSON.stringify(fragment));
assert.equal(clipPromptFromScene({ videoPrompt: "  " }), JSON.stringify({ videoPrompt: "  " }), "blank doesn't count");

console.log("lib/maszynka-video/clipRequest.ts — all checks passed");
