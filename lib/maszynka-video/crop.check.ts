// Runnable check for lib/maszynka-video/crop.ts — seam-snap math on synthetic
// gradient fixtures (issue #28 acceptance: cut lines snap to detected gutters
// within the ±5% window; a grid with slightly uneven panels still crops right).
// Run with:
//   node lib/maszynka-video/crop.check.ts   (or: npm run check:maszynka-video-crop)
// No test framework in this repo by design — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import {
  gradientProfile,
  gridLayoutFromPayload,
  luminanceFromRgba,
  panelRects,
  snapCut,
  snapCutLines,
} from "./crop.ts";

// --- layout parsing ------------------------------------------------------------------
assert.deepEqual(gridLayoutFromPayload({ layout: "2x2" }, 4), { rows: 2, cols: 2 });
assert.deepEqual(gridLayoutFromPayload({ layout: "1x3" }, 3), { rows: 1, cols: 3 });
assert.deepEqual(gridLayoutFromPayload({ layout: "2X4" }, 8), { rows: 2, cols: 4 }, "case-insensitive x");
assert.deepEqual(gridLayoutFromPayload({ gridLayout: "2 x 3" }, 6), { rows: 2, cols: 3 }, "spaces tolerated");
assert.deepEqual(gridLayoutFromPayload({ layout: { rows: 2, cols: 2 } }, 4), { rows: 2, cols: 2 });
assert.deepEqual(gridLayoutFromPayload({}, 3), { rows: 1, cols: 3 }, "no declared layout → one row of sceneCount");
assert.deepEqual(gridLayoutFromPayload({ layout: "0x2" }, 2), { rows: 1, cols: 2 }, "degenerate layout ignored");

// --- synthetic fixture: 100×4 image, two panels, a bright 4px gutter at x 48..51 -----
// Panels are dark (20), the gutter is bright (240) → the strongest vertical edges sit
// at the gutter borders (boundary 47→48 and 51→52).
const W = 100;
const H = 4;
const rgba: number[] = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const v = x >= 48 && x <= 51 ? 240 : 20;
    rgba.push(v, v, v, 255);
  }
}
const lum = luminanceFromRgba(rgba, W, H);
assert.equal(lum.length, W * H);
assert.ok(Math.abs(lum[0] - 20) < 0.001, "BT.601 of a gray pixel is the gray value");

const colProfile = gradientProfile(lum, W, H, "vertical");
assert.equal(colProfile.length, W - 1);
assert.ok(colProfile[47] > 0 && colProfile[51] > 0, "gutter borders must be the gradient peaks");
assert.equal(
  colProfile.filter((v) => v > 0).length,
  2,
  "flat panels contribute nothing to the projection",
);

// --- snap: the equal-fraction cut at 50 snaps onto the detected gutter edge ----------
const snapped = snapCut(colProfile, 50, 5);
assert.equal(snapped, 48, "cut snaps to the strongest boundary inside the ±5% window");
assert.deepEqual(snapCutLines(colProfile, W, 2), [48]);

// --- an OFF-CENTER gutter still gets caught (slightly uneven panels, spec's point) ---
// Same image but gutter at x 53..54: expected cut 50, window ±5 reaches it.
const rgba2: number[] = [];
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const v = x >= 53 && x <= 54 ? 240 : 20;
    rgba2.push(v, v, v, 255);
  }
}
const colProfile2 = gradientProfile(luminanceFromRgba(rgba2, W, H), W, H, "vertical");
assert.equal(snapCut(colProfile2, 50, 5), 53, "uneven grid: cut follows the gutter, not the fraction");

// --- no gutter at all → the equal-fraction cut is kept (no snapping to noise) --------
const flat = new Array(W - 1).fill(0);
assert.equal(snapCut(flat, 50, 5), 50);
const noisy = new Array(W - 1).fill(10); // uniform noise, no decisive peak
assert.equal(snapCut(noisy, 50, 5), 50, "a peak must be decisive (≥2× window mean) to win");

// --- horizontal axis mirrors the vertical one ----------------------------------------
// 4×100 image with a bright horizontal gutter at y 48..51.
const rgba3: number[] = [];
for (let y = 0; y < 100; y++) {
  for (let x = 0; x < 4; x++) {
    const v = y >= 48 && y <= 51 ? 240 : 20;
    rgba3.push(v, v, v, 255);
  }
}
const rowProfile = gradientProfile(luminanceFromRgba(rgba3, 4, 100), 4, 100, "horizontal");
assert.equal(rowProfile.length, 99);
assert.equal(snapCut(rowProfile, 50, 5), 48);

// --- panel rects: row-major slots from the snapped cuts ------------------------------
assert.deepEqual(panelRects(100, 80, [48], [40]), [
  { x: 0, y: 0, width: 48, height: 40 },
  { x: 48, y: 0, width: 52, height: 40 },
  { x: 0, y: 40, width: 48, height: 40 },
  { x: 48, y: 40, width: 52, height: 40 },
]);
assert.equal(panelRects(100, 50, [30, 60], []).length, 3, "1x3 layout → three rects, one row");

console.log("lib/maszynka-video/crop.ts — all checks passed");
