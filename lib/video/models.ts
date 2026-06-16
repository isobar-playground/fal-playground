// Video model catalog + price estimation. A *separate* code path from the image
// catalog (lib/models.ts) by design — own model defs, own field system, own
// request builder, own pricing. Mirrors the declarative-catalog idiom: each model
// declares the settings fields it actually supports (from Fal's input schema) and
// the UI renders only those. Prices are per-second estimates (June 2026); Fal is
// the source of truth for actual billing (live pricing is fetched before each run).
//
// Endpoint IDs / param names / option sets were verified against live fal.ai model
// pages during the build. Where a fact could not be confirmed it is marked
// `// TODO: verify` and given a conservative default — the app validates the schema
// live at runtime, so a wrong optional param surfaces as a per-card error, not a crash.

import type { LivePrice } from "../models";

/** How a video endpoint accepts input frames. Mirrors the image generate/edit split. */
export type VideoInputMode = "text" | "start" | "start-end";

export interface VideoFieldOption {
  value: string;
  label: string;
}

/** Which VideoSettings property a select field drives. */
export type VideoSettingsSelectKey = "durationSec" | "aspectRatio";

/** A declarative settings control. The UI renders one per entry, in order. */
export type VideoField = { kind: "select"; key: VideoSettingsSelectKey; label: string; options: VideoFieldOption[] };

/** How a model bills, sniffed from the live price `unit` (or set locally). */
export type VideoPriceUnit = "second" | "video";

export interface VideoModelDef {
  key: string;
  id: string; // Fal endpoint id
  label: string;
  group: string;
  inputMode: VideoInputMode;
  supportsAudio: boolean;
  blurb: string;
  tier: "flagship" | "quality" | "budget";
  fields: VideoField[];
  /** Per-model start/end frame parameter names (they differ across providers). */
  startParam?: string; // e.g. "image_url" / "start_image_url" / "first_frame_url"
  endParam?: string; // e.g. "end_image_url" / "last_frame_url"
  /** How this model bills locally (drives the duration-scaling branch + fallback). */
  priceUnit: VideoPriceUnit;
}

export interface VideoSettings {
  durationSec: number; // requested seconds of output
  aspectRatio: string; // "" = model default
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  durationSec: 5,
  aspectRatio: "",
};

// --- field option sets --------------------------------------------------

// Veo 3.1 uses string "Ns" durations (4s/6s/8s); we store the numeric seconds and
// re-format on the way out in buildVideoInput. Aspect: auto/16:9/9:16.
const VEO_DUR_OPTS: VideoFieldOption[] = [
  { value: "4", label: "4s" },
  { value: "6", label: "6s" },
  { value: "8", label: "8s" },
];
const VEO_ASPECT_OPTS: VideoFieldOption[] = [
  { value: "", label: "Auto" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

// Kling v3 Pro: integer-second durations 3..15 (default 5).
const KLING_DUR_OPTS: VideoFieldOption[] = [5, 10].map((n) => ({ value: String(n), label: `${n}s` }));
const KLING_ASPECT_OPTS: VideoFieldOption[] = [
  { value: "", label: "Default" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
];

// Seedance 2.0: "auto" or 4..15 seconds; rich aspect set.
const SEEDANCE_DUR_OPTS: VideoFieldOption[] = [4, 5, 6, 8, 10, 12].map((n) => ({ value: String(n), label: `${n}s` }));
const SEEDANCE_ASPECT_OPTS: VideoFieldOption[] = [
  { value: "", label: "Auto" },
  ...["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].map((r) => ({ value: r, label: r })),
];

// Wan v2.6: durations 5/10/15. (Aspect handled on text-to-video; i2v is resolution-only.)
const WAN_DUR_OPTS: VideoFieldOption[] = [5, 10, 15].map((n) => ({ value: String(n), label: `${n}s` }));
const WAN_ASPECT_OPTS: VideoFieldOption[] = [
  { value: "", label: "Default" },
  ...["16:9", "9:16", "1:1", "4:3", "3:4"].map((r) => ({ value: r, label: r })),
];

// Sora 2 / Sora 2 Pro: durations 4/8/12 (up to 20/25); aspect auto/16:9/9:16.
const SORA_DUR_OPTS: VideoFieldOption[] = [4, 8, 12].map((n) => ({ value: String(n), label: `${n}s` }));
const SORA_ASPECT_OPTS: VideoFieldOption[] = [
  { value: "", label: "Auto" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
];

// field shorthands
const duration = (options: VideoFieldOption[]): VideoField => ({ kind: "select", key: "durationSec", label: "Duration", options });
const aspect = (options: VideoFieldOption[]): VideoField => ({ kind: "select", key: "aspectRatio", label: "Aspect", options });

// --- catalog ------------------------------------------------------------

const GOOGLE = "Google · Veo";
const KLING = "Kuaishou · Kling";
const BYTEDANCE = "ByteDance · Seedance";
const ALIBABA = "Alibaba · Wan";
const OPENAI = "OpenAI · Sora";
const MINIMAX = "MiniMax · Hailuo";

export const VIDEO_MODELS: VideoModelDef[] = [
  // --- Veo 3.1 (flagship; text / I2V / first-last-frame; audio) -----------
  {
    key: "veo3.1-text",
    id: "fal-ai/veo3.1", // VERIFIED: base path is the text-to-video endpoint (/text-to-video 404s)
    label: "Veo 3.1 — text",
    group: GOOGLE,
    inputMode: "text",
    supportsAudio: true,
    blurb: "Google's flagship. Cinematic text-to-video with native audio, up to 8s.",
    tier: "flagship",
    fields: [duration(VEO_DUR_OPTS), aspect(VEO_ASPECT_OPTS)],
    priceUnit: "second",
  },
  {
    key: "veo3.1-start",
    id: "fal-ai/veo3.1/image-to-video", // VERIFIED
    label: "Veo 3.1 — image",
    group: GOOGLE,
    inputMode: "start",
    supportsAudio: true,
    blurb: "Animate a start frame with Veo 3.1. Native audio.",
    tier: "flagship",
    fields: [duration(VEO_DUR_OPTS), aspect(VEO_ASPECT_OPTS)],
    startParam: "image_url", // VERIFIED
    priceUnit: "second",
  },
  {
    key: "veo3.1-start-end",
    id: "fal-ai/veo3.1/first-last-frame-to-video", // VERIFIED
    label: "Veo 3.1 — first/last frame",
    group: GOOGLE,
    inputMode: "start-end",
    supportsAudio: true,
    blurb: "Interpolate from a first frame to an optional last frame.",
    tier: "flagship",
    fields: [duration(VEO_DUR_OPTS), aspect(VEO_ASPECT_OPTS)],
    startParam: "first_frame_url", // VERIFIED
    endParam: "last_frame_url", // VERIFIED
    priceUnit: "second",
  },

  // --- Kling 3.0 Pro (flagship; text / I2V with end frame; audio) ---------
  {
    key: "kling3-text",
    id: "fal-ai/kling-video/v3/pro/text-to-video", // VERIFIED
    label: "Kling 3.0 Pro — text",
    group: KLING,
    inputMode: "text",
    supportsAudio: true,
    blurb: "Kling 3.0 Pro text-to-video with native audio.",
    tier: "flagship",
    fields: [duration(KLING_DUR_OPTS), aspect(KLING_ASPECT_OPTS)],
    priceUnit: "second",
  },
  {
    key: "kling3-start-end",
    id: "fal-ai/kling-video/v3/pro/image-to-video", // VERIFIED
    label: "Kling 3.0 Pro — image",
    group: KLING,
    inputMode: "start-end",
    supportsAudio: true,
    // i2v endpoint takes start_image_url + optional end_image_url; no aspect param.
    blurb: "Animate a start frame, optionally toward an end frame. Native audio.",
    tier: "flagship",
    fields: [duration(KLING_DUR_OPTS)], // VERIFIED: i2v has no aspect_ratio param
    startParam: "start_image_url", // VERIFIED
    endParam: "end_image_url", // VERIFIED
    priceUnit: "second",
  },

  // --- Seedance 2.0 (quality / cheaper; text / I2V with end frame; audio) -
  {
    key: "seedance2-text",
    id: "bytedance/seedance-2.0/text-to-video", // VERIFIED
    label: "Seedance 2.0 — text",
    group: BYTEDANCE,
    inputMode: "text",
    supportsAudio: true,
    blurb: "ByteDance Seedance 2.0 — strong quality at a lower price. Audio included.",
    tier: "quality",
    fields: [duration(SEEDANCE_DUR_OPTS), aspect(SEEDANCE_ASPECT_OPTS)],
    priceUnit: "second",
  },
  {
    key: "seedance2-start-end",
    id: "bytedance/seedance-2.0/image-to-video", // VERIFIED
    label: "Seedance 2.0 — image",
    group: BYTEDANCE,
    inputMode: "start-end",
    supportsAudio: true,
    blurb: "Animate a start frame, with an optional end frame. Audio included.",
    tier: "quality",
    fields: [duration(SEEDANCE_DUR_OPTS), aspect(SEEDANCE_ASPECT_OPTS)],
    startParam: "image_url", // VERIFIED
    endParam: "end_image_url", // VERIFIED
    priceUnit: "second",
  },

  // --- Wan 2.6 (budget; text / I2V) ---------------------------------------
  {
    key: "wan2.6-text",
    id: "wan/v2.6/text-to-video", // VERIFIED (note: bare "wan/..." prefix, not "fal-ai/wan/...")
    label: "Wan 2.6 — text",
    group: ALIBABA,
    inputMode: "text",
    supportsAudio: false,
    blurb: "Alibaba Wan 2.6 — budget text-to-video, multi-shot, up to 1080p.",
    tier: "budget",
    fields: [duration(WAN_DUR_OPTS), aspect(WAN_ASPECT_OPTS)],
    priceUnit: "second",
  },
  {
    key: "wan2.6-start",
    id: "wan/v2.6/image-to-video", // VERIFIED
    label: "Wan 2.6 — image",
    group: ALIBABA,
    inputMode: "start",
    supportsAudio: false,
    // i2v is resolution-gated, not aspect-gated, and has no end-frame param.
    blurb: "Animate a start frame with Wan 2.6 (budget).",
    tier: "budget",
    fields: [duration(WAN_DUR_OPTS)], // VERIFIED: i2v uses `resolution`, not aspect_ratio
    startParam: "image_url", // VERIFIED
    priceUnit: "second",
  },

  // --- Sora 2 Pro (flagship; text / I2V, no end frame; audio) -------------
  {
    key: "sora2-pro-text",
    id: "fal-ai/sora-2/text-to-video/pro", // VERIFIED: "/pro" is a suffix on the mode path
    label: "Sora 2 Pro — text",
    group: OPENAI,
    inputMode: "text",
    supportsAudio: true,
    blurb: "OpenAI Sora 2 Pro — high-fidelity text-to-video with synced audio.",
    tier: "flagship",
    fields: [duration(SORA_DUR_OPTS), aspect(SORA_ASPECT_OPTS)],
    priceUnit: "second",
  },
  {
    key: "sora2-pro-start",
    id: "fal-ai/sora-2/image-to-video/pro", // VERIFIED
    label: "Sora 2 Pro — image",
    group: OPENAI,
    inputMode: "start",
    supportsAudio: true,
    blurb: "Animate a start frame with Sora 2 Pro. Synced audio, no end frame.",
    tier: "flagship",
    fields: [duration(SORA_DUR_OPTS), aspect(SORA_ASPECT_OPTS)],
    startParam: "image_url", // VERIFIED ("URL of the image to use as the first frame")
    priceUnit: "second",
  },

  // --- MiniMax Hailuo 2.3 Pro (budget 6th; text / I2V) --------------------
  {
    key: "hailuo2.3-text",
    id: "fal-ai/minimax/hailuo-2.3/pro/text-to-video", // VERIFIED
    label: "Hailuo 2.3 Pro — text",
    group: MINIMAX,
    inputMode: "text",
    supportsAudio: false,
    // The published schema exposes mostly prompt/prompt_optimizer; duration & aspect
    // are not clearly documented, so we expose no schema-gated controls and let the
    // model use its defaults (decision #9: settings are schema-gated per model).
    blurb: "MiniMax Hailuo 2.3 Pro — budget text-to-video, 1080p.",
    tier: "budget",
    fields: [], // TODO: verify duration/aspect params if Fal exposes them
    priceUnit: "second",
  },
  {
    key: "hailuo2.3-start",
    id: "fal-ai/minimax/hailuo-2.3/pro/image-to-video", // VERIFIED
    label: "Hailuo 2.3 Pro — image",
    group: MINIMAX,
    inputMode: "start",
    supportsAudio: false,
    blurb: "Animate a start frame with Hailuo 2.3 Pro (budget), 1080p.",
    tier: "budget",
    fields: [], // TODO: verify duration/aspect params if Fal exposes them
    startParam: "image_url", // VERIFIED ("URL of the image to use as the first frame")
    priceUnit: "second",
  },
];

export const VIDEO_MODEL_BY_KEY: Record<string, VideoModelDef> = Object.fromEntries(
  VIDEO_MODELS.map((m) => [m.key, m]),
);
export const VIDEO_MODEL_GROUPS: string[] = [...new Set(VIDEO_MODELS.map((m) => m.group))];

// --- field helpers ------------------------------------------------------

function videoSelectOptions(model: VideoModelDef, key: VideoSettingsSelectKey): VideoFieldOption[] {
  const f = model.fields.find((f) => f.kind === "select" && f.key === key);
  return f && f.kind === "select" ? f.options : [];
}

export const hasVideoField = (model: VideoModelDef, key: VideoSettingsSelectKey): boolean =>
  model.fields.some((f) => f.kind === "select" && f.key === key);

/** The duration we'd actually send: the requested value if offered, else the first option. */
export function effectiveDuration(model: VideoModelDef, s: VideoSettings): number {
  const opts = videoSelectOptions(model, "durationSec");
  if (!opts.length) return s.durationSec;
  return opts.some((o) => Number(o.value) === s.durationSec) ? s.durationSec : Number(opts[0].value);
}

/** The aspect we'd actually send: the requested value if offered, else "" (model default). */
export function effectiveAspectRatio(model: VideoModelDef, s: VideoSettings): string {
  const opts = videoSelectOptions(model, "aspectRatio");
  if (!opts.length) return "";
  return opts.some((o) => o.value === s.aspectRatio) ? s.aspectRatio : opts[0].value;
}

// --- pricing ------------------------------------------------------------

// Local per-model base price (USD), the cell Fal's single live unit_price maps onto.
// Verified per-second rates as of June 2026 (conservative where a tier wasn't pinned);
// budget models without a confirmed published rate use a deliberately low estimate.
const LOCAL_VIDEO_BASE: Record<string, { unit: VideoPriceUnit; price: number }> = {
  "veo3.1-text": { unit: "second", price: 0.4 }, // Veo 3.1 standard ≈ $0.40/s
  "veo3.1-start": { unit: "second", price: 0.4 },
  "veo3.1-start-end": { unit: "second", price: 0.4 },
  "kling3-text": { unit: "second", price: 0.112 }, // Kling v3 Pro ≈ $0.112/s (audio off)
  "kling3-start-end": { unit: "second", price: 0.112 },
  "seedance2-text": { unit: "second", price: 0.092 }, // Seedance 2.0 ≈ $0.092/s (720p-ish)
  "seedance2-start-end": { unit: "second", price: 0.092 },
  "wan2.6-text": { unit: "second", price: 0.05 }, // budget estimate
  "wan2.6-start": { unit: "second", price: 0.05 },
  "sora2-pro-text": { unit: "second", price: 0.5 }, // Sora 2 Pro $0.50/s (1080p)
  "sora2-pro-start": { unit: "second", price: 0.5 },
  "hailuo2.3-text": { unit: "second", price: 0.045 }, // budget estimate
  "hailuo2.3-start": { unit: "second", price: 0.045 },
};

const LOCAL_VIDEO_FALLBACK = 0.1; // USD/second for any model missing from the table

/**
 * Per-unit base from a live record, only when the unit is one Fal bills video on.
 * Fal returns units like "second" / "seconds" / "compute seconds" / "video" for video
 * endpoints. Placeholder units ("credits", "units") return undefined so we fall back
 * to the local per-model table. Returns the base plus the unit class we detected.
 */
export function liveVideoBaseFromPrice(p?: LivePrice): { base: number; unit: VideoPriceUnit } | undefined {
  if (!p || !(p.unit_price > 0)) return undefined;
  const u = p.unit?.toLowerCase() ?? "";
  if (u.includes("second")) return { base: p.unit_price, unit: "second" }; // "second" / "seconds" / "compute seconds"
  if (u.includes("video") || u.includes("clip") || u.includes("generation")) return { base: p.unit_price, unit: "video" };
  return undefined; // placeholder unit — caller falls back to LOCAL_VIDEO_BASE
}

/**
 * USD estimate for one video. Uses the live Fal base + unit when usable, otherwise the
 * local per-model base. Per-second units scale by the (effective) duration; flat-per-video
 * units bill once regardless of duration (decision #8 / §5).
 */
export function estimateVideoCost(
  model: VideoModelDef,
  s: VideoSettings,
  live?: { base: number; unit: VideoPriceUnit },
): number {
  const local = LOCAL_VIDEO_BASE[model.key] ?? { unit: model.priceUnit, price: LOCAL_VIDEO_FALLBACK };
  const base = live && live.base > 0 ? live.base : local.price;
  const unit = live ? live.unit : local.unit;
  if (unit === "video") return base; // flat per clip
  return base * Math.max(1, effectiveDuration(model, s)); // per second of output
}

// --- request building ---------------------------------------------------

export function buildVideoInput(
  model: VideoModelDef,
  prompt: string,
  frames: { startUrl?: string; endUrl?: string },
  s: VideoSettings,
): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt };

  // Frames — onto the model's actual param names. Start is required for start/start-end
  // (validated in the UI); end is always optional and only sent when supplied.
  if (model.inputMode !== "text" && model.startParam && frames.startUrl) {
    input[model.startParam] = frames.startUrl;
  }
  if (model.inputMode === "start-end" && model.endParam && frames.endUrl) {
    input[model.endParam] = frames.endUrl;
  }

  // Duration — schema-gated. Veo expects a string "Ns"; everyone else takes an integer.
  if (hasVideoField(model, "durationSec")) {
    const secs = effectiveDuration(model, s);
    input.duration = model.id.startsWith("fal-ai/veo3.1") ? `${secs}s` : secs;
  }

  // Aspect ratio — schema-gated; "" means use the model default (omit it).
  if (hasVideoField(model, "aspectRatio")) {
    const ar = effectiveAspectRatio(model, s);
    if (ar) input.aspect_ratio = ar;
  }

  return input;
}
