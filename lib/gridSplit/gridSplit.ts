// Grid-split PoC (standalone tool, independent from lib/maszynka-video/crop.ts —
// see AppMode "grid-split" in lib/types.ts). Detects and splits a single image
// containing an unknown-size grid of sub-images (2x2, 3x3, 4x4, ...) into
// individual crops, using OpenCV.js (WASM build of OpenCV, loaded lazily —
// see ./opencv.ts) running entirely client-side.
//
// Ported from a Python/OpenCV PoC validated against synthetic grids and real
// AI-generated grid images. Two detection paths:
//
// 1. Gutter detection (primary): per-row/column std-dev (cv.meanStdDev) finds
//    uniform background bands between cells. Contiguous non-gutter runs on
//    each axis are the cell bands directly -- no grid-size guess needed. A
//    band size-consistency gate rejects a false-positive gutter (a
//    coincidental low-variance streak inside real content) and reroutes to
//    the fallback.
// 2. Autocorrelation fallback (borderless grids): a Sobel gradient-energy
//    profile per axis (cv.Sobel + cv.reduce) is autocorrelated to surface the
//    repeating tile pitch even with no visible seam. The autocorrelation
//    itself is plain array math -- OpenCV has no "1-D signal autocorrelation"
//    primitive, so this part stays off-Mat. Candidate periods are filtered to
//    those whose lag divides the axis length into a near-integer tile count.
//
// Every cell then gets a local edge-trim pass (a whole-image gutter boundary
// is shared across a whole row/column, so one cell's content ending a few
// pixels early leaves a residual near-white strip that only a per-cell,
// local check catches) plus a small fixed safety inset (anti-aliasing at a
// hard-cut boundary blends ~1px of background into the content side
// regardless of local variance). Per-cell sharpness uses OpenCV's classic
// Laplacian-variance blur metric (cv.Laplacian + cv.meanStdDev).

import { loadOpenCv, type OpenCv } from "./opencv";

type Mat = ReturnType<OpenCv["matFromImageData"]>;

export type Band = { start: number; end: number };

export type GridCell = {
  row: number;
  col: number;
  x: number;
  y: number;
  width: number;
  height: number;
  stdDev: number;
  sharpness: number;
  isEmpty: boolean;
};

export type GridResult = {
  method: "gutter-detection" | "equal-split-fallback";
  rows: number;
  cols: number;
  confidence: number;
  cells: GridCell[];
};

// -- tunables (see grid_split.py ANALYSIS.md for how these were chosen) -----

const GUTTER_STD_THRESHOLD = 6.0;
const MIN_BAND_PX = 12;
const EMPTY_CELL_STD_THRESHOLD = 8.0;
const BAND_SIZE_SPREAD_THRESHOLD = 0.35;

const CELL_EDGE_TRIM_STD_THRESHOLD = 6.0;
const CELL_EDGE_TRIM_BRIGHTNESS_THRESHOLD = 200.0;
const CELL_EDGE_TRIM_MAX_FRACTION = 0.15;
const SAFETY_INSET_PX = 2;

const FALLBACK_PERIOD_TOLERANCE = 0.15;
const FALLBACK_MAX_TILES_PER_AXIS = 8;
const FALLBACK_MAX_PERIOD_FRACTION = 0.6;

// cv::ReduceTypes::REDUCE_SUM -- present at runtime as cv.REDUCE_SUM but
// missing from this build's .d.ts, so it can't be referenced by that name.
const CV_REDUCE_SUM = 0;

// -- plain-array helpers (band bookkeeping + autocorrelation only) ----------

function mean(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
}

function std(values: ArrayLike<number>): number {
  const m = mean(values);
  let sq = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - m;
    sq += d * d;
  }
  return Math.sqrt(sq / values.length);
}

function contentBands(isGutter: boolean[]): Band[] {
  const bands: Band[] = [];
  let start: number | null = null;
  for (let i = 0; i < isGutter.length; i++) {
    if (!isGutter[i] && start === null) start = i;
    else if (isGutter[i] && start !== null) {
      bands.push({ start, end: i });
      start = null;
    }
  }
  if (start !== null) bands.push({ start, end: isGutter.length });
  return bands.filter((b) => b.end - b.start >= MIN_BAND_PX);
}

function bandSize(b: Band): number {
  return b.end - b.start;
}

function relativeSizeSpread(bands: Band[]): number {
  if (bands.length < 2) return 0;
  const sizes = bands.map(bandSize);
  const m = mean(sizes);
  return m > 0 ? std(sizes) / m : 0;
}

// -- OpenCV Mat helpers -------------------------------------------------------

function meanStd(cv: OpenCv, mat: Mat): { mean: number; std: number } {
  const meanMat = new cv.Mat();
  const stdMat = new cv.Mat();
  cv.meanStdDev(mat, meanMat, stdMat);
  const result = { mean: meanMat.data64F[0], std: stdMat.data64F[0] };
  meanMat.delete();
  stdMat.delete();
  return result;
}

function rowStdProfile(cv: OpenCv, gray: Mat): Float64Array {
  const out = new Float64Array(gray.rows);
  for (let y = 0; y < gray.rows; y++) {
    const row = gray.row(y);
    out[y] = meanStd(cv, row).std;
    row.delete();
  }
  return out;
}

function colStdProfile(cv: OpenCv, gray: Mat): Float64Array {
  const out = new Float64Array(gray.cols);
  for (let x = 0; x < gray.cols; x++) {
    const col = gray.col(x);
    out[x] = meanStd(cv, col).std;
    col.delete();
  }
  return out;
}

// -- gutter-detection path ----------------------------------------------------

function detectGutterBands(cv: OpenCv, gray: Mat): { rows: Band[]; cols: Band[] } {
  const rowStd = rowStdProfile(cv, gray);
  const colStd = colStdProfile(cv, gray);
  const rowIsGutter = Array.from(rowStd, (v) => v < GUTTER_STD_THRESHOLD);
  const colIsGutter = Array.from(colStd, (v) => v < GUTTER_STD_THRESHOLD);
  return { rows: contentBands(rowIsGutter), cols: contentBands(colIsGutter) };
}

// -- autocorrelation fallback (borderless grids) ------------------------------

/** Gradient-energy profile along one axis: a Sobel first-derivative across
 *  that axis, absolute value, summed across the other axis (cv.reduce). */
function axisGradientProfile(cv: OpenCv, gray: Mat, axis: "row" | "col"): Float64Array {
  const grad = new cv.Mat();
  const absGrad = new cv.Mat();
  const reduced = new cv.Mat();
  try {
    if (axis === "row") {
      cv.Sobel(gray, grad, cv.CV_32F, 0, 1, 1);
      cv.convertScaleAbs(grad, absGrad);
      cv.reduce(absGrad, reduced, 1, CV_REDUCE_SUM, cv.CV_32F);
      return new Float64Array(reduced.data32F);
    }
    cv.Sobel(gray, grad, cv.CV_32F, 1, 0, 1);
    cv.convertScaleAbs(grad, absGrad);
    cv.reduce(absGrad, reduced, 0, CV_REDUCE_SUM, cv.CV_32F);
    return new Float64Array(reduced.data32F);
  } finally {
    grad.delete();
    absGrad.delete();
    reduced.delete();
  }
}

/** Direct (not FFT) autocorrelation -- axis profiles here are at most a few
 *  thousand samples, so O(n * maxLag) is fine for an interactive tool. */
function autocorrelation(profile: Float64Array, maxLag: number): Float64Array {
  const n = profile.length;
  const m = mean(profile);
  const centered = new Float64Array(n);
  for (let i = 0; i < n; i++) centered[i] = profile[i] - m;

  const acf = new Float64Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) sum += centered[i] * centered[i + lag];
    acf[lag] = sum;
  }
  return acf;
}

function localMaxima(values: Float64Array, offset: number): Array<{ score: number; lag: number }> {
  const peaks: Array<{ score: number; lag: number }> = [];
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > values[i - 1] && values[i] > values[i + 1]) {
      peaks.push({ score: values[i], lag: i + offset });
    }
  }
  return peaks;
}

function bestPeriodicTileCount(axisLen: number, profile: Float64Array): { tiles: number; score: number } {
  const maxLag = Math.floor(axisLen * FALLBACK_MAX_PERIOD_FRACTION);
  const acf = autocorrelation(profile, maxLag);
  const peaks = localMaxima(acf.subarray(MIN_BAND_PX), MIN_BAND_PX);

  let best: { score: number; tiles: number } | null = null;
  for (const { score, lag } of peaks) {
    const tiles = axisLen / lag;
    const rounded = Math.round(tiles);
    if (rounded < 1 || rounded > FALLBACK_MAX_TILES_PER_AXIS) continue;
    if (Math.abs(tiles - rounded) / rounded > FALLBACK_PERIOD_TOLERANCE) continue;
    if (best === null || score > best.score) best = { score, tiles: rounded };
  }
  return best ?? { tiles: 1, score: 0 };
}

function equalSplitFallback(cv: OpenCv, gray: Mat): { rows: Band[]; cols: Band[]; confidence: number } {
  const rowProfile = axisGradientProfile(cv, gray, "row");
  const colProfile = axisGradientProfile(cv, gray, "col");
  const { tiles: rowTiles } = bestPeriodicTileCount(gray.rows, rowProfile);
  const { tiles: colTiles } = bestPeriodicTileCount(gray.cols, colProfile);

  const rows: Band[] = Array.from({ length: rowTiles }, (_, i) => ({
    start: Math.round((i * gray.rows) / rowTiles),
    end: Math.round(((i + 1) * gray.rows) / rowTiles),
  }));
  const cols: Band[] = Array.from({ length: colTiles }, (_, i) => ({
    start: Math.round((i * gray.cols) / colTiles),
    end: Math.round(((i + 1) * gray.cols) / colTiles),
  }));

  const foundBothAxes = rowTiles > 1 && colTiles > 1;
  return { rows, cols, confidence: foundBothAxes ? 0.55 : 0.3 };
}

// -- per-cell edge trim + safety inset -----------------------------------------

function isBackgroundLine(cv: OpenCv, line: Mat): boolean {
  const { mean: m, std: s } = meanStd(cv, line);
  return s < CELL_EDGE_TRIM_STD_THRESHOLD && m > CELL_EDGE_TRIM_BRIGHTNESS_THRESHOLD;
}

function trimCellEdges(
  cv: OpenCv,
  gray: Mat,
  x: number,
  y: number,
  w: number,
  h: number,
): { top: number; bottom: number; left: number; right: number } {
  const maxRowTrim = Math.floor(h * CELL_EDGE_TRIM_MAX_FRACTION);
  const maxColTrim = Math.floor(w * CELL_EDGE_TRIM_MAX_FRACTION);

  const isBgRow = (ry: number) => {
    const line = gray.roi(new cv.Rect(x, y + ry, w, 1));
    const bg = isBackgroundLine(cv, line);
    line.delete();
    return bg;
  };
  const isBgCol = (cx: number) => {
    const line = gray.roi(new cv.Rect(x + cx, y, 1, h));
    const bg = isBackgroundLine(cv, line);
    line.delete();
    return bg;
  };

  let top = 0;
  while (top < maxRowTrim && isBgRow(top)) top++;
  let bottom = 0;
  while (bottom < maxRowTrim && isBgRow(h - 1 - bottom)) bottom++;
  let left = 0;
  while (left < maxColTrim && isBgCol(left)) left++;
  let right = 0;
  while (right < maxColTrim && isBgCol(w - 1 - right)) right++;

  return { top, bottom, left, right };
}

// -- cell stats + assembly ------------------------------------------------------

function cellStats(cv: OpenCv, gray: Mat, x: number, y: number, w: number, h: number) {
  const roi = gray.roi(new cv.Rect(x, y, w, h));
  const { std: stdDev } = meanStd(cv, roi);

  let sharpness = 0;
  if (w >= 3 && h >= 3) {
    const lap = new cv.Mat();
    cv.Laplacian(roi, lap, cv.CV_32F);
    const { std: lapStd } = meanStd(cv, lap);
    sharpness = lapStd * lapStd;
    lap.delete();
  }
  roi.delete();

  return { stdDev, sharpness };
}

function buildCells(cv: OpenCv, gray: Mat, rowBands: Band[], colBands: Band[]): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = 0; r < rowBands.length; r++) {
    for (let c = 0; c < colBands.length; c++) {
      let x = colBands[c].start;
      let y = rowBands[r].start;
      let w = colBands[c].end - x;
      let h = rowBands[r].end - y;

      const trim = trimCellEdges(cv, gray, x, y, w, h);
      const top = trim.top + SAFETY_INSET_PX;
      const bottom = trim.bottom + SAFETY_INSET_PX;
      const left = trim.left + SAFETY_INSET_PX;
      const right = trim.right + SAFETY_INSET_PX;
      x += left;
      y += top;
      w = Math.max(w - left - right, 1);
      h = Math.max(h - top - bottom, 1);

      const { stdDev, sharpness } = cellStats(cv, gray, x, y, w, h);
      cells.push({ row: r, col: c, x, y, width: w, height: h, stdDev, sharpness, isEmpty: stdDev < EMPTY_CELL_STD_THRESHOLD });
    }
  }
  return cells;
}

// -- top-level entry ------------------------------------------------------------

export async function detectGrid(imageData: ImageData): Promise<GridResult> {
  const cv = await loadOpenCv();
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();

  try {
    const { rows: rowBands, cols: colBands } = detectGutterBands(cv, gray);

    const plausibleBandCount = rowBands.length * colBands.length > 1 && (rowBands.length > 1 || colBands.length > 1);
    const consistentSizes =
      relativeSizeSpread(rowBands) < BAND_SIZE_SPREAD_THRESHOLD && relativeSizeSpread(colBands) < BAND_SIZE_SPREAD_THRESHOLD;

    if (plausibleBandCount && consistentSizes) {
      const cells = buildCells(cv, gray, rowBands, colBands);
      const sizes = cells.map((c) => [c.width, c.height]);
      const meanW = mean(sizes.map((s) => s[0]));
      const meanH = mean(sizes.map((s) => s[1]));
      const stdW = std(sizes.map((s) => s[0]));
      const stdH = std(sizes.map((s) => s[1]));
      const sizeConsistency = 1 - Math.min(((stdW + stdH) / 2) / Math.max((meanW + meanH) / 2, 1), 1);
      return {
        method: "gutter-detection",
        rows: rowBands.length,
        cols: colBands.length,
        confidence: Math.round((0.5 + 0.5 * sizeConsistency) * 100) / 100,
        cells,
      };
    }

    const fallback = equalSplitFallback(cv, gray);
    const cells = buildCells(cv, gray, fallback.rows, fallback.cols);
    return {
      method: "equal-split-fallback",
      rows: fallback.rows.length,
      cols: fallback.cols.length,
      confidence: fallback.confidence,
      cells,
    };
  } finally {
    gray.delete();
  }
}
