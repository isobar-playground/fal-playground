// Runnable check for the video catalog rebuild (Malina's curated model list). Run with:
//   node lib/video/models.check.ts   (or: npm run check:video-models)
// No test framework in this repo by design — Node 22+ strips TS types natively, so this
// runs with no build step and no dependency.
import assert from "node:assert/strict";
import { VIDEO_MODELS, LOCAL_VIDEO_BASE, buildVideoInput, DEFAULT_VIDEO_SETTINGS } from "./models.ts";

// --- every model key is unique ----------------------------------------------
const keys = VIDEO_MODELS.map((m) => m.key);
assert.equal(new Set(keys).size, keys.length, "every VIDEO_MODELS key must be unique");

// --- catalog is EXACTLY the client's curated list (ids, hardcoded here) -----
// Source: client-delivered video endpoint list (see the task's T2V/I2V/V2V sections).
const CLIENT_IDS = [
  // TEXT-2-VIDEO
  "bytedance/seedance-2.0/text-to-video",
  "bytedance/seedance-2.0/fast/text-to-video",
  "fal-ai/kling-video/v3/pro/text-to-video",
  "fal-ai/veo3.1",
  "fal-ai/veo3.1/fast",
  "xai/grok-imagine-video/text-to-video",
  // IMAGE-2-VIDEO
  "xai/grok-imagine-video/v1.5/image-to-video",
  "fal-ai/kling-video/v3/standard/image-to-video",
  "fal-ai/kling-video/v3/pro/image-to-video",
  "bytedance/seedance-2.0/image-to-video",
  "bytedance/seedance-2.0/reference-to-video",
  "bytedance/seedance-2.0/fast/image-to-video",
  "bytedance/seedance-2.0/fast/reference-to-video",
  "fal-ai/veo3.1/fast/image-to-video",
  // VIDEO-2-VIDEO
  "xai/grok-imagine-video/edit-video",
  "fal-ai/topaz/upscale/video",
  "fal-ai/kling-video/o3/pro/video-to-video/edit",
  "fal-ai/kling-video/v3/pro/motion-control",
  "fal-ai/sync-lipsync/v3",
];
// Endpoints we carry on purpose despite not being on the client's list. Each one needs a
// reason here, so "the catalog is the client's list" stays a decision and not a drift.
const EXTRA_IDS = [
  // The standard-tier Veo 3.1 image-to-video. The list only names the /fast variant; kept
  // so the flagship tier isn't text-only. Requested 2026-07-31.
  "fal-ai/veo3.1/image-to-video",
];
const catalogIds = VIDEO_MODELS.map((m) => m.id).sort();
assert.deepEqual(
  catalogIds,
  [...CLIENT_IDS, ...EXTRA_IDS].sort(),
  "VIDEO_MODELS ids must be exactly the client's curated list plus the documented EXTRA_IDS",
);
assert.equal(new Set(catalogIds).size, catalogIds.length, "every endpoint id must appear exactly once");

// --- every non-text model declares the param it needs ------------------------
for (const m of VIDEO_MODELS) {
  if (m.inputMode === "start" || m.inputMode === "start-end") {
    assert.ok(m.startParam, `"${m.key}" (${m.inputMode}) must declare startParam`);
  }
  if (m.inputMode === "video") {
    assert.ok(m.videoParam, `"${m.key}" (video) must declare videoParam`);
  }
  if (m.audioParam) {
    // audioParam is only meaningful alongside a video source today.
    assert.equal(m.inputMode, "video", `"${m.key}" declares audioParam but isn't a video-to-video model`);
  }
}

// --- every key has a LOCAL_VIDEO_BASE pricing entry ---------------------------
for (const m of VIDEO_MODELS) {
  assert.ok(LOCAL_VIDEO_BASE[m.key], `"${m.key}" is missing a LOCAL_VIDEO_BASE pricing entry`);
}
// ...and no stale entries for models that no longer exist in the catalog.
const modelKeySet = new Set(keys);
for (const priceKey of Object.keys(LOCAL_VIDEO_BASE)) {
  assert.ok(modelKeySet.has(priceKey), `LOCAL_VIDEO_BASE has a stale entry "${priceKey}" with no matching model`);
}

// --- buildVideoInput puts the source URL on the declared param, per mode -----
const noFrames = { startUrl: undefined, endUrl: undefined, videoUrl: undefined, audioUrl: undefined };

// text: no source url of any kind is sent
const textModel = VIDEO_MODELS.find((m) => m.inputMode === "text");
assert.ok(textModel, "expected at least one text-mode model");
const textInput = buildVideoInput(textModel!, "a prompt", noFrames, DEFAULT_VIDEO_SETTINGS);
assert.ok(!("image_url" in textInput), "text model must not send a frame url");

// start: startUrl lands on startParam
const startModel = VIDEO_MODELS.find((m) => m.inputMode === "start" && !m.startParamIsArray);
assert.ok(startModel, "expected at least one start-mode model with a plain (non-array) startParam");
const startInput = buildVideoInput(startModel!, "a prompt", { ...noFrames, startUrl: "https://x/start.png" }, DEFAULT_VIDEO_SETTINGS);
assert.equal(startInput[startModel!.startParam!], "https://x/start.png", `${startModel!.key} must put startUrl on its declared startParam`);

// start (array param): seedance reference-to-video wraps the url in a 1-element array
const arrayStartModel = VIDEO_MODELS.find((m) => m.startParamIsArray);
assert.ok(arrayStartModel, "expected at least one model with an array startParam (Seedance reference-to-video)");
const arrayStartInput = buildVideoInput(arrayStartModel!, "a prompt", { ...noFrames, startUrl: "https://x/ref.png" }, DEFAULT_VIDEO_SETTINGS);
assert.deepEqual(arrayStartInput[arrayStartModel!.startParam!], ["https://x/ref.png"], `${arrayStartModel!.key} must wrap startUrl in a 1-element array`);

// start-end: both startUrl and endUrl land on their declared params
const startEndModel = VIDEO_MODELS.find((m) => m.inputMode === "start-end");
assert.ok(startEndModel, "expected at least one start-end-mode model");
const startEndInput = buildVideoInput(
  startEndModel!,
  "a prompt",
  { ...noFrames, startUrl: "https://x/start.png", endUrl: "https://x/end.png" },
  DEFAULT_VIDEO_SETTINGS,
);
assert.equal(startEndInput[startEndModel!.startParam!], "https://x/start.png");
assert.equal(startEndInput[startEndModel!.endParam!], "https://x/end.png", `${startEndModel!.key} must put endUrl on its declared endParam`);

// video: videoUrl lands on videoParam (and, when the model has an audioParam too,
// audioUrl lands on that — sync-lipsync).
const videoModel = VIDEO_MODELS.find((m) => m.inputMode === "video" && !m.startParam && !m.audioParam);
assert.ok(videoModel, "expected at least one plain video-to-video model (no paired image/audio)");
const videoInput = buildVideoInput(videoModel!, "a prompt", { ...noFrames, videoUrl: "https://x/source.mp4" }, DEFAULT_VIDEO_SETTINGS);
assert.equal(videoInput[videoModel!.videoParam!], "https://x/source.mp4", `${videoModel!.key} must put videoUrl on its declared videoParam`);

const lipsyncModel = VIDEO_MODELS.find((m) => m.audioParam);
assert.ok(lipsyncModel, "expected a model with an audioParam (sync-lipsync)");
const lipsyncInput = buildVideoInput(
  lipsyncModel!,
  "a prompt",
  { ...noFrames, videoUrl: "https://x/source.mp4", audioUrl: "https://x/source.wav" },
  DEFAULT_VIDEO_SETTINGS,
);
assert.equal(lipsyncInput[lipsyncModel!.videoParam!], "https://x/source.mp4");
assert.equal(lipsyncInput[lipsyncModel!.audioParam!], "https://x/source.wav", `${lipsyncModel!.key} must put audioUrl on its declared audioParam`);
assert.ok(lipsyncModel!.noPrompt, "sync-lipsync must be marked noPrompt");
assert.ok(!("prompt" in lipsyncInput), "noPrompt models must not send a prompt key");

// motion-control: video + reference image together (inputMode "video" with a startParam)
const motionControl = VIDEO_MODELS.find((m) => m.inputMode === "video" && m.startParam);
assert.ok(motionControl, "expected a video-to-video model that also pairs a reference image (Kling motion-control)");
const motionInput = buildVideoInput(
  motionControl!,
  "a prompt",
  { ...noFrames, videoUrl: "https://x/motion.mp4", startUrl: "https://x/character.png" },
  DEFAULT_VIDEO_SETTINGS,
);
assert.equal(motionInput[motionControl!.videoParam!], "https://x/motion.mp4");
assert.equal(motionInput[motionControl!.startParam!], "https://x/character.png");
// `character_orientation` is required with no default — omitting it 422s every request.
assert.equal(
  motionInput.character_orientation,
  "image",
  "motion-control must send the required character_orientation (no server-side default)",
);

// --- extraInput reaches the payload for every model that declares it ---------
for (const m of VIDEO_MODELS) {
  if (!m.extraInput) continue;
  const built = buildVideoInput(m, "a prompt", noFrames, DEFAULT_VIDEO_SETTINGS);
  for (const [k, v] of Object.entries(m.extraInput)) {
    assert.equal(built[k], v, `"${m.key}" must send its declared extraInput key "${k}"`);
  }
}

// --- duration wire type matches each family's OpenAPI input schema -----------
// Veo takes the string "8s"; Kling and Seedance take a string enum member ("8");
// Grok takes a plain integer. Sending the wrong JSON type is a 422.
for (const m of VIDEO_MODELS) {
  const built = buildVideoInput(m, "a prompt", noFrames, DEFAULT_VIDEO_SETTINGS);
  if (!("duration" in built)) continue;
  if (m.id.startsWith("xai/")) {
    assert.equal(typeof built.duration, "number", `"${m.key}" (Grok) must send duration as an integer`);
  } else if (m.id.startsWith("fal-ai/veo3.1")) {
    assert.match(String(built.duration), /^\d+s$/, `"${m.key}" (Veo) must send duration as "Ns"`);
  } else {
    assert.equal(typeof built.duration, "string", `"${m.key}" must send duration as a string enum member`);
    assert.match(String(built.duration), /^\d+$/, `"${m.key}" duration must be a bare numeric string`);
  }
}

// --- audioToggleParam is set on exactly the expected 15 endpoints, nowhere else ----
// Hardcoded (mirrors CLIENT_IDS above) so an added/removed model has to touch this
// list on purpose — the invariant that rots silently otherwise.
const AUDIO_TOGGLE_KEYS = [
  // generate_audio (13): all four Veo 3.1, all six Seedance 2.0, three Kling v3 text/image
  "veo3.1-text",
  "veo3.1-start",
  "veo3.1-fast-text",
  "veo3.1-fast-start",
  "seedance2-text",
  "seedance2-start-end",
  "seedance2-reference",
  "seedance2-fast-text",
  "seedance2-fast-start-end",
  "seedance2-fast-reference",
  "kling3-text",
  "kling3-start-end",
  "kling3-standard-start-end",
  // keep_audio (1)
  "kling-o3-edit",
  // keep_original_sound (1)
  "kling3-motion-control",
].sort();
const actualAudioToggleKeys = VIDEO_MODELS.filter((m) => m.audioToggleParam).map((m) => m.key).sort();
assert.deepEqual(
  actualAudioToggleKeys,
  AUDIO_TOGGLE_KEYS,
  "audioToggleParam must be declared on exactly the 15 audio-capable endpoints, no more no less",
);
// The five endpoints with no audio parameter at all must not declare one either.
const NO_AUDIO_PARAM_IDS = [
  "xai/grok-imagine-video/text-to-video",
  "xai/grok-imagine-video/v1.5/image-to-video",
  "xai/grok-imagine-video/edit-video",
  "fal-ai/topaz/upscale/video",
  "fal-ai/sync-lipsync/v3",
];
for (const id of NO_AUDIO_PARAM_IDS) {
  const m = VIDEO_MODELS.find((m) => m.id === id);
  assert.ok(m, `expected a catalog entry for no-audio-param endpoint "${id}"`);
  assert.ok(!m!.audioToggleParam, `"${m!.key}" (${id}) must not declare audioToggleParam — its schema has no audio param`);
}

// --- buildVideoInput sends generateAudio:false on the right param, per param name ---
const audioOffSettings = { ...DEFAULT_VIDEO_SETTINGS, generateAudio: false };
for (const [param, wantKey] of [
  ["generate_audio", "veo3.1-text"],
  ["keep_audio", "kling-o3-edit"],
  ["keep_original_sound", "kling3-motion-control"],
] as const) {
  const m = VIDEO_MODELS.find((m) => m.key === wantKey);
  assert.ok(m, `expected model "${wantKey}" for audioToggleParam "${param}" check`);
  assert.equal(m!.audioToggleParam, param, `"${wantKey}" must declare audioToggleParam "${param}"`);
  const built = buildVideoInput(m!, "a prompt", noFrames, audioOffSettings);
  assert.equal(built[param], false, `"${wantKey}" must send "${param}": false when generateAudio is false`);
  // Also confirm the toggle is sent (not omitted) when true — the request-preview
  // panel must never make an on-by-default value silently vanish from the payload.
  const builtOn = buildVideoInput(m!, "a prompt", noFrames, DEFAULT_VIDEO_SETTINGS);
  assert.equal(builtOn[param], true, `"${wantKey}" must send "${param}": true when generateAudio is true (never omitted)`);
}

// --- the five no-audio-param endpoints emit no audio key at all, either name --------
const ALL_AUDIO_KEYS = ["generate_audio", "keep_audio", "keep_original_sound"];
for (const id of NO_AUDIO_PARAM_IDS) {
  const m = VIDEO_MODELS.find((m) => m.id === id)!;
  const built = buildVideoInput(m, "a prompt", noFrames, DEFAULT_VIDEO_SETTINGS);
  for (const k of ALL_AUDIO_KEYS) {
    assert.ok(!(k in built), `"${m.key}" (${id}) must not emit "${k}" — its schema has no audio parameter`);
  }
}

// --- Grok v1.5 image-to-video has no aspect_ratio param ----------------------
const grokI2v = VIDEO_MODELS.find((m) => m.id === "xai/grok-imagine-video/v1.5/image-to-video");
assert.ok(grokI2v, "expected the Grok v1.5 image-to-video model");
assert.ok(
  !grokI2v!.fields.some((f) => f.kind === "select" && f.key === "aspectRatio"),
  "Grok v1.5 image-to-video has no aspect_ratio in its schema — it must expose no aspect control",
);

console.log("lib/video/models.check.ts — all checks passed");
