// Model catalog + price estimation. Prices are hardcoded from the Fal model
// pages (June 2026), USD per output image. They are estimates — Fal is the
// source of truth for actual billing.

export type ModelMode = "generate" | "edit";
export type GptQuality = "low" | "medium" | "high";
export type ModelFamily =
  | "nano-banana"
  | "nano-banana-2"
  | "nano-banana-pro"
  | "gpt-image-1"
  | "gpt-image-2";

export interface SizeOption {
  value: string;
  label: string;
}

export interface ModelControls {
  resolutions?: string[]; // nano-banana-2 / pro
  quality?: boolean; // gpt-image
  sizes?: SizeOption[]; // gpt-image
}

export interface ModelDef {
  key: string;
  id: string; // Fal endpoint id
  label: string;
  group: string;
  family: ModelFamily;
  mode: ModelMode;
  needsReferences: boolean;
  blurb: string;
  controls: ModelControls;
}

export interface ModelSettings {
  numImages: number;
  quality: GptQuality;
  size: string; // gpt-image size key
  resolution: string; // nano-banana-2 / pro
}

export const DEFAULT_SETTINGS: ModelSettings = {
  numImages: 1,
  quality: "medium",
  size: "",
  resolution: "",
};

const NB2_RES = ["512px", "1K", "2K", "4K"];
const NBP_RES = ["1K", "2K", "4K"];

const GPT1_SIZES: SizeOption[] = [
  { value: "1024x1024", label: "Square 1024²" },
  { value: "1536x1024", label: "Landscape 1536×1024" },
  { value: "1024x1536", label: "Portrait 1024×1536" },
];

const GPT2_SIZES: SizeOption[] = [
  { value: "1024x1024", label: "Square 1024²" },
  { value: "1024x768", label: "Landscape 1024×768" },
  { value: "1024x1536", label: "Portrait 1024×1536" },
  { value: "3840x2160", label: "4K 3840×2160" },
];

const QUALITIES: GptQuality[] = ["low", "medium", "high"];

export const QUALITY_LABELS: Record<GptQuality, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export const RESOLUTION_LABELS: Record<string, string> = {
  "512px": "0.5K",
  "1K": "1K",
  "2K": "2K",
  "4K": "4K",
};

// --- price tables (USD / image) -----------------------------------------

const GPT1_PRICE: Record<string, Record<GptQuality, number>> = {
  "1024x1024": { low: 0.011, medium: 0.042, high: 0.167 },
  "1536x1024": { low: 0.016, medium: 0.063, high: 0.25 },
  "1024x1536": { low: 0.016, medium: 0.063, high: 0.25 },
};

const GPT2_PRICE: Record<string, Record<GptQuality, number>> = {
  "1024x1024": { low: 0.006, medium: 0.053, high: 0.211 },
  "1024x768": { low: 0.005, medium: 0.037, high: 0.145 },
  "1024x1536": { low: 0.005, medium: 0.042, high: 0.165 },
  "3840x2160": { low: 0.012, medium: 0.101, high: 0.401 },
};

const NB2_PRICE: Record<string, number> = { "512px": 0.06, "1K": 0.08, "2K": 0.12, "4K": 0.16 };
const NBP_PRICE: Record<string, number> = { "1K": 0.15, "2K": 0.15, "4K": 0.3 };

// --- catalog ------------------------------------------------------------

const GOOGLE = "Google · Nano Banana";
const OPENAI = "OpenAI · GPT Image";

export const MODELS: ModelDef[] = [
  {
    key: "nano-banana",
    id: "fal-ai/nano-banana",
    label: "Nano Banana",
    group: GOOGLE,
    family: "nano-banana",
    mode: "generate",
    needsReferences: false,
    blurb: "Original Gemini Flash image model. Cheap and fast.",
    controls: {},
  },
  {
    key: "nano-banana-edit",
    id: "fal-ai/nano-banana/edit",
    label: "Nano Banana — edit",
    group: GOOGLE,
    family: "nano-banana",
    mode: "edit",
    needsReferences: true,
    blurb: "Edit or combine reference images.",
    controls: {},
  },
  {
    key: "nano-banana-2",
    id: "fal-ai/nano-banana-2",
    label: "Nano Banana 2",
    group: GOOGLE,
    family: "nano-banana-2",
    mode: "generate",
    needsReferences: false,
    blurb: "New fast model. Resolution up to 4K.",
    controls: { resolutions: NB2_RES },
  },
  {
    key: "nano-banana-2-edit",
    id: "fal-ai/nano-banana-2/edit",
    label: "Nano Banana 2 — edit",
    group: GOOGLE,
    family: "nano-banana-2",
    mode: "edit",
    needsReferences: true,
    blurb: "Edit with up to 14 reference images.",
    controls: { resolutions: NB2_RES },
  },
  {
    key: "nano-banana-pro",
    id: "fal-ai/nano-banana-pro",
    label: "Nano Banana Pro",
    group: GOOGLE,
    family: "nano-banana-pro",
    mode: "generate",
    needsReferences: false,
    blurb: "State-of-the-art realism & typography (Gemini 3 Pro Image).",
    controls: { resolutions: NBP_RES },
  },
  {
    key: "nano-banana-pro-edit",
    id: "fal-ai/nano-banana-pro/edit",
    label: "Nano Banana Pro — edit",
    group: GOOGLE,
    family: "nano-banana-pro",
    mode: "edit",
    needsReferences: true,
    blurb: "Pro editing with reference images.",
    controls: { resolutions: NBP_RES },
  },
  {
    key: "gpt-image-1",
    id: "fal-ai/gpt-image-1/text-to-image",
    label: "GPT Image 1",
    group: OPENAI,
    family: "gpt-image-1",
    mode: "generate",
    needsReferences: false,
    blurb: "OpenAI GPT Image 1.",
    controls: { quality: true, sizes: GPT1_SIZES },
  },
  {
    key: "gpt-image-1-edit",
    id: "fal-ai/gpt-image-1/edit-image",
    label: "GPT Image 1 — edit",
    group: OPENAI,
    family: "gpt-image-1",
    mode: "edit",
    needsReferences: true,
    blurb: "GPT Image 1 with reference images.",
    controls: { quality: true, sizes: GPT1_SIZES },
  },
  {
    key: "gpt-image-2",
    id: "openai/gpt-image-2",
    label: "GPT Image 2",
    group: OPENAI,
    family: "gpt-image-2",
    mode: "generate",
    needsReferences: false,
    blurb: "OpenAI's latest. Fine detail & typography, up to 4K.",
    controls: { quality: true, sizes: GPT2_SIZES },
  },
  {
    key: "gpt-image-2-edit",
    id: "fal-ai/gpt-image-2/image-to-image",
    label: "GPT Image 2 — edit",
    group: OPENAI,
    family: "gpt-image-2",
    mode: "edit",
    needsReferences: true,
    blurb: "GPT Image 2 with reference images.",
    controls: { quality: true, sizes: GPT2_SIZES },
  },
];

export const MODEL_BY_KEY: Record<string, ModelDef> = Object.fromEntries(
  MODELS.map((m) => [m.key, m]),
);

export const MODEL_GROUPS: string[] = [...new Set(MODELS.map((m) => m.group))];

// --- pricing + request building -----------------------------------------

export function effectiveSize(model: ModelDef, s: ModelSettings): string {
  const opts = model.controls.sizes;
  if (!opts?.length) return s.size;
  return opts.some((o) => o.value === s.size) ? s.size : opts[0].value;
}

export function effectiveResolution(model: ModelDef, s: ModelSettings): string {
  const opts = model.controls.resolutions;
  if (!opts?.length) return s.resolution;
  return opts.includes(s.resolution) ? s.resolution : opts[0];
}

export const QUALITY_OPTIONS = QUALITIES;

/** A live price record from Fal's GET /v1/models/pricing endpoint. */
export interface LivePrice {
  unit_price: number;
  unit: string;
  currency: string;
}

// Reference (standard) base price per family — the cell that Fal's single live
// unit_price maps onto. Quality/size/resolution variation is applied on top as a
// multiplier, so live base price tracks Fal while we keep tier granularity.
const LOCAL_BASE: Record<ModelFamily, number> = {
  "nano-banana": 0.0398,
  "nano-banana-2": 0.08, // 1K standard rate
  "nano-banana-pro": 0.15, // 1K/2K standard rate
  "gpt-image-1": 0.042, // medium · 1024²
  "gpt-image-2": 0.053, // medium · 1024²
};

/** Price relative to the family's reference base (1.0 at the reference cell). */
function priceMultiplier(model: ModelDef, s: ModelSettings): number {
  switch (model.family) {
    case "nano-banana":
      return 1;
    case "nano-banana-2":
      return (NB2_PRICE[effectiveResolution(model, s)] ?? LOCAL_BASE["nano-banana-2"]) / LOCAL_BASE["nano-banana-2"];
    case "nano-banana-pro":
      return (NBP_PRICE[effectiveResolution(model, s)] ?? LOCAL_BASE["nano-banana-pro"]) / LOCAL_BASE["nano-banana-pro"];
    case "gpt-image-1":
      return (GPT1_PRICE[effectiveSize(model, s)]?.[s.quality] ?? LOCAL_BASE["gpt-image-1"]) / LOCAL_BASE["gpt-image-1"];
    case "gpt-image-2":
      return (GPT2_PRICE[effectiveSize(model, s)]?.[s.quality] ?? LOCAL_BASE["gpt-image-2"]) / LOCAL_BASE["gpt-image-2"];
  }
}

/**
 * USD per image. Uses the live Fal base price when provided (price tracks Fal),
 * otherwise falls back to the local reference base. Tier multiplier always applies.
 */
export function unitCost(model: ModelDef, s: ModelSettings, liveBase?: number): number {
  const base = liveBase != null && liveBase > 0 ? liveBase : LOCAL_BASE[model.family];
  return base * priceMultiplier(model, s);
}

export const estimateCost = (model: ModelDef, s: ModelSettings, liveBase?: number): number =>
  unitCost(model, s, liveBase) * Math.max(1, s.numImages);

/**
 * Per-image base from a live record, only when the model is billed per image.
 * Fal returns "images"/"image" for the Nano Banana family. GPT Image endpoints return
 * placeholder units ("credits", "units", "compute seconds") with no usable per-image
 * price — those return undefined so we fall back to the local quality×size matrix.
 */
export function liveBaseFromPrice(p?: LivePrice): number | undefined {
  if (!p) return undefined;
  return p.unit?.toLowerCase().startsWith("image") ? p.unit_price : undefined;
}

export function buildInput(
  model: ModelDef,
  prompt: string,
  imageUrls: string[],
  s: ModelSettings,
): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt, num_images: Math.max(1, s.numImages) };

  switch (model.family) {
    case "nano-banana":
      break;
    case "nano-banana-2":
    case "nano-banana-pro":
      input.resolution = effectiveResolution(model, s);
      break;
    case "gpt-image-1":
      input.image_size = effectiveSize(model, s);
      input.quality = s.quality;
      break;
    case "gpt-image-2": {
      const [w, h] = effectiveSize(model, s).split("x").map(Number);
      input.image_size = { width: w, height: h };
      input.quality = s.quality;
      break;
    }
  }

  if (model.mode === "edit") input.image_urls = imageUrls;
  return input;
}
