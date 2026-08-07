// Seam-snap crop math (issue #28, ADR 0002): panels are cut at equal fractions of
// the layout declared in the gridGenerationPayload, and each cut line is snapped to
// a detected gutter — the strongest 1D gradient projection peak — within a ±5%
// window around the expected position. Pure math only (arrays in, numbers out):
// the Canvas/ImageData plumbing lives in the view, so this module runs under plain
// `node` for its synthetic-fixture check.

export interface GridLayout {
  rows: number;
  cols: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads the layout from the payload: a "RxC" string (rows×columns, e.g. "2x4" = 2
 *  rows of 4) under `layout` or `gridLayout`, or a {rows, cols} object. Layout
 *  semantics are OWNED by the planner prompt — when nothing parseable is declared,
 *  fall back to one row of `sceneCount` panels rather than guessing a matrix. */
export function gridLayoutFromPayload(payload: Record<string, unknown>, sceneCount: number): GridLayout {
  const declared = payload.layout ?? payload.gridLayout;
  if (typeof declared === "string") {
    const m = declared.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/);
    if (m) {
      const rows = Number(m[1]);
      const cols = Number(m[2]);
      if (rows >= 1 && cols >= 1) return { rows, cols };
    }
  }
  if (isPlainObject(declared) && typeof declared.rows === "number" && typeof declared.cols === "number") {
    const rows = Math.trunc(declared.rows);
    const cols = Math.trunc(declared.cols);
    if (rows >= 1 && cols >= 1) return { rows, cols };
  }
  return { rows: 1, cols: Math.max(1, sceneCount) };
}

/** Per-pixel luminance (BT.601) from RGBA bytes — the one ImageData-shaped input,
 *  kept here so the projection math is checkable against synthetic pixels. */
export function luminanceFromRgba(data: Uint8ClampedArray | number[], width: number, height: number): Float32Array {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return lum;
}

/** 1D gradient projection over a row-major luminance grid. For "vertical" cut lines
 *  the profile has `width-1` entries: profile[i] = Σ over y of |lum(i+1,y) − lum(i,y)|
 *  — i.e. the edge strength at the pixel boundary between columns i and i+1, which
 *  is cut position i+1. "horizontal" mirrors this over rows. */
export function gradientProfile(
  lum: Float32Array | number[],
  width: number,
  height: number,
  axis: "vertical" | "horizontal",
): number[] {
  if (axis === "vertical") {
    const profile = new Array<number>(Math.max(0, width - 1)).fill(0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width - 1; x++) {
        profile[x] += Math.abs(lum[y * width + x + 1] - lum[y * width + x]);
      }
    }
    return profile;
  }
  const profile = new Array<number>(Math.max(0, height - 1)).fill(0);
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      profile[y] += Math.abs(lum[(y + 1) * width + x] - lum[y * width + x]);
    }
  }
  return profile;
}

/** Snaps one expected cut position to the strongest gradient peak within
 *  ±windowRadius. A cut at position p sits on the boundary profile[p-1]. When the
 *  window has no decisive peak — a grid with no visible gutter there — the expected
 *  equal-fraction cut is kept rather than snapping to noise.
 *  ponytail: "decisive" = peak ≥ 2× the window mean; tune here if real grids misfire. */
export function snapCut(profile: number[], expected: number, windowRadius: number): number {
  const lo = Math.max(1, Math.ceil(expected - windowRadius));
  const hi = Math.min(profile.length, Math.floor(expected + windowRadius));
  if (lo > hi) return Math.round(expected);

  let best = lo;
  let bestVal = -Infinity;
  let sum = 0;
  for (let p = lo; p <= hi; p++) {
    const v = profile[p - 1];
    sum += v;
    if (v > bestVal) {
      bestVal = v;
      best = p;
    }
  }
  const mean = sum / (hi - lo + 1);
  if (bestVal <= 0 || bestVal < mean * 2) return Math.round(expected);
  return best;
}

/** All cut positions for `panels` equal panels along a dimension of `size` pixels,
 *  each snapped within ±`windowFrac` (spec: 5%) of the dimension. */
export function snapCutLines(profile: number[], size: number, panels: number, windowFrac = 0.05): number[] {
  const cuts: number[] = [];
  for (let i = 1; i < panels; i++) {
    cuts.push(snapCut(profile, (size * i) / panels, size * windowFrac));
  }
  return cuts;
}

export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Panel rectangles in row-major slot order (slot 0 = top-left), from the snapped
 *  cut positions. `colCuts`/`rowCuts` are the vertical/horizontal cut positions. */
export function panelRects(width: number, height: number, colCuts: number[], rowCuts: number[]): PanelRect[] {
  const xs = [0, ...colCuts, width];
  const ys = [0, ...rowCuts, height];
  const rects: PanelRect[] = [];
  for (let r = 0; r < ys.length - 1; r++) {
    for (let c = 0; c < xs.length - 1; c++) {
      rects.push({ x: xs[c], y: ys[r], width: xs[c + 1] - xs[c], height: ys[r + 1] - ys[r] });
    }
  }
  return rects;
}
