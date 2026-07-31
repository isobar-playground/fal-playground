// Video model catalog + price estimation. A *separate* code path from the image
// catalog (lib/models.ts) by design — own model defs, own field system, own
// request builder, own pricing. Mirrors the declarative-catalog idiom: each model
// declares the settings fields it actually supports (from Fal's input schema) and
// the UI renders only those. Prices are per-second estimates (July 2026); Fal is
// the source of truth for actual billing (live pricing is fetched before each run).
//
// Endpoint IDs / param names / option sets were checked against fal.ai during this
// build. Direct WebFetch of fal.ai model pages was blocked by its bot-protection
// checkpoint for the whole session, so verification for every *new* entry below
// came from fal's own GitHub example repos (e.g. fal-ai/seedance-2.0-api) and
// search-indexed snippets of the fal.ai docs/model pages — marked `// VERIFIED
// (search)` to flag that provenance, vs. the original `// VERIFIED` (direct fetch)
// on entries built earlier. Where a fact still couldn't be pinned down it's marked
// `// TODO: verify` with a conservative default — the app validates the schema live
// at runtime, so a wrong optional param surfaces as a per-card error, not a crash.

import type { LivePrice } from "../models";

/**
 * How a video endpoint accepts input media. Mirrors the image generate/edit split,
 * plus "video" for the video-to-video family (edit / upscale / motion-control /
 * lipsync): a source video, optionally paired with a reference image (`startParam`)
 * and/or a source audio track (`audioParam`, independent of inputMode).
 */
export type VideoInputMode = "text" | "start" | "start-end" | "video";

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
  /** Per-model start/end frame parameter names (they differ across providers). Also
   *  doubles as the *reference image* param for video-to-video models that pair a
   *  still with a source video (e.g. Kling motion-control's "image_url"). */
  startParam?: string; // e.g. "image_url" / "start_image_url" / "image_urls"
  /** True when `startParam` expects an array of URLs, not a single string (e.g.
   *  Seedance reference-to-video's "image_urls"). The UI still offers one upload
   *  slot; buildVideoInput wraps its URL in a 1-element array. */
  startParamIsArray?: boolean;
  endParam?: string; // e.g. "end_image_url" / "last_frame_url"
  /** Source-video parameter name, for inputMode "video" (e.g. "video_url"). */
  videoParam?: string;
  /** Source-audio parameter name, for models that need audio alongside video (e.g.
   *  sync-lipsync's "audio_url"). Independent of inputMode. */
  audioParam?: string;
  /** True for endpoints with no prompt param at all (upscalers, lipsync) — the UI
   *  doesn't require prompt text and buildVideoInput omits the key entirely. */
  noPrompt?: boolean;
  /** Required params with no default that we don't expose a control for — merged into
   *  every request as-is. Today only Kling motion-control's `character_orientation`. */
  extraInput?: Record<string, unknown>;
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
// re-format on the way out in buildVideoInput. Aspect: auto/16:9/9:16. Shared by
// both the standard and "fast" tiers (verified identical for fast/text-to-video;
// fast/image-to-video follows the same Veo 3.1 family schema).
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

// Kling v3 Pro: integer-second durations 3..15 (default 5). Shared with the
// Standard tier (VERIFIED (search): same duration param, no independent standard-
// tier range published — treated as identical to Pro).
const KLING_DUR_OPTS: VideoFieldOption[] = [5, 10].map((n) => ({ value: String(n), label: `${n}s` }));
const KLING_ASPECT_OPTS: VideoFieldOption[] = [
  { value: "", label: "Default" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
];

// Seedance 2.0: "auto" or 4..15 seconds; rich aspect set. Shared across text/image/
// reference modes and both standard + fast tiers (VERIFIED (search) via
// fal-ai/seedance-2.0-api's README — identical duration/aspect_ratio enum on every
// endpoint in the family; only resolution range and price differ, and we don't
// expose a resolution control).
const SEEDANCE_DUR_OPTS: VideoFieldOption[] = [4, 5, 6, 8, 10, 12].map((n) => ({ value: String(n), label: `${n}s` }));
const SEEDANCE_ASPECT_OPTS: VideoFieldOption[] = [
  { value: "", label: "Auto" },
  ...["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].map((r) => ({ value: r, label: r })),
];

// xAI Grok Imagine Video: aspect_ratio is a 7-way enum, default 16:9 (VERIFIED
// (search), consistent across text-to-video and v1.5/image-to-video). Duration is
// an integer whose exact range differs slightly per mode (t2v: 6-15s default 6;
// i2v: 1-15s default 10) — we expose one curated subset (6-15) that's valid on
// both rather than tracking two option sets for a cosmetic difference.
const GROK_ASPECT_OPTS: VideoFieldOption[] = [
  { value: "", label: "Default (16:9)" },
  ...["16:9", "9:16", "1:1", "4:3", "3:4", "3:2", "2:3"].map((r) => ({ value: r, label: r })),
];
const GROK_DUR_OPTS: VideoFieldOption[] = [6, 8, 10, 12, 15].map((n) => ({ value: String(n), label: `${n}s` }));

// field shorthands
const duration = (options: VideoFieldOption[]): VideoField => ({ kind: "select", key: "durationSec", label: "Duration", options });
const aspect = (options: VideoFieldOption[]): VideoField => ({ kind: "select", key: "aspectRatio", label: "Aspect", options });

// --- catalog ------------------------------------------------------------

const GOOGLE = "Google · Veo";
const KLING = "Kuaishou · Kling";
const BYTEDANCE = "ByteDance · Seedance";
const XAI = "xAI · Grok";
const TOPAZ = "Topaz · Upscale";
const SYNC = "sync.so · Lipsync";

export const VIDEO_MODELS: VideoModelDef[] = [
  // --- Veo 3.1 (flagship text; "fast" tier text + image, cheaper) ---------
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
    // Not on the client's curated list — kept deliberately as the standard-tier
    // counterpart to veo3.1-fast-start (see VIDEO_MODELS' extras note in models.check.ts).
    key: "veo3.1-start",
    id: "fal-ai/veo3.1/image-to-video", // VERIFIED (schema)
    label: "Veo 3.1 — image",
    group: GOOGLE,
    inputMode: "start",
    supportsAudio: true,
    blurb: "Animate a start frame with Veo 3.1. Native audio.",
    tier: "flagship",
    fields: [duration(VEO_DUR_OPTS), aspect(VEO_ASPECT_OPTS)],
    startParam: "image_url", // VERIFIED (schema)
    priceUnit: "second",
  },
  {
    key: "veo3.1-fast-text",
    id: "fal-ai/veo3.1/fast", // VERIFIED (search): fal.ai/models/fal-ai/veo3.1/fast
    label: "Veo 3.1 Fast — text",
    group: GOOGLE,
    inputMode: "text",
    supportsAudio: true,
    blurb: "Faster, cheaper Veo 3.1 — same native-audio text-to-video, lower cost.",
    tier: "quality",
    fields: [duration(VEO_DUR_OPTS), aspect(VEO_ASPECT_OPTS)],
    priceUnit: "second",
  },
  {
    key: "veo3.1-fast-start",
    id: "fal-ai/veo3.1/fast/image-to-video", // VERIFIED (search)
    label: "Veo 3.1 Fast — image",
    group: GOOGLE,
    inputMode: "start",
    supportsAudio: true,
    blurb: "Animate a start frame with Veo 3.1 Fast. Native audio, lower cost.",
    tier: "quality",
    fields: [duration(VEO_DUR_OPTS), aspect(VEO_ASPECT_OPTS)],
    startParam: "image_url", // VERIFIED (search)
    priceUnit: "second",
  },

  // --- Kling (3.0 Pro text/I2V; 3.0 Standard I2V; O3 Pro edit + motion-control) -
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
  {
    key: "kling3-standard-start-end",
    id: "fal-ai/kling-video/v3/standard/image-to-video", // VERIFIED (search)
    label: "Kling 3.0 Standard — image",
    group: KLING,
    inputMode: "start-end",
    supportsAudio: true,
    blurb: "Cheaper Kling 3.0 tier: animate a start frame, optionally to an end frame.",
    tier: "quality",
    fields: [duration(KLING_DUR_OPTS)], // VERIFIED (search): start/end frames + duration; no aspect_ratio, mirrors Pro
    startParam: "start_image_url", // VERIFIED (search)
    endParam: "end_image_url", // VERIFIED (search)
    priceUnit: "second",
  },
  {
    key: "kling-o3-edit",
    id: "fal-ai/kling-video/o3/pro/video-to-video/edit", // VERIFIED (search): a real, distinct Kling "O-series" edit
    // family (sibling to the existing v3 line) — not a typo of v3.
    label: "Kling O3 Pro — edit video",
    group: KLING,
    inputMode: "video",
    supportsAudio: false,
    blurb: "Edit an existing video with a text instruction (subject/setting/style swap), keeping the motion.",
    tier: "flagship",
    fields: [], // VERIFIED (search): output duration follows the input video; no duration control
    videoParam: "video_url", // VERIFIED (search): confirmed on the sibling o1/video-to-video/edit endpoint;
    // o3's own /api page was blocked by fal.ai's bot checkpoint, so this is verified by family analogy, not direct fetch.
    priceUnit: "second",
  },
  {
    key: "kling3-motion-control",
    id: "fal-ai/kling-video/v3/pro/motion-control", // VERIFIED (search)
    label: "Kling 3.0 Pro — motion control",
    group: KLING,
    inputMode: "video",
    supportsAudio: false,
    blurb: "Puppet a character image with the motion from a reference video.",
    tier: "flagship",
    fields: [], // VERIFIED (schema): no duration/aspect params — output follows the reference video
    startParam: "image_url", // VERIFIED (schema): character reference image (required)
    videoParam: "video_url", // VERIFIED (schema): reference motion video (required)
    // VERIFIED (schema): `character_orientation` is required and has NO default — without it
    // every request 422s. "image" follows the reference image's orientation (max 10s output);
    // "video" follows the reference video (max 30s, better for complex motion).
    // ponytail: fixed to "image"; promote to a settings control if operators need to switch it.
    extraInput: { character_orientation: "image" },
    priceUnit: "second",
  },

  // --- Seedance 2.0 (text/I2V/reference; standard + fast tiers) -----------
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
  {
    key: "seedance2-reference",
    id: "bytedance/seedance-2.0/reference-to-video", // VERIFIED (search)
    label: "Seedance 2.0 — reference",
    group: BYTEDANCE,
    inputMode: "start",
    supportsAudio: true,
    blurb: "Animate from a reference image (character-consistent generation), referenced as @Image1 in the prompt.",
    tier: "quality",
    fields: [duration(SEEDANCE_DUR_OPTS), aspect(SEEDANCE_ASPECT_OPTS)],
    startParam: "image_urls", // VERIFIED (search) via fal-ai/seedance-2.0-api: an ARRAY (up to 9), not a single
    // image_url. The UI offers one upload slot; we send it as a 1-element array (startParamIsArray).
    startParamIsArray: true,
    priceUnit: "second",
  },
  {
    key: "seedance2-fast-text",
    id: "bytedance/seedance-2.0/fast/text-to-video", // VERIFIED (search)
    label: "Seedance 2.0 Fast — text",
    group: BYTEDANCE,
    inputMode: "text",
    supportsAudio: true,
    blurb: "Faster, cheaper Seedance 2.0 tier — same schema, lower latency and cost.",
    tier: "budget",
    fields: [duration(SEEDANCE_DUR_OPTS), aspect(SEEDANCE_ASPECT_OPTS)],
    priceUnit: "second",
  },
  {
    key: "seedance2-fast-start-end",
    id: "bytedance/seedance-2.0/fast/image-to-video", // VERIFIED (search)
    label: "Seedance 2.0 Fast — image",
    group: BYTEDANCE,
    inputMode: "start-end",
    supportsAudio: true,
    blurb: "Fast-tier Seedance 2.0: animate a start frame, with an optional end frame.",
    tier: "budget",
    fields: [duration(SEEDANCE_DUR_OPTS), aspect(SEEDANCE_ASPECT_OPTS)],
    startParam: "image_url", // VERIFIED (search)
    endParam: "end_image_url", // VERIFIED (search)
    priceUnit: "second",
  },
  {
    key: "seedance2-fast-reference",
    id: "bytedance/seedance-2.0/fast/reference-to-video", // VERIFIED (search)
    label: "Seedance 2.0 Fast — reference",
    group: BYTEDANCE,
    inputMode: "start",
    supportsAudio: true,
    blurb: "Fast-tier reference-to-video: animate from a reference image, lower cost.",
    tier: "budget",
    fields: [duration(SEEDANCE_DUR_OPTS), aspect(SEEDANCE_ASPECT_OPTS)],
    startParam: "image_urls", // VERIFIED (search): same array param as the standard-tier reference endpoint
    startParamIsArray: true,
    priceUnit: "second",
  },

  // --- xAI Grok Imagine Video (text/I2V/edit) -----------------------------
  {
    key: "grok-text",
    id: "xai/grok-imagine-video/text-to-video", // VERIFIED (search)
    label: "Grok Imagine — text",
    group: XAI,
    inputMode: "text",
    supportsAudio: true,
    blurb: "xAI's Grok Imagine — text-to-video with native audio, budget pricing.",
    tier: "budget",
    fields: [duration(GROK_DUR_OPTS), aspect(GROK_ASPECT_OPTS)],
    priceUnit: "second",
  },
  {
    key: "grok-start",
    id: "xai/grok-imagine-video/v1.5/image-to-video", // VERIFIED (search)
    label: "Grok Imagine 1.5 — image",
    group: XAI,
    inputMode: "start",
    supportsAudio: true,
    blurb: "Animate a start frame with Grok Imagine 1.5. Native audio, budget pricing.",
    tier: "budget",
    // VERIFIED (schema): the v1.5 i2v input has NO aspect_ratio ("grok-imagine-video-1.5
    // image-to-video (no `aspect_ratio`)" per its own schema description) — duration only.
    fields: [duration(GROK_DUR_OPTS)],
    startParam: "image_url", // VERIFIED (schema)
    priceUnit: "second",
  },
  {
    key: "grok-edit",
    id: "xai/grok-imagine-video/edit-video", // VERIFIED (search)
    label: "Grok Imagine — edit video",
    group: XAI,
    inputMode: "video",
    supportsAudio: false,
    blurb: "Edit an existing video with a text instruction. Max ~8.7s input.",
    tier: "budget",
    fields: [], // VERIFIED (search): output duration == input duration; no duration control
    videoParam: "video_url", // VERIFIED (search)
    priceUnit: "second",
  },

  // --- Topaz (video-to-video only: upscale, no prompt) --------------------
  {
    key: "topaz-upscale",
    id: "fal-ai/topaz/upscale/video", // VERIFIED (search)
    label: "Topaz — upscale video",
    group: TOPAZ,
    inputMode: "video",
    supportsAudio: false,
    blurb: "Upscale an existing video (Topaz Proteus/Artemis/Nyx/Gaia/Starlight models). No prompt.",
    tier: "quality",
    fields: [], // no duration/aspect — output follows the input video
    videoParam: "video_url", // VERIFIED (search)
    noPrompt: true, // VERIFIED (search): the schema has no prompt field — it's an upscaler, not a generator
    priceUnit: "second",
  },

  // --- sync.so (video-to-video only: lipsync, needs audio + video) --------
  {
    key: "sync-lipsync",
    id: "fal-ai/sync-lipsync/v3", // VERIFIED (search)
    label: "sync.so — lipsync v3",
    group: SYNC,
    inputMode: "video",
    supportsAudio: true,
    blurb: "Sync a video's mouth movement to a separate audio track. No prompt.",
    tier: "quality",
    fields: [], // no duration/aspect — output follows the input video
    videoParam: "video_url", // VERIFIED (search)
    audioParam: "audio_url", // VERIFIED (search)
    noPrompt: true, // VERIFIED (search): video_url + audio_url only, no prompt field
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
// Rates read straight off GET api.fal.ai/v1/models/pricing (July 2026) — every entry
// below is the live number for that endpoint, so the local table and the live fetch
// agree. Exceptions are the two families Fal bills in a unit we can't scale by
// duration ("units" / "minutes"); those are marked and derived, see their comments.
export const LOCAL_VIDEO_BASE: Record<string, { unit: VideoPriceUnit; price: number }> = {
  "veo3.1-text": { unit: "second", price: 0.4 }, // live: 0.4/seconds
  "veo3.1-start": { unit: "second", price: 0.4 }, // live: 0.4/seconds
  "veo3.1-fast-text": { unit: "second", price: 0.15 }, // live: 0.15/seconds
  "veo3.1-fast-start": { unit: "second", price: 0.15 }, // live: 0.15/seconds
  "kling3-text": { unit: "second", price: 0.14 }, // live: 0.14/seconds
  "kling3-start-end": { unit: "second", price: 0.14 }, // live: 0.14/seconds
  "kling3-standard-start-end": { unit: "second", price: 0.14 }, // live: 0.14/seconds (same as Pro)
  "kling-o3-edit": { unit: "second", price: 0.14 }, // live: 0.14/seconds
  "kling3-motion-control": { unit: "second", price: 0.168 }, // live: 0.168/seconds
  // Seedance bills in opaque "units" (0.014/unit standard, 0.0112/unit fast) that
  // liveVideoBaseFromPrice deliberately rejects — it can't be scaled by duration. These are
  // per-second estimates holding the live 0.8× fast/standard ratio; the standard figure is
  // the previously-verified ≈$0.092/s at 720p. ponytail: replace if Fal publishes a unit formula.
  "seedance2-text": { unit: "second", price: 0.092 },
  "seedance2-start-end": { unit: "second", price: 0.092 },
  "seedance2-reference": { unit: "second", price: 0.092 }, // same 0.014/unit tier as the other standard modes
  "seedance2-fast-text": { unit: "second", price: 0.0736 }, // 0.8× standard, matching the live unit ratio
  "seedance2-fast-start-end": { unit: "second", price: 0.0736 },
  "seedance2-fast-reference": { unit: "second", price: 0.0736 },
  "grok-text": { unit: "second", price: 0.05 }, // live: 0.05/seconds
  "grok-start": { unit: "second", price: 0.01 }, // live: 0.01/seconds (v1.5 i2v is far cheaper than t2v)
  "grok-edit": { unit: "second", price: 0.05 }, // live: 0.05/seconds
  "topaz-upscale": { unit: "second", price: 0.01 }, // live: 0.01/seconds
  // live: 8/minutes — liveVideoBaseFromPrice converts that to 0.1333/s; kept in sync here.
  "sync-lipsync": { unit: "second", price: 8 / 60 },
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
  if (u.includes("minute")) return { base: p.unit_price / 60, unit: "second" }; // e.g. sync-lipsync bills $8/minute
  if (u.includes("video") || u.includes("clip") || u.includes("generation")) return { base: p.unit_price, unit: "video" };
  return undefined; // placeholder unit ("units", "credits") — caller falls back to LOCAL_VIDEO_BASE
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
  frames: { startUrl?: string; endUrl?: string; videoUrl?: string; audioUrl?: string },
  s: VideoSettings,
): Record<string, unknown> {
  const input: Record<string, unknown> = model.noPrompt ? {} : { prompt };

  // Required params with no default that we expose no control for (see extraInput).
  if (model.extraInput) Object.assign(input, model.extraInput);

  // Start frame / reference image — onto the model's actual param name. Sent whenever
  // the model declares one and a value is supplied, independent of inputMode: covers
  // plain start/start-end frames *and* motion-control's reference image (inputMode
  // "video"). Seedance's reference-to-video takes an array ("image_urls"); every other
  // model takes a plain string.
  if (model.startParam && frames.startUrl) {
    input[model.startParam] = model.startParamIsArray ? [frames.startUrl] : frames.startUrl;
  }
  if (model.inputMode === "start-end" && model.endParam && frames.endUrl) {
    input[model.endParam] = frames.endUrl;
  }

  // Source video — the video-to-video family (edit / upscale / motion-control / lipsync).
  if (model.inputMode === "video" && model.videoParam && frames.videoUrl) {
    input[model.videoParam] = frames.videoUrl;
  }

  // Source audio — independent of inputMode (only sync-lipsync uses it today).
  if (model.audioParam && frames.audioUrl) {
    input[model.audioParam] = frames.audioUrl;
  }

  // Duration — schema-gated, and the wire type differs per family (VERIFIED against each
  // endpoint's OpenAPI input schema): Veo takes the string "8s", Kling and Seedance take
  // a *string* enum member ("8"), Grok takes a plain integer (min 1, max 15).
  if (hasVideoField(model, "durationSec")) {
    const secs = effectiveDuration(model, s);
    input.duration = model.id.startsWith("xai/")
      ? secs
      : model.id.startsWith("fal-ai/veo3.1")
        ? `${secs}s`
        : String(secs);
  }

  // Aspect ratio — schema-gated; "" means use the model default (omit it).
  if (hasVideoField(model, "aspectRatio")) {
    const ar = effectiveAspectRatio(model, s);
    if (ar) input.aspect_ratio = ar;
  }

  return input;
}
