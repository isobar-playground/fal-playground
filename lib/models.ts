// Model catalog + price estimation. Each model declares the settings fields it
// actually supports (from Fal's input schema); the UI renders only those.
// Prices are hardcoded estimates (June 2026), USD per output image — Fal is the
// source of truth for actual billing.

export type ModelMode = "generate" | "edit";
export type GptQuality = "low" | "medium" | "high";
export type ModelFamily =
  | "nano-banana"
  | "nano-banana-2"
  | "nano-banana-pro"
  | "gpt-image-1"
  | "gpt-image-2"
  | "flux-schnell"
  | "flux-dev"
  | "flux-1.1-pro"
  | "flux-1.1-pro-ultra"
  | "flux-kontext-pro"
  | "flux-kontext-max"
  | "flux-2-dev"
  | "flux-2-flex"
  | "flux-2-pro"
  | "flux-2-max";

export interface FieldOption {
  value: string;
  label: string;
}

/** Which ModelSettings property a select field drives. */
export type SettingsSelectKey =
  | "resolution"
  | "quality"
  | "size"
  | "aspectRatio"
  | "safetyTolerance"
  | "outputFormat";

/** Which ModelSettings property a free numeric field drives (FLUX knobs). */
export type SettingsNumberKey = "steps" | "guidance";

/** A declarative settings control. The UI renders one per entry, in order. */
export type Field =
  | { kind: "images" }
  | { kind: "seed" }
  | { kind: "select"; key: SettingsSelectKey; label: string; options: FieldOption[] }
  | { kind: "number"; key: SettingsNumberKey; label: string; placeholder: string; min?: number; max?: number; step?: number };

export interface ModelDef {
  key: string;
  id: string; // Fal endpoint id
  label: string;
  group: string;
  family: ModelFamily;
  mode: ModelMode;
  needsReferences: boolean;
  blurb: string;
  fields: Field[];
}

export interface ModelSettings {
  numImages: number;
  quality: GptQuality; // gpt-image
  size: string; // gpt-image dimensions key / FLUX image_size enum
  resolution: string; // nano-banana-2 / pro
  aspectRatio: string; // nano-banana / FLUX ("" = default)
  seed: string; // "" = random
  safetyTolerance: string; // "" = default
  outputFormat: string; // "" = default
  steps: string; // FLUX num_inference_steps ("" = model default)
  guidance: string; // FLUX guidance_scale ("" = model default)
}

export const DEFAULT_SETTINGS: ModelSettings = {
  numImages: 1,
  quality: "medium",
  size: "",
  resolution: "",
  aspectRatio: "",
  seed: "",
  safetyTolerance: "",
  outputFormat: "",
  steps: "",
  guidance: "",
};

// --- field option sets --------------------------------------------------

const NB2_RES_OPTS: FieldOption[] = [
  { value: "0.5K", label: "0.5K" },
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];
const NBP_RES_OPTS: FieldOption[] = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const GPT1_SIZE_OPTS: FieldOption[] = [
  { value: "1024x1024", label: "Square 1024²" },
  { value: "1536x1024", label: "Landscape 1536×1024" },
  { value: "1024x1536", label: "Portrait 1024×1536" },
];
const GPT2_SIZE_OPTS: FieldOption[] = [
  { value: "1024x1024", label: "Square 1024²" },
  { value: "1024x768", label: "Landscape 1024×768" },
  { value: "1024x1536", label: "Portrait 1024×1536" },
  { value: "3840x2160", label: "4K 3840×2160" },
];

const QUALITY_OPTS: FieldOption[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const ASPECT_OPTS: FieldOption[] = [
  { value: "", label: "Default" },
  ...["21:9", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16"].map((r) => ({ value: r, label: r })),
];

const TOLERANCE_OPTS: FieldOption[] = [
  { value: "", label: "Default" },
  ...["1", "2", "3", "4", "5", "6"].map((n) => ({ value: n, label: n })),
];

const FORMAT_OPTS: FieldOption[] = [
  { value: "", label: "Default" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
  { value: "webp", label: "WebP" },
];

// FLUX image_size is an enum (not "WxH"); landscape_4_3 is Fal's default, so it's first.
const FLUX_SIZE_OPTS: FieldOption[] = [
  { value: "landscape_4_3", label: "Landscape 4:3" },
  { value: "landscape_16_9", label: "Landscape 16:9" },
  { value: "square_hd", label: "Square HD" },
  { value: "square", label: "Square" },
  { value: "portrait_4_3", label: "Portrait 4:3" },
  { value: "portrait_16_9", label: "Portrait 16:9" },
];
// FLUX pro-ultra / Kontext drive aspect_ratio instead of image_size.
const FLUX_ASPECT_OPTS: FieldOption[] = [
  { value: "", label: "Default" },
  ...["21:9", "16:9", "4:3", "3:2", "1:1", "2:3", "3:4", "9:16", "9:21"].map((r) => ({ value: r, label: r })),
];
// FLUX only emits jpeg/png (no webp).
const FLUX_FORMAT_OPTS: FieldOption[] = [
  { value: "", label: "Default" },
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
];
// FLUX.2 safety_tolerance tops out at 5 (FLUX.1 went to 6).
const TOLERANCE5_OPTS: FieldOption[] = [
  { value: "", label: "Default" },
  ...["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n })),
];
// FLUX.2 edit can match the input size ("auto", its default) or force an enum size.
const FLUX2_EDIT_SIZE_OPTS: FieldOption[] = [{ value: "auto", label: "Auto (match input)" }, ...FLUX_SIZE_OPTS];

// field shorthands
const images: Field = { kind: "images" };
const seed: Field = { kind: "seed" };
const aspect: Field = { kind: "select", key: "aspectRatio", label: "Aspect", options: ASPECT_OPTS };
const tolerance: Field = { kind: "select", key: "safetyTolerance", label: "Safety", options: TOLERANCE_OPTS };
const format: Field = { kind: "select", key: "outputFormat", label: "Format", options: FORMAT_OPTS };
const quality: Field = { kind: "select", key: "quality", label: "Quality", options: QUALITY_OPTS };
const resolution = (options: FieldOption[]): Field => ({ kind: "select", key: "resolution", label: "Resolution", options });
const size = (options: FieldOption[]): Field => ({ kind: "select", key: "size", label: "Size", options });

// FLUX field shorthands.
const fluxSize: Field = { kind: "select", key: "size", label: "Size", options: FLUX_SIZE_OPTS };
const fluxAspect: Field = { kind: "select", key: "aspectRatio", label: "Aspect", options: FLUX_ASPECT_OPTS };
const fluxFormat: Field = { kind: "select", key: "outputFormat", label: "Format", options: FLUX_FORMAT_OPTS };
const tolerance5: Field = { kind: "select", key: "safetyTolerance", label: "Safety", options: TOLERANCE5_OPTS };
const flux2EditSize: Field = { kind: "select", key: "size", label: "Size", options: FLUX2_EDIT_SIZE_OPTS };
const steps = (placeholder: string): Field => ({ kind: "number", key: "steps", label: "Steps", placeholder, min: 1, max: 50 });
const guidance = (placeholder: string): Field => ({ kind: "number", key: "guidance", label: "Guidance", placeholder, min: 0, max: 20, step: 0.5 });

const NANO_BASE: Field[] = [images, aspect, seed, tolerance, format];
const nano2 = (res: FieldOption[]): Field[] => [images, resolution(res), aspect, seed, tolerance, format];

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
const NB2_PRICE: Record<string, number> = { "0.5K": 0.06, "1K": 0.08, "2K": 0.12, "4K": 0.16 };
const NBP_PRICE: Record<string, number> = { "1K": 0.15, "2K": 0.15, "4K": 0.3 };

// --- catalog ------------------------------------------------------------

const GOOGLE = "Google · Nano Banana";
const OPENAI = "OpenAI · GPT Image";
const FLUX = "Black Forest Labs · FLUX";

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
    fields: NANO_BASE,
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
    fields: NANO_BASE,
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
    fields: nano2(NB2_RES_OPTS),
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
    fields: nano2(NB2_RES_OPTS),
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
    fields: nano2(NBP_RES_OPTS),
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
    fields: nano2(NBP_RES_OPTS),
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
    fields: [images, quality, size(GPT1_SIZE_OPTS), format],
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
    fields: [images, quality, size(GPT1_SIZE_OPTS), format],
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
    fields: [images, quality, size(GPT2_SIZE_OPTS), format],
  },
  {
    key: "gpt-image-2-edit",
    id: "fal-ai/gpt-image-2/edit",
    label: "GPT Image 2 — edit",
    group: OPENAI,
    family: "gpt-image-2",
    mode: "edit",
    needsReferences: true,
    blurb: "GPT Image 2 with reference images.",
    fields: [images, quality, size(GPT2_SIZE_OPTS), format],
  },
  // --- FLUX.2 (current generation) ---
  {
    key: "flux-2-pro",
    id: "fal-ai/flux-2-pro",
    label: "FLUX.2 [pro]",
    group: FLUX,
    family: "flux-2-pro",
    mode: "generate",
    needsReferences: false,
    blurb: "Predictable, professional quality (fixed steps).",
    fields: [images, fluxSize, seed, tolerance5, fluxFormat],
  },
  {
    key: "flux-2-pro-edit",
    id: "fal-ai/flux-2-pro/edit",
    label: "FLUX.2 [pro] — edit",
    group: FLUX,
    family: "flux-2-pro",
    mode: "edit",
    needsReferences: true,
    blurb: "Multi-reference editing, pro quality.",
    fields: [images, flux2EditSize, seed, tolerance5, fluxFormat],
  },
  {
    key: "flux-2-flex",
    id: "fal-ai/flux-2-flex",
    label: "FLUX.2 [flex]",
    group: FLUX,
    family: "flux-2-flex",
    mode: "generate",
    needsReferences: false,
    blurb: "Full control — tune steps & guidance.",
    fields: [images, fluxSize, steps("28"), guidance("3.5"), seed, tolerance5, fluxFormat],
  },
  {
    key: "flux-2-flex-edit",
    id: "fal-ai/flux-2-flex/edit",
    label: "FLUX.2 [flex] — edit",
    group: FLUX,
    family: "flux-2-flex",
    mode: "edit",
    needsReferences: true,
    blurb: "Multi-reference editing with full control.",
    fields: [images, flux2EditSize, steps("28"), guidance("3.5"), seed, tolerance5, fluxFormat],
  },
  {
    key: "flux-2-dev",
    id: "fal-ai/flux-2-dev",
    label: "FLUX.2 [dev]",
    group: FLUX,
    family: "flux-2-dev",
    mode: "generate",
    needsReferences: false,
    blurb: "Open-weights — cheapest FLUX.2.",
    fields: [images, fluxSize, steps("28"), guidance("2.5"), seed, format],
  },
  {
    key: "flux-2-max",
    id: "fal-ai/flux-2-max",
    label: "FLUX.2 [max]",
    group: FLUX,
    family: "flux-2-max",
    mode: "generate",
    needsReferences: false,
    blurb: "Highest-quality FLUX.2 (fixed steps).",
    fields: [images, fluxSize, seed, tolerance5, fluxFormat],
  },
  // --- FLUX.1 (previous generation) ---
  {
    key: "flux-schnell",
    id: "fal-ai/flux/schnell",
    label: "FLUX.1 [schnell]",
    group: FLUX,
    family: "flux-schnell",
    mode: "generate",
    needsReferences: false,
    blurb: "Fastest FLUX — 1–4 steps, very cheap.",
    fields: [images, fluxSize, steps("4"), guidance("3.5"), seed, fluxFormat],
  },
  {
    key: "flux-dev",
    id: "fal-ai/flux/dev",
    label: "FLUX.1 [dev]",
    group: FLUX,
    family: "flux-dev",
    mode: "generate",
    needsReferences: false,
    blurb: "12B model — strong quality-to-price.",
    fields: [images, fluxSize, steps("28"), guidance("3.5"), seed, fluxFormat],
  },
  {
    key: "flux-1.1-pro",
    id: "fal-ai/flux-pro/v1.1",
    label: "FLUX1.1 [pro]",
    group: FLUX,
    family: "flux-1.1-pro",
    mode: "generate",
    needsReferences: false,
    blurb: "Pro-grade quality and speed.",
    fields: [images, fluxSize, seed, tolerance, fluxFormat],
  },
  {
    key: "flux-1.1-pro-ultra",
    id: "fal-ai/flux-pro/v1.1-ultra",
    label: "FLUX1.1 [pro] ultra",
    group: FLUX,
    family: "flux-1.1-pro-ultra",
    mode: "generate",
    needsReferences: false,
    blurb: "Up to 4MP, photorealistic.",
    fields: [images, fluxAspect, seed, tolerance, fluxFormat],
  },
  {
    key: "flux-kontext-pro",
    id: "fal-ai/flux-pro/kontext",
    label: "FLUX.1 Kontext [pro]",
    group: FLUX,
    family: "flux-kontext-pro",
    mode: "edit",
    needsReferences: true,
    blurb: "Edit a reference image from a prompt.",
    fields: [images, fluxAspect, guidance("3.5"), seed, tolerance, fluxFormat],
  },
  {
    key: "flux-kontext-max",
    id: "fal-ai/flux-pro/kontext/max",
    label: "FLUX.1 Kontext [max]",
    group: FLUX,
    family: "flux-kontext-max",
    mode: "edit",
    needsReferences: true,
    blurb: "Top-tier prompt-based image editing.",
    fields: [images, fluxAspect, guidance("3.5"), seed, tolerance, fluxFormat],
  },
];

export const MODEL_BY_KEY: Record<string, ModelDef> = Object.fromEntries(MODELS.map((m) => [m.key, m]));
export const MODEL_GROUPS: string[] = [...new Set(MODELS.map((m) => m.group))];

// --- field helpers ------------------------------------------------------

function selectOptions(model: ModelDef, key: SettingsSelectKey): FieldOption[] {
  const f = model.fields.find((f) => f.kind === "select" && f.key === key);
  return f && f.kind === "select" ? f.options : [];
}

export const hasField = (model: ModelDef, key: SettingsSelectKey | "seed"): boolean =>
  model.fields.some((f) => (f.kind === "seed" && key === "seed") || (f.kind === "select" && f.key === key));

export const hasNumberField = (model: ModelDef, key: SettingsNumberKey): boolean =>
  model.fields.some((f) => f.kind === "number" && f.key === key);

/** FLUX Kontext edits a single image_url, unlike the image_urls array everyone else uses. */
export const isFluxKontext = (model: ModelDef): boolean =>
  model.family === "flux-kontext-pro" || model.family === "flux-kontext-max";

export function effectiveSize(model: ModelDef, s: ModelSettings): string {
  const opts = selectOptions(model, "size");
  if (!opts.length) return s.size;
  return opts.some((o) => o.value === s.size) ? s.size : opts[0].value;
}

export function effectiveResolution(model: ModelDef, s: ModelSettings): string {
  const opts = selectOptions(model, "resolution");
  if (!opts.length) return s.resolution;
  return opts.some((o) => o.value === s.resolution) ? s.resolution : opts[0].value;
}

// --- pricing ------------------------------------------------------------

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
  // FLUX enum sizes are all ~1MP, so per-image ≈ the per-MP/flat rate (no tier multiplier).
  "flux-schnell": 0.003,
  "flux-dev": 0.025,
  "flux-1.1-pro": 0.04,
  "flux-1.1-pro-ultra": 0.06,
  "flux-kontext-pro": 0.04,
  "flux-kontext-max": 0.08,
  // FLUX.2 is billed per-MP; enum sizes are ~1MP so per-image ≈ the per-MP rate.
  "flux-2-dev": 0.012,
  "flux-2-flex": 0.05,
  "flux-2-pro": 0.03,
  "flux-2-max": 0.07,
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
    // FLUX: flat per-image base, no resolution/quality tiering.
    case "flux-schnell":
    case "flux-dev":
    case "flux-1.1-pro":
    case "flux-1.1-pro-ultra":
    case "flux-kontext-pro":
    case "flux-kontext-max":
    case "flux-2-dev":
    case "flux-2-flex":
    case "flux-2-pro":
    case "flux-2-max":
      return 1;
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

// --- request building ---------------------------------------------------

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
    case "flux-schnell":
    case "flux-dev":
    case "flux-1.1-pro":
    case "flux-2-dev":
    case "flux-2-flex":
    case "flux-2-pro":
    case "flux-2-max":
      input.image_size = effectiveSize(model, s); // FLUX enum string, not "WxH"
      break;
    case "flux-1.1-pro-ultra":
    case "flux-kontext-pro":
    case "flux-kontext-max":
      break; // sized via aspect_ratio (optional field, handled below)
  }

  // Optional, schema-gated extras.
  if (hasField(model, "seed")) {
    const n = Number.parseInt(s.seed, 10);
    if (s.seed.trim() !== "" && Number.isFinite(n)) input.seed = n;
  }
  if (hasField(model, "aspectRatio") && s.aspectRatio) input.aspect_ratio = s.aspectRatio;
  if (hasField(model, "safetyTolerance") && s.safetyTolerance) input.safety_tolerance = s.safetyTolerance;
  if (hasField(model, "outputFormat") && s.outputFormat) input.output_format = s.outputFormat;
  if (hasNumberField(model, "steps")) {
    const n = Number.parseInt(s.steps, 10);
    if (s.steps.trim() !== "" && Number.isFinite(n)) input.num_inference_steps = n;
  }
  if (hasNumberField(model, "guidance")) {
    const n = Number.parseFloat(s.guidance);
    if (s.guidance.trim() !== "" && Number.isFinite(n)) input.guidance_scale = n;
  }

  if (model.mode === "edit") {
    if (isFluxKontext(model)) input.image_url = imageUrls[0];
    else input.image_urls = imageUrls;
  }
  return input;
}
