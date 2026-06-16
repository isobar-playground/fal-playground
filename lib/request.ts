// Pure helpers for the "inspect & override the exact Fal request" feature.
//
// Two deep, pure modules live here:
//   1. A catalog-derived *request-schema descriptor* — given a model, the known
//      input keys plus allowed enum values / expected types. No live Fal schema is
//      fetched; everything is derived from the local catalog (lib/models.ts and
//      lib/video/models.ts) so the descriptor stays accurate as models are added.
//   2. An *override validation* function — raw edited text + model → parsed object,
//      syntax error (hard block), and schema warnings (non-blocking).
//
// Keeping these pure and catalog-driven means the panel, the send path, and the
// result record all agree on what a request looks like.

import type { ModelDef, Field } from "./models";
import type { VideoModelDef } from "./video/models";

// --- schema descriptor ---------------------------------------------------

/** A single known input key, with the constraints we can derive from the catalog. */
export interface KnownKey {
  key: string;
  /** Allowed string enum values, when the field is a fixed-option select. */
  enumValues?: string[];
  /** Expected JS type of the value (best-effort, for the "wrong type" warning). */
  type?: "string" | "number" | "boolean" | "object" | "array";
}

export interface RequestSchema {
  /** Map of known input key → its constraints. */
  keys: Record<string, KnownKey>;
}

const enumKey = (key: string, opts: { value: string }[]): KnownKey => ({
  key,
  type: "string",
  // "" is a sentinel meaning "omit / model default" in the catalog — never sent,
  // so it isn't a real accepted enum value.
  enumValues: opts.map((o) => o.value).filter((v) => v !== ""),
});

/**
 * Known input keys for an image model — derived from the always-present base keys,
 * the family-specific branch of `buildInput`, the declarative `fields`, and (for edit
 * models) the image_urls param. Mirrors what `buildInput` can actually emit.
 */
export function imageRequestSchema(model: ModelDef): RequestSchema {
  const keys: Record<string, KnownKey> = {
    // always present
    prompt: { key: "prompt", type: "string" },
    num_images: { key: "num_images", type: "number" },
  };

  // Family-specific keys that buildInput emits unconditionally for that family.
  switch (model.family) {
    case "nano-banana":
      break;
    case "nano-banana-2":
    case "nano-banana-pro":
      keys.resolution = { key: "resolution", type: "string" };
      break;
    case "gpt-image-1":
      keys.image_size = { key: "image_size", type: "string" };
      keys.quality = { key: "quality", type: "string" };
      break;
    case "gpt-image-2":
      keys.image_size = { key: "image_size", type: "object" };
      keys.quality = { key: "quality", type: "string" };
      break;
  }

  // Declarative fields → the input keys + enum constraints they drive.
  for (const f of model.fields) {
    const k = imageFieldKey(f);
    if (!k) continue;
    if (f.kind === "select") {
      // resolution/size already typed above for nano-2/pro & gpt; refine enums.
      keys[k] = enumKey(k, f.options);
      if (f.key === "size" && model.family === "gpt-image-2") {
        // gpt-image-2 sends {width,height}, not the "WxH" string — type is object.
        keys[k] = { key: k, type: "object" };
      }
    } else if (f.kind === "seed") {
      keys.seed = { key: "seed", type: "number" };
    }
  }

  if (model.mode === "edit") {
    keys.image_urls = { key: "image_urls", type: "array" };
  }

  return { keys };
}

/** The Fal input key an image field maps onto (mirrors buildInput's naming). */
function imageFieldKey(f: Field): string | null {
  if (f.kind === "images") return "num_images";
  if (f.kind === "seed") return "seed";
  switch (f.key) {
    case "resolution":
      return "resolution";
    case "quality":
      return "quality";
    case "size":
      return "image_size";
    case "aspectRatio":
      return "aspect_ratio";
    case "safetyTolerance":
      return "safety_tolerance";
    case "outputFormat":
      return "output_format";
  }
  return null;
}

/**
 * Known input keys for a video model — prompt, frame params (per-model names),
 * and the declarative duration/aspect fields. Mirrors `buildVideoInput`.
 */
export function videoRequestSchema(model: VideoModelDef): RequestSchema {
  const keys: Record<string, KnownKey> = {
    prompt: { key: "prompt", type: "string" },
  };

  if (model.inputMode !== "text" && model.startParam) {
    keys[model.startParam] = { key: model.startParam, type: "string" };
  }
  if (model.inputMode === "start-end" && model.endParam) {
    keys[model.endParam] = { key: model.endParam, type: "string" };
  }

  for (const f of model.fields) {
    if (f.kind === "select" && f.key === "durationSec") {
      // Veo expects a string "Ns"; everyone else an integer — accept both.
      keys.duration = {
        key: "duration",
        // no fixed enum (string-vs-number varies); leave type open.
      };
    } else if (f.kind === "select" && f.key === "aspectRatio") {
      keys.aspect_ratio = enumKey("aspect_ratio", f.options);
    }
  }

  return { keys };
}

// --- override validation -------------------------------------------------

export interface OverrideValidation {
  /** The parsed object, when the text is valid JSON describing an object. */
  parsed?: Record<string, unknown>;
  /** A hard-blocking JSON syntax (or shape) error. */
  syntaxError?: string;
  /** Non-blocking schema-mismatch warnings (unknown keys, bad enums, wrong types). */
  warnings: string[];
}

const jsTypeOf = (v: unknown): KnownKey["type"] => {
  if (Array.isArray(v)) return "array";
  if (v === null) return "object";
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean" || t === "object") return t;
  return "object";
};

/**
 * Validate raw edited JSON text against a model's catalog-derived schema.
 *  - JSON syntax errors (or a non-object root) → `syntaxError` (hard block).
 *  - Unknown keys, out-of-range enum values, wrong types → `warnings` (non-blocking).
 */
export function validateOverride(text: string, schema: RequestSchema): OverrideValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { syntaxError: e instanceof Error ? e.message : "Invalid JSON", warnings: [] };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { syntaxError: "The request must be a JSON object.", warnings: [] };
  }

  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const known = schema.keys[key];
    if (!known) {
      warnings.push(`Unknown parameter "${key}" — not in this model's known schema (sent anyway).`);
      continue;
    }
    if (known.enumValues && typeof value === "string" && !known.enumValues.includes(value)) {
      warnings.push(`"${key}" = "${value}" is outside the known options (${known.enumValues.join(", ")}).`);
    }
    if (known.type) {
      const actual = jsTypeOf(value);
      if (actual !== known.type) {
        warnings.push(`"${key}" should be ${known.type} but got ${actual}.`);
      }
    }
  }

  return { parsed: obj, warnings };
}

// --- pretty-printing -----------------------------------------------------

/** Stable 2-space pretty-print used both in the preview and when seeding the editor. */
export const prettyJson = (input: Record<string, unknown>): string => JSON.stringify(input, null, 2);
