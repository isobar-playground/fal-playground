// Grid-split PoC (standalone tool, independent from lib/maszynka-video/crop.ts —
// see AppMode "grid-split" in lib/types.ts). Detects and splits a single image
// containing an unknown-size grid of sub-images (2x2, 3x3, 4x4, ...) into
// individual crops, using OpenCV.js (WASM build of OpenCV, loaded lazily —
// see ./opencv.ts) running entirely client-side.
//
// Ported from a Python/OpenCV PoC validated against synthetic grids and real
// AI-generated grid images. Two detection paths, per axis:
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
// Row bands are detected once, globally, and so are column bands (using the
// *whole* image -- a std-dev estimate from one row's worth of samples alone
// is too noisy on a real photo to agree row-to-row on where a genuine
// column boundary is). Those global column bands apply to every row, UNLESS
// one row's own, row-scoped gutter read is both clean/confident and a
// different count than the global one -- that's a real "justified"/masonry
// row (fewer, wider cells than the rows above, e.g. 3 images stretched to
// fill the row instead of a 4th empty slot), not measurement noise, and a
// single global column grid can't represent it. A result is
// "gutter-detection" only if every row (and the row axis itself) found a
// real gutter; "hybrid" if some but not all did; "equal-split-fallback" if
// none did.
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
  // "hybrid": some axis/row detections found a real gutter (border), others
  // fell back to periodicity detection (thin/noisy margin, JPEG smear, a
  // genuinely borderless row, or a masonry-style last row) -- not a uniform
  // failure, but not a clean all-gutter grid either.
  method: "gutter-detection" | "hybrid" | "equal-split-fallback";
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
// A per-row column override (see ownGutterColumnBands) must have every band
// be at least this fraction of the row's width -- rejects a spurious sliver
// (a noise-triggered false gutter through a plain patch of one real photo)
// without rejecting a genuine but UNEVEN justified row (e.g. two normal-width
// photos plus one roughly double-width photo filling the rest of the row).
const MIN_ROW_BAND_FRACTION = 0.1;

const CELL_EDGE_TRIM_STD_THRESHOLD = 6.0;
const CELL_EDGE_TRIM_BRIGHTNESS_THRESHOLD = 200.0;
const CELL_EDGE_TRIM_MAX_FRACTION = 0.15;
const SAFETY_INSET_PX = 2;

const FALLBACK_PERIOD_TOLERANCE = 0.15;
const FALLBACK_MAX_TILES_PER_AXIS = 8;
const FALLBACK_MAX_PERIOD_FRACTION = 0.6;
const FALLBACK_MIN_PEAK_STRENGTH = 0.2;

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

function gutterRowBands(cv: OpenCv, mat: Mat): Band[] {
  const rowStd = rowStdProfile(cv, mat);
  return contentBands(Array.from(rowStd, (v) => v < GUTTER_STD_THRESHOLD));
}

function gutterColBands(cv: OpenCv, mat: Mat): Band[] {
  const colStd = colStdProfile(cv, mat);
  return contentBands(Array.from(colStd, (v) => v < GUTTER_STD_THRESHOLD));
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
    // Normalize by the overlap length: a raw sum has strictly more terms at
    // small lags (n - lag terms), which biases peak-picking toward short,
    // spurious periods (fine texture) over the true, larger grid pitch.
    acf[lag] = sum / (n - lag);
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

  // acf[lag] is a covariance; normalize by the profile's own variance so
  // peak strength is a correlation coefficient (~[-1, 1]), comparable across
  // images/axes. Without this, any image has *some* best-scoring peak even
  // when the axis has no real grid structure, and a "1 tile" (no split) axis
  // never wins purely on raw covariance magnitude.
  const variance = std(profile) ** 2;

  let best: { score: number; tiles: number } | null = null;
  for (const { score, lag } of peaks) {
    const tiles = axisLen / lag;
    const rounded = Math.round(tiles);
    if (rounded < 1 || rounded > FALLBACK_MAX_TILES_PER_AXIS) continue;
    if (Math.abs(tiles - rounded) / rounded > FALLBACK_PERIOD_TOLERANCE) continue;
    const normalizedScore = variance > 0 ? score / variance : 0;
    if (normalizedScore < FALLBACK_MIN_PEAK_STRENGTH) continue;
    if (best === null || normalizedScore > best.score) best = { score: normalizedScore, tiles: rounded };
  }
  return best ?? { tiles: 1, score: 0 };
}

/** Equal-width/height bands for one axis, from its periodicity (see
 *  bestPeriodicTileCount). Used both for the full autocorrelation fallback
 *  and, per-axis, by the gutter/fallback hybrid below. */
function fallbackBands(cv: OpenCv, gray: Mat, axis: "row" | "col"): { bands: Band[]; tiles: number } {
  const axisLen = axis === "row" ? gray.rows : gray.cols;
  const profile = axisGradientProfile(cv, gray, axis);
  const { tiles } = bestPeriodicTileCount(axisLen, profile);
  const bands: Band[] = Array.from({ length: tiles }, (_, i) => ({
    start: Math.round((i * axisLen) / tiles),
    end: Math.round(((i + 1) * axisLen) / tiles),
  }));
  return { bands, tiles };
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

// One row can have its own column layout (a "justified"/masonry last row
// with fewer, wider cells is a real, common case -- see CFD2-550 follow-up),
// so columns are detected and stored per row rather than once globally.
function buildCells(cv: OpenCv, gray: Mat, rowBands: Band[], colBandsPerRow: Band[][]): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = 0; r < rowBands.length; r++) {
    const colBands = colBandsPerRow[r];
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

/** Confidence from how consistently-sized the built cells came out --
 *  meaningful whenever real (gutter-derived) bands are involved, on either
 *  or both axes. */
function sizeConsistencyConfidence(cells: GridCell[]): number {
  const sizes = cells.map((c) => [c.width, c.height]);
  const meanW = mean(sizes.map((s) => s[0]));
  const meanH = mean(sizes.map((s) => s[1]));
  const stdW = std(sizes.map((s) => s[0]));
  const stdH = std(sizes.map((s) => s[1]));
  const sizeConsistency = 1 - Math.min(((stdW + stdH) / 2) / Math.max((meanW + meanH) / 2, 1), 1);
  return Math.round((0.5 + 0.5 * sizeConsistency) * 100) / 100;
}

/** Internal boundary positions between consecutive bands (not the outer
 *  image edges) -- the midpoint of each gap. */
function bandBoundaries(bands: Band[]): number[] {
  const boundaries: number[] = [];
  for (let i = 0; i < bands.length - 1; i++) boundaries.push((bands[i].end + bands[i + 1].start) / 2);
  return boundaries;
}

const BOUNDARY_ALIGN_TOLERANCE_PX = 20;

/** True if `candidate` has at least one internal boundary that ISN'T close
 *  to any boundary in `reference`. A row whose own read just finds a subset
 *  of the SAME boundaries as the global grid (e.g. missed 2 of 3 real
 *  internal gutters because two adjacent photos happen to share a similar
 *  color there) is not "different" -- it's an incomplete read of the same
 *  structure, and the global grid already covers it more completely. Only a
 *  boundary at a genuinely new position is evidence of a real, different
 *  layout (see CFD2-550 follow-up: a real photo where several rows have a
 *  weak/undetectable middle-ish gutter, easily confused for "this row only
 *  has 2 cells" if judged by band count alone). */
function hasNovelBoundary(candidate: Band[], reference: Band[]): boolean {
  const candidateBoundaries = bandBoundaries(candidate);
  const referenceBoundaries = bandBoundaries(reference);
  return candidateBoundaries.some((cb) => referenceBoundaries.every((rb) => Math.abs(cb - rb) > BOUNDARY_ALIGN_TOLERANCE_PX));
}

function axisLooksGutterBased(bands: Band[]): boolean {
  return bands.length > 1 && relativeSizeSpread(bands) < BAND_SIZE_SPREAD_THRESHOLD;
}

/** Looser than axisLooksGutterBased: accepts real but UNEVENLY-sized bands
 *  (a justified row's cells needn't match each other in width) while still
 *  rejecting a noise-triggered sliver band (each band must be a meaningful
 *  fraction of the axis, not just non-empty). */
function looksLikeRealBands(bands: Band[], axisLen: number): boolean {
  return bands.length > 1 && bands.every((b) => bandSize(b) >= axisLen * MIN_ROW_BAND_FRACTION);
}

/** Row bands, globally: a real gutter (border) if the whole-width row
 *  profile shows one, else the row-axis periodicity fallback. */
function detectRowBands(cv: OpenCv, gray: Mat): { bands: Band[]; usedGutter: boolean } {
  const bands = gutterRowBands(cv, gray);
  if (axisLooksGutterBased(bands)) return { bands, usedGutter: true };
  return { bands: fallbackBands(cv, gray, "row").bands, usedGutter: false };
}

/** Column bands, globally: a real gutter if the whole-height column profile
 *  shows one, else the column-axis periodicity fallback. Using the *whole*
 *  image (not one row) is what makes this robust on a real (noisy/JPEG)
 *  photo -- a std-dev estimate from a single row's worth of samples is
 *  noisy enough to disagree row-to-row on where a real column boundary is. */
function detectGlobalColumnBands(cv: OpenCv, gray: Mat): { bands: Band[]; usedGutter: boolean } {
  const bands = gutterColBands(cv, gray);
  if (axisLooksGutterBased(bands)) return { bands, usedGutter: true };
  return { bands: fallbackBands(cv, gray, "col").bands, usedGutter: false };
}

/** This row's OWN column gutters, scoped to just its height -- used only to
 *  detect a row that genuinely differs from the rest (a "justified"/masonry
 *  last row: fewer, wider cells than the uniform rows above it -- see
 *  CFD2-550 follow-up). Deliberately raw (no fallback): a clean, confident
 *  gutter read here is trustworthy; a noisy/absent one is not, so the
 *  caller falls back to the globally-robust column bands instead. */
function ownGutterColumnBands(cv: OpenCv, gray: Mat, rowBand: Band): Band[] {
  const rowMat = gray.roi(new cv.Rect(0, rowBand.start, gray.cols, rowBand.end - rowBand.start));
  try {
    return gutterColBands(cv, rowMat);
  } finally {
    rowMat.delete();
  }
}

// -- top-level entry ------------------------------------------------------------

export async function detectGrid(imageData: ImageData): Promise<GridResult> {
  const cv = await loadOpenCv();
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  src.delete();

  try {
    const { bands: rowBands, usedGutter: rowsUsedGutter } = detectRowBands(cv, gray);
    const globalCols = detectGlobalColumnBands(cv, gray);

    let anyGutter = rowsUsedGutter;
    let allGutter = rowsUsedGutter;
    const colBandsPerRow: Band[][] = rowBands.map((rowBand) => {
      const own = ownGutterColumnBands(cv, gray, rowBand);

      const rowMat = gray.roi(new cv.Rect(0, rowBand.start, gray.cols, rowBand.end - rowBand.start));
      let ownFallback: { bands: Band[]; tiles: number };
      try {
        ownFallback = fallbackBands(cv, rowMat, "col");
      } finally {
        rowMat.delete();
      }

      // Trust this row's own gutter read only if it's real (each band a
      // substantial chunk of the row -- not required to be evenly sized,
      // since a justified row's cells can legitimately differ in width) AND
      // has a boundary at a genuinely different position than the global
      // grid -- not just a subset of it (see hasNovelBoundary).
      if (looksLikeRealBands(own, gray.cols) && hasNovelBoundary(own, globalCols.bands)) {
        anyGutter = true;
        return own;
      }

      // No usable/confirmed real gutter in this row specifically (its
      // images may sit flush against each other with no margin, unlike the
      // rows above) -- fall back to this row's own periodicity alone, same
      // novel-boundary bar. bestPeriodicTileCount already enforces a
      // minimum peak strength, so a low-confidence/noisy read naturally
      // yields tiles=1 (no internal boundaries at all) and is skipped.
      if (ownFallback.tiles > 1 && hasNovelBoundary(ownFallback.bands, globalCols.bands)) {
        allGutter = false;
        return ownFallback.bands;
      }

      anyGutter = anyGutter || globalCols.usedGutter;
      allGutter = allGutter && globalCols.usedGutter;
      return globalCols.bands;
    });

    const cells = buildCells(cv, gray, rowBands, colBandsPerRow);
    const maxCols = colBandsPerRow.reduce((max, bands) => Math.max(max, bands.length), 0);

    const method: GridResult["method"] = allGutter ? "gutter-detection" : anyGutter ? "hybrid" : "equal-split-fallback";
    const confidence =
      method === "equal-split-fallback"
        ? rowBands.length > 1 && maxCols > 1
          ? 0.55
          : 0.3
        : sizeConsistencyConfidence(cells);

    return { method, rows: rowBands.length, cols: maxCols, confidence, cells };
  } finally {
    gray.delete();
  }
}
