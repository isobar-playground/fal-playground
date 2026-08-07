// Runnable check for lib/maszynka-video/gridRequest.ts — grid payload → FAL request
// building (issue #27 acceptance: raw model parameters merge into the request;
// canvasSize displays from the payload). Run with:
//   node lib/maszynka-video/gridRequest.check.ts   (or: npm run check:maszynka-video-grid-request)
// No test framework in this repo by design — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import { canvasSizeLabel, gridPromptFromPayload, mergeRawParams, parseRawParams } from "./gridRequest.ts";

// --- prompt: the payload's own `prompt` wins; otherwise the payload verbatim ---------
assert.equal(gridPromptFromPayload({ prompt: "a 2x2 grid of scenes", layout: "2x2" }), "a 2x2 grid of scenes");
const payload = { layout: "1x2", scenes: [{ sceneId: "scene-01" }] };
assert.equal(gridPromptFromPayload(payload), JSON.stringify(payload), "no prompt field → whole payload, untouched");
assert.equal(gridPromptFromPayload({ prompt: "  " }), JSON.stringify({ prompt: "  " }), "blank prompt doesn't count");

// --- raw params: "" is valid "no extras"; junk and non-objects error -----------------
assert.deepEqual(parseRawParams(""), { params: {}, error: null });
assert.deepEqual(parseRawParams("  "), { params: {}, error: null });
assert.deepEqual(parseRawParams('{"guidance_scale": 3.5}'), { params: { guidance_scale: 3.5 }, error: null });
assert.ok(parseRawParams("{nope").error, "invalid JSON must error");
assert.ok(parseRawParams("[1,2]").error, "a non-object must error");
assert.deepEqual(parseRawParams("[1,2]").params, {}, "params stay empty alongside an error");

// --- merge: raw params are the operator's explicit override — they win ---------------
const merged = mergeRawParams(
  { prompt: "grid", num_images: 1, image_size: "landscape_16_9" },
  { image_size: { width: 1920, height: 960 }, seed: 7 },
);
assert.deepEqual(merged, {
  prompt: "grid",
  num_images: 1,
  image_size: { width: 1920, height: 960 },
  seed: 7,
});

// --- canvasSize display: object, string, or absent -----------------------------------
assert.equal(canvasSizeLabel({ canvasSize: { width: 1920, height: 960 } }), "1920×960");
assert.equal(canvasSizeLabel({ canvasSize: "1024x1024" }), "1024x1024");
assert.equal(canvasSizeLabel({}), null);
assert.equal(canvasSizeLabel({ canvasSize: { width: "1920" } }), null, "malformed canvasSize is just not shown");

console.log("lib/maszynka-video/gridRequest.ts — all checks passed");
