// Runnable check for lib/maszynka-video/joinRequest.ts — the Final video join
// request building (issue #30 acceptance: clip list spans all batches strictly by
// global order; total duration is the sum; the request carries full clips only —
// no trimming, no transitions). Run with:
//   node lib/maszynka-video/joinRequest.check.ts   (or: npm run check:maszynka-video-join-request)
// No test framework in this repo by design — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import { FFMPEG_MERGE_VIDEOS_ENDPOINT, buildJoinInput, orderedClips, totalDurationSeconds } from "./joinRequest.ts";

// The endpoint id is data other modules display — a typo here must fail the build.
assert.equal(FFMPEG_MERGE_VIDEOS_ENDPOINT, "fal-ai/ffmpeg-api/merge-videos");

// Scenes arrive across two batches, deliberately out of order.
const scenes = [
  { sceneId: "scene-03", order: 3, targetClipDurationSeconds: 4 },
  { sceneId: "scene-01", order: 1, targetClipDurationSeconds: 4 },
  { sceneId: "scene-04", order: 4, targetClipDurationSeconds: 5 },
  { sceneId: "scene-02", order: 2, targetClipDurationSeconds: 4 },
];
const clips = {
  "scene-01": { videoUrl: "https://v3.fal.media/files/c1.mp4", durationSeconds: 4 },
  "scene-02": { videoUrl: "https://v3.fal.media/files/c2.mp4", durationSeconds: 4 },
  "scene-03": { videoUrl: "https://v3.fal.media/files/c3.mp4", durationSeconds: 4 },
  "scene-04": { videoUrl: "https://v3.fal.media/files/c4.mp4", durationSeconds: 5 },
};

// --- strict global order across batches ----------------------------------------------
const all = orderedClips(scenes, clips);
assert.deepEqual(all.missingSceneIds, []);
assert.deepEqual(
  all.clips.map((c) => c.sceneId),
  ["scene-01", "scene-02", "scene-03", "scene-04"],
);

// --- total duration is the sum of the scene durations --------------------------------
assert.deepEqual(totalDurationSeconds(all.clips), { seconds: 17, allKnown: true });

// --- the join input is the URL list in order and NOTHING else (no trims/transitions) --
const input = buildJoinInput(all.clips);
assert.deepEqual(Object.keys(input), ["video_urls"], "hard concatenation sends only video_urls");
assert.deepEqual(input.video_urls, [
  "https://v3.fal.media/files/c1.mp4",
  "https://v3.fal.media/files/c2.mp4",
  "https://v3.fal.media/files/c3.mp4",
  "https://v3.fal.media/files/c4.mp4",
]);

// --- a Scene without a generated clip is reported missing, never silently skipped ----
const partial = orderedClips(scenes, { ...clips, "scene-03": { videoUrl: null, durationSeconds: null } });
assert.deepEqual(partial.missingSceneIds, ["scene-03"]);
assert.equal(partial.clips.length, 3);

// --- unknown durations: sum covers the known ones, flagged as incomplete -------------
const someUnknown = orderedClips(scenes, {
  ...clips,
  "scene-02": { videoUrl: "https://v3.fal.media/files/c2.mp4", durationSeconds: null },
});
// scene-02 falls back to the scene's own targetClipDurationSeconds first
assert.equal(someUnknown.clips[1].durationSeconds, 4, "clip duration falls back to the scene target");
const flagged = totalDurationSeconds([
  { sceneId: "s", order: 1, videoUrl: "u", durationSeconds: 4 },
  { sceneId: "t", order: 2, videoUrl: "v", durationSeconds: null },
]);
assert.deepEqual(flagged, { seconds: 4, allKnown: false });

console.log("lib/maszynka-video/joinRequest.ts — all checks passed");
