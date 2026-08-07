// Runnable check for lib/maszynka-video/plannerContract.ts — the Planner output
// contract parser (issue #25 acceptance: short video surfaces scenePlan +
// gridGenerationPayload, long video surfaces masterScenePlan + gridBatches, unknown
// fields pass through untouched, non-JSON yields validationError). Run with:
//   node lib/maszynka-video/plannerContract.check.ts   (or: npm run check:maszynka-video-planner-contract)
// No test framework in this repo by design — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import { derivePlannerContract, parsePlannerContent } from "./plannerContract.ts";

// --- non-JSON response → validationError, everything else empty (hard block) ---------
const bad = parsePlannerContent("Sorry, I cannot produce a plan.");
assert.ok(bad.validationError && bad.validationError.includes("not valid JSON"));
assert.equal(bad.parsed, null);
assert.deepEqual(bad.batches, []);
assert.deepEqual(bad.scenes, []);

// --- a JSON scalar/array is still not a plan -----------------------------------------
assert.ok(parsePlannerContent("[1,2,3]").validationError);
assert.ok(parsePlannerContent("42").validationError);

// --- short video: scenePlan + single top-level payload → one synthetic batch ---------
const short = parsePlannerContent(
  JSON.stringify({
    scenePlan: {
      targetFinalDurationSeconds: 8,
      scenes: [
        { sceneId: "scene-02", order: 2, gridSlot: 2, targetClipDurationSeconds: 4, mood: "close-up" },
        { sceneId: "scene-01", order: 1, gridSlot: 1, targetClipDurationSeconds: 4 },
      ],
    },
    gridGenerationPayload: { layout: "1x2", canvasSize: { width: 1920, height: 960 } },
    somethingCustom: { passes: "through" },
  }),
);
assert.equal(short.validationError, null);
assert.ok(short.scenePlan, "scenePlan must surface");
assert.equal(short.masterScenePlan, null);
assert.equal(short.batches.length, 1, "short video normalizes to exactly one batch");
assert.equal(short.batches[0].batchId, "grid-01");
assert.deepEqual(short.batches[0].sceneIds, ["scene-01", "scene-02"]);
assert.deepEqual(short.batches[0].gridGenerationPayload, { layout: "1x2", canvasSize: { width: 1920, height: 960 } });
// scenes come back sorted by global order, raw fragments untouched
assert.deepEqual(
  short.scenes.map((s) => s.sceneId),
  ["scene-01", "scene-02"],
);
assert.equal(short.scenes[1].raw.mood, "close-up");
// unknown top-level fields pass through untouched
assert.deepEqual((short.parsed as Record<string, unknown>).somethingCustom, { passes: "through" });

// --- long video: masterScenePlan + gridBatches ---------------------------------------
const long = parsePlannerContent(
  JSON.stringify({
    masterScenePlan: {
      targetFinalDurationSeconds: 40,
      sceneCount: 10,
      scenes: Array.from({ length: 10 }, (_, i) => ({
        sceneId: `scene-${String(i + 1).padStart(2, "0")}`,
        order: i + 1,
        gridSlot: (i % 4) + 1,
        targetClipDurationSeconds: 4,
      })),
    },
    gridBatches: [
      { batchId: "grid-01", sceneIds: ["scene-01", "scene-02", "scene-03", "scene-04"], gridGenerationPayload: { layout: "2x2" } },
      { batchId: "grid-02", sceneIds: ["scene-05", "scene-06", "scene-07", "scene-08"], gridGenerationPayload: { layout: "2x2" } },
      { batchId: "grid-03", sceneIds: ["scene-09", "scene-10"], gridGenerationPayload: { layout: "1x2" } },
    ],
  }),
);
assert.equal(long.validationError, null);
assert.ok(long.masterScenePlan, "masterScenePlan must surface");
assert.equal(long.scenePlan, null);
assert.equal(long.batches.length, 3);
assert.deepEqual(long.batches.map((b) => b.batchId), ["grid-01", "grid-02", "grid-03"]);
assert.equal(long.scenes.length, 10);
assert.equal(long.scenes[0].targetClipDurationSeconds, 4);

// --- tolerant fallbacks: missing order → position; duration fallbacks; missing batchId
const sloppy = derivePlannerContract({
  scenePlan: {
    scenes: [
      { sceneId: "scene-01", durationSeconds: 3 },
      { sceneId: "scene-02", duration: 5 },
    ],
  },
  gridBatches: [{ sceneIds: ["scene-01", "scene-02"] }],
});
assert.equal(sloppy.validationError, null);
assert.deepEqual(sloppy.scenes.map((s) => s.order), [1, 2], "missing order falls back to position");
assert.deepEqual(
  sloppy.scenes.map((s) => s.targetClipDurationSeconds),
  [3, 5],
  "durationSeconds/duration accepted as fallbacks",
);
assert.equal(sloppy.batches[0].batchId, "grid-01", "missing batchId gets a stable generated id");
assert.deepEqual(sloppy.batches[0].gridGenerationPayload, {}, "missing payload becomes an empty object");

// --- a plan with no batches at all is soft (no validationError, just nothing to run) --
const planless = derivePlannerContract({ scenePlan: { scenes: [] } });
assert.equal(planless.validationError, null);
assert.deepEqual(planless.batches, []);

console.log("lib/maszynka-video/plannerContract.ts — all checks passed");
