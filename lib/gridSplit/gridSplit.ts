// Grid-split PoC (standalone tool, independent from lib/maszynka-video/crop.ts —
// see AppMode "grid-split" in lib/types.ts). Detects and splits a single image
// containing an unknown-size grid of sub-images (2x2, 3x3, 4x4, ...) into
// individual crops, entirely client-side (plain Canvas pixel math, no CV lib).
//
// Ported from a Python/OpenCV PoC validated against synthetic grids and real
// AI-generated grid images. Two detection paths:
//
// 1. Gutter detection (primary): per-row/column pixel std-dev finds uniform
//    background bands between cells. Contiguous non-gutter runs on each axis
//    are the cell bands directly -- no grid-size guess needed. A band
//    size-consistency gate rejects a false-positive gutter (a coincidental
//    low-variance streak inside real content) and reroutes to the fallback.
// 2. Autocorrelation fallback (borderless grids): direct autocorrelation of
//    each axis's gradient-energy profile surfaces the repeating tile pitch
//    even with no visible seam. Candidate periods are filtered to those whose
//    lag divides the axis length into a near-integer tile count.
//
// Every cell then gets a local edge-trim pass (a whole-image gutter boundary
// is shared across a whole row/column, so one cell's content ending a few
// pixels early leaves a residual near-white strip that only a per-cell,
// local check catches) plus a small fixed safety inset (anti-aliasing at a
// hard-cut boundary blends ~1px of background into the content side
// regardless of local variance).

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

// -- pixel helpers ------------------------------------------------------------

/** Grayscale (ITU-R BT.601 luma), one value per pixel, row-major. */
export function toGray(rgba: Uint8ClampedArray, width: number, height: number): Float64Array {
  const gray = new Float64Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }
  return gray;
}

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

function rowSlice(gray: Float64Array, width: number, y: number): Float64Array {
  return gray.subarray(y * width, (y + 1) * width);
}

function colSlice(gray: Float64Array, width: number, height: number, x: number): Float64Array {
  const out = new Float64Array(height);
  for (let y = 0; y < height; y++) out[y] = gray[y * width + x];
  return out;
}

function rowStdProfile(gray: Float64Array, width: number, height: number): Float64Array {
  const out = new Float64Array(height);
  for (let y = 0; y < height; y++) out[y] = std(rowSlice(gray, width, y));
  return out;
}

function colStdProfile(gray: Float64Array, width: number, height: number): Float64Array {
  const out = new Float64Array(width);
  for (let x = 0; x < width; x++) out[x] = std(colSlice(gray, width, height, x));
  return out;
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

// -- gutter-detection path ----------------------------------------------------

function detectGutterBands(gray: Float64Array, width: number, height: number): { rows: Band[]; cols: Band[] } {
  const rowStd = rowStdProfile(gray, width, height);
  const colStd = colStdProfile(gray, width, height);
  const rowIsGutter = Array.from(rowStd, (v) => v < GUTTER_STD_THRESHOLD);
  const colIsGutter = Array.from(colStd, (v) => v < GUTTER_STD_THRESHOLD);
  return { rows: contentBands(rowIsGutter), cols: contentBands(colIsGutter) };
}

// -- autocorrelation fallback (borderless grids) ------------------------------

function axisGradientProfile(gray: Float64Array, width: number, height: number, axis: "row" | "col"): Float64Array {
  // Simple central-difference gradient magnitude, summed across the other axis.
  if (axis === "row") {
    const out = new Float64Array(height);
    for (let y = 0; y < height; y++) {
      let sum = 0;
      const y0 = Math.max(y - 1, 0);
      const y1 = Math.min(y + 1, height - 1);
      for (let x = 0; x < width; x++) {
        sum += Math.abs(gray[y1 * width + x] - gray[y0 * width + x]);
      }
      out[y] = sum;
    }
    return out;
  }
  const out = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    let sum = 0;
    const x0 = Math.max(x - 1, 0);
    const x1 = Math.min(x + 1, width - 1);
    for (let y = 0; y < height; y++) {
      sum += Math.abs(gray[y * width + x1] - gray[y * width + x0]);
    }
    out[x] = sum;
  }
  return out;
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

function equalSplitFallback(
  gray: Float64Array,
  width: number,
  height: number,
): { rows: Band[]; cols: Band[]; confidence: number } {
  const rowProfile = axisGradientProfile(gray, width, height, "row");
  const colProfile = axisGradientProfile(gray, width, height, "col");
  const { tiles: rowTiles } = bestPeriodicTileCount(height, rowProfile);
  const { tiles: colTiles } = bestPeriodicTileCount(width, colProfile);

  const rows: Band[] = Array.from({ length: rowTiles }, (_, i) => ({
    start: Math.round((i * height) / rowTiles),
    end: Math.round(((i + 1) * height) / rowTiles),
  }));
  const cols: Band[] = Array.from({ length: colTiles }, (_, i) => ({
    start: Math.round((i * width) / colTiles),
    end: Math.round(((i + 1) * width) / colTiles),
  }));

  const foundBothAxes = rowTiles > 1 && colTiles > 1;
  return { rows, cols, confidence: foundBothAxes ? 0.55 : 0.3 };
}

// -- per-cell edge trim + safety inset -----------------------------------------

function isBackgroundLine(line: Float64Array): boolean {
  return std(line) < CELL_EDGE_TRIM_STD_THRESHOLD && mean(line) > CELL_EDGE_TRIM_BRIGHTNESS_THRESHOLD;
}

function trimCellEdges(
  gray: Float64Array,
  fullWidth: number,
  x: number,
  y: number,
  w: number,
  h: number,
): { top: number; bottom: number; left: number; right: number } {
  const maxRowTrim = Math.floor(h * CELL_EDGE_TRIM_MAX_FRACTION);
  const maxColTrim = Math.floor(w * CELL_EDGE_TRIM_MAX_FRACTION);

  const rowAt = (ry: number) => gray.subarray((y + ry) * fullWidth + x, (y + ry) * fullWidth + x + w);
  const colAt = (cx: number) => {
    const out = new Float64Array(h);
    for (let ry = 0; ry < h; ry++) out[ry] = gray[(y + ry) * fullWidth + x + cx];
    return out;
  };

  let top = 0;
  while (top < maxRowTrim && isBackgroundLine(rowAt(top))) top++;
  let bottom = 0;
  while (bottom < maxRowTrim && isBackgroundLine(rowAt(h - 1 - bottom))) bottom++;
  let left = 0;
  while (left < maxColTrim && isBackgroundLine(colAt(left))) left++;
  let right = 0;
  while (right < maxColTrim && isBackgroundLine(colAt(w - 1 - right))) right++;

  return { top, bottom, left, right };
}

// -- cell stats + assembly ------------------------------------------------------

function cellStats(gray: Float64Array, fullWidth: number, x: number, y: number, w: number, h: number) {
  const values = new Float64Array(w * h);
  for (let ry = 0; ry < h; ry++) {
    for (let rx = 0; rx < w; rx++) {
      values[ry * w + rx] = gray[(y + ry) * fullWidth + (x + rx)];
    }
  }
  const stdDev = std(values);

  // Laplacian variance ("sharpness") over the same crop.
  let sharpSum = 0;
  let sharpSumSq = 0;
  let count = 0;
  for (let ry = 1; ry < h - 1; ry++) {
    for (let rx = 1; rx < w - 1; rx++) {
      const c = gray[(y + ry) * fullWidth + (x + rx)];
      const up = gray[(y + ry - 1) * fullWidth + (x + rx)];
      const down = gray[(y + ry + 1) * fullWidth + (x + rx)];
      const left = gray[(y + ry) * fullWidth + (x + rx - 1)];
      const right = gray[(y + ry) * fullWidth + (x + rx + 1)];
      const lap = up + down + left + right - 4 * c;
      sharpSum += lap;
      sharpSumSq += lap * lap;
      count++;
    }
  }
  const sharpMean = count > 0 ? sharpSum / count : 0;
  const sharpness = count > 0 ? sharpSumSq / count - sharpMean * sharpMean : 0;

  return { stdDev, sharpness };
}

function buildCells(gray: Float64Array, width: number, rowBands: Band[], colBands: Band[]): GridCell[] {
  const cells: GridCell[] = [];
  for (let r = 0; r < rowBands.length; r++) {
    for (let c = 0; c < colBands.length; c++) {
      let x = colBands[c].start;
      let y = rowBands[r].start;
      let w = colBands[c].end - x;
      let h = rowBands[r].end - y;

      const trim = trimCellEdges(gray, width, x, y, w, h);
      const top = trim.top + SAFETY_INSET_PX;
      const bottom = trim.bottom + SAFETY_INSET_PX;
      const left = trim.left + SAFETY_INSET_PX;
      const right = trim.right + SAFETY_INSET_PX;
      x += left;
      y += top;
      w = Math.max(w - left - right, 1);
      h = Math.max(h - top - bottom, 1);

      const { stdDev, sharpness } = cellStats(gray, width, x, y, w, h);
      cells.push({ row: r, col: c, x, y, width: w, height: h, stdDev, sharpness, isEmpty: stdDev < EMPTY_CELL_STD_THRESHOLD });
    }
  }
  return cells;
}

// -- top-level entry ------------------------------------------------------------

export function detectGrid(rgba: Uint8ClampedArray, width: number, height: number): GridResult {
  const gray = toGray(rgba, width, height);
  const { rows: rowBands, cols: colBands } = detectGutterBands(gray, width, height);

  const plausibleBandCount = rowBands.length * colBands.length > 1 && (rowBands.length > 1 || colBands.length > 1);
  const consistentSizes =
    relativeSizeSpread(rowBands) < BAND_SIZE_SPREAD_THRESHOLD && relativeSizeSpread(colBands) < BAND_SIZE_SPREAD_THRESHOLD;

  if (plausibleBandCount && consistentSizes) {
    const cells = buildCells(gray, width, rowBands, colBands);
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

  const fallback = equalSplitFallback(gray, width, height);
  const cells = buildCells(gray, width, fallback.rows, fallback.cols);
  return {
    method: "equal-split-fallback",
    rows: fallback.rows.length,
    cols: fallback.cols.length,
    confidence: fallback.confidence,
    cells,
  };
}
