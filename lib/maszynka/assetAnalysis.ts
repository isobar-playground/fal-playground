// Asset analysis LLM stage (PRD section 11 / dump/Maszynka v2.0.md section 7 "Asset
// analysis"; term "Asset role" defined in CONTEXT.md). Runs once per uploaded asset,
// right after `run_started`, and produces a structured description that feeds both the
// Contract (see contract.ts) and the debug preview — the Prompt builder then works from
// this text instead of (only) raw pixels. Same OpenRouter /api/chat BYOK proxy +
// `response_format: json_schema` (strict) pattern as promptBuilder.ts/promptReviewer.ts —
// the schema below doubles as both the OpenRouter contract and the runtime validator
// (hand-rolled, no schema library; see promptBuilder.ts header for why).
//
// One schema shape is shared across all four asset roles (`preserveElements` +
// `attributes` + `description`) so a single JSON Schema and a single validator cover
// every call — what varies per role is the *system prompt* (spec section 3/7: role
// comes from the upload field, never operator prose) and, therefore, what a model
// actually puts in `attributes`/`preserveElements`:
//   - packshot: attributes carries productType/packagingShape/color/logo/label/variant;
//     preserveElements lists every element that must not be changed (packaging, color,
//     proportions, logo, label, variant) — the acceptance criterion "packshot analysis
//     lists preservation-critical elements".
//   - style/brand/campaign reference: attributes carries only what that role provides
//     (look/mood/lighting for style; brand elements/palette for brand; series rhythm/
//     consistency for campaign); preserveElements is always empty — a reference is
//     never a preservation target.
//
// Same layering as promptBuilder.ts: pure request/response helpers plus one impure
// network call (callAssetAnalysis).
import type { WirePart } from "../chat/attachments";
import { CHAT_MODELS, CHAT_MODEL_BY_ID, DEFAULT_CHAT_MODEL, modelSupportsImages, type ChatModelDef } from "../chat/models.ts";
import type { AssetRole } from "./contract";
import type { StagePromptsConfig } from "./configSchemas";
// Explicit extension: a real runtime import (see contentSafety.ts's comment / this
// module's assetAnalysis.check.ts).
import { resolveAssetAnalysisSystemPrompt } from "./stagePromptResolver.ts";

// --- model selection ---------------------------------------------------------
// Vision is mandatory (the stage's whole job is describing an image); structured
// output keeps the schema gate meaningful — same filter as the builder/reviewer
// stages (PRD "LLM stages via OpenRouter": each stage picks its own model).
export const ASSET_ANALYSIS_MODELS: ChatModelDef[] = CHAT_MODELS.filter(
  (m) => m.structuredOutput && modelSupportsImages(m.id),
);
export const ASSET_ANALYSIS_MODEL_GROUPS: string[] = [...new Set(ASSET_ANALYSIS_MODELS.map((m) => m.group))];

export const DEFAULT_ASSET_ANALYSIS_MODEL: string =
  CHAT_MODEL_BY_ID[DEFAULT_CHAT_MODEL]?.structuredOutput && modelSupportsImages(DEFAULT_CHAT_MODEL)
    ? DEFAULT_CHAT_MODEL
    : (ASSET_ANALYSIS_MODELS[0]?.id ?? DEFAULT_CHAT_MODEL);

// --- output shape + JSON Schema -----------------------------------------------

export interface AssetAnalysisAttribute {
  key: string;
  value: string;
}

export interface AssetAnalysisOutput {
  /** A short, role-appropriate description of the asset (what it shows and how the
   *  Prompt builder should read it — spec section 7). */
  description: string;
  /** Structured facts extracted from the image, role-specific (see module header).
   *  Empty array is valid when nothing is confidently visible. */
  attributes: AssetAnalysisAttribute[];
  /** Elements that must be preserved exactly in the generated output. Only ever
   *  populated for role "packshot" (packaging, color, proportions, logo, label,
   *  variant); always an empty array for reference roles — a reference informs style/
   *  brand/campaign, it is never itself a preservation target. */
  preserveElements: string[];
}

/** Sent verbatim as `response_format.json_schema.schema` (OpenRouter strict mode:
 *  every property required, no additional properties). Shared by every role — see
 *  module header for why the *content* still differs by role. */
export const ASSET_ANALYSIS_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["description", "attributes", "preserveElements"],
  properties: {
    description: {
      type: "string",
      description: "A short, role-appropriate description of what this asset shows.",
    },
    attributes: {
      type: "array",
      description: "Role-specific structured facts extracted from the image, as key/value pairs.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "value"],
        properties: {
          key: { type: "string", description: "e.g. productType, packagingShape, color, logo, label, variant." },
          value: { type: "string" },
        },
      },
    },
    preserveElements: {
      type: "array",
      items: { type: "string" },
      description:
        "Elements that must be preserved exactly in the generated output. Only for role 'packshot' " +
        "(packaging, color, proportions, logo, label, variant) — empty array for every reference role.",
    },
  },
};

// Hardcoded fallbacks (issue #19 / PRD story 33): used whenever a run has no
// `stage_prompts` config yet, or the operator left a field blank — see
// stagePromptResolver.ts's `resolveAssetAnalysisSystemPrompt`. Same text as the
// `stage_prompts` seed content (configSeeds.ts's `STAGE_PROMPTS_SEED.assetAnalysis`,
// copied by hand there — see that file's header for why), split the same way: shared
// base instructions (PRD story 22) plus one instruction block per Asset role.
const ASSET_ANALYSIS_BASE_INSTRUCTIONS = `You are the Asset analysis stage of the Maszynka Content Factory test bench.

You are given exactly one uploaded image and its systemic role (derived from which upload field it came through, never from operator prose — see the role instruction below). Your job is to produce a structured description of THIS image for the Prompt builder stage to use instead of raw pixels.

Respond with ONE JSON object (matching the required schema exactly): description, attributes, preserveElements. Respond with the JSON object only.`;

const ROLE_INSTRUCTIONS: Record<AssetRole, string> = {
  packshot:
    "This image's role is PACKSHOT — the product that must be preserved exactly in the generated asset. " +
    "Describe: product type, packaging shape, color, logo, label (including any visible label text), and " +
    "product variant. Put each of those as a key/value pair in `attributes` (keys: productType, " +
    "packagingShape, color, logo, label, variant — omit a key if genuinely not visible/applicable). List " +
    "every element that must NOT be changed (packaging, color, proportions, logo, label, variant) in " +
    "`preserveElements`.",
  style_reference:
    "This image's role is STYLE REFERENCE — it supplies visual look only: mood, lighting, color palette and " +
    "general aesthetic. It is NOT a product to preserve — do not describe packaging/logo/label, and leave " +
    "`preserveElements` as an empty array. Put style-relevant facts in `attributes` (keys such as " +
    "visualStyle, lighting, colorPalette, composition).",
  brand_reference:
    "This image's role is BRAND REFERENCE — it supplies brand elements only: palette, key visual, layout " +
    "feel, or brand visual rules. It is NOT a product to preserve — leave `preserveElements` as an empty " +
    "array. Put brand-relevant facts in `attributes` (keys such as brandElements, colorPalette, " +
    "typographyNotes, layoutFeel).",
  campaign_reference:
    "This image's role is CAMPAIGN REFERENCE — it supplies the rhythm/consistency of a series, not literal " +
    "copy to reuse. It is NOT a product to preserve — leave `preserveElements` as an empty array. Put " +
    "campaign-relevant facts in `attributes` (keys such as campaignTheme, seriesRhythm, moodTone) and do not " +
    "transcribe any old marketing copy 1:1.",
};

/** Composes the base instructions with the analyzed asset's role-specific block (PRD
 *  story 22) — configured `stage_prompts` text if present, the hardcoded defaults above
 *  otherwise, resolved field-by-field (stagePromptResolver.ts). */
function systemPromptFor(role: AssetRole, stagePrompts?: StagePromptsConfig | null): string {
  return resolveAssetAnalysisSystemPrompt(stagePrompts, role, ASSET_ANALYSIS_BASE_INSTRUCTIONS, ROLE_INSTRUCTIONS);
}

// --- request building ----------------------------------------------------------

export interface AssetAnalysisRequestBody {
  model: string;
  messages: { role: "system" | "user"; content: string | WirePart[] }[];
  temperature: number;
  max_tokens: number;
  top_p: number;
  stream: false;
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };
}

/** Builds the exact OpenRouter chat-completions body for analyzing one asset.
 *  `stagePrompts` is the run's resolved `stage_prompts` config snapshot (issue #19) —
 *  omit it (or pass null/undefined) to fall back to the hardcoded defaults, same
 *  behavior as before this stage was configurable. */
export function buildAssetAnalysisRequestBody(
  asset: { role: AssetRole; url: string },
  model: string,
  stagePrompts?: StagePromptsConfig | null,
): AssetAnalysisRequestBody {
  return {
    model,
    messages: [
      { role: "system", content: systemPromptFor(asset.role, stagePrompts) },
      {
        role: "user",
        content: [
          { type: "text", text: `Analyze this ${asset.role} image.` },
          { type: "image_url", image_url: { url: asset.url } },
        ],
      },
    ],
    temperature: 0.2,
    max_tokens: 800,
    top_p: 1,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: { name: "asset_analysis_output", strict: true, schema: ASSET_ANALYSIS_OUTPUT_SCHEMA },
    },
  };
}

// --- output validation (doubles as the runtime gate for ASSET_ANALYSIS_OUTPUT_SCHEMA) --

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isAttributeArray(v: unknown): v is AssetAnalysisAttribute[] {
  return (
    Array.isArray(v) &&
    v.every(
      (x) => isPlainObject(x) && typeof x.key === "string" && x.key.trim().length > 0 && typeof x.value === "string",
    )
  );
}

/** Validates a parsed asset-analysis response against the schema above. Empty array =
 *  valid. */
export function validateAssetAnalysisOutput(value: unknown): string[] {
  if (!isPlainObject(value)) return ["output must be a JSON object"];
  const errors: string[] = [];
  if (!isNonEmptyString(value.description)) errors.push("description must be a non-empty string");
  if (!isAttributeArray(value.attributes)) errors.push("attributes must be an array of {key, value} string pairs");
  if (!isStringArray(value.preserveElements)) errors.push("preserveElements must be an array of strings");
  return errors;
}

/** Parses + validates the model's raw message content in one step. `output` is null
 *  whenever `errors` is non-empty — callers should never trust a non-empty `output`
 *  alongside errors. */
export function parseAssetAnalysisContent(content: string): { output: AssetAnalysisOutput | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { output: null, errors: [`response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const errors = validateAssetAnalysisOutput(parsed);
  if (errors.length) return { output: null, errors };
  return { output: parsed as AssetAnalysisOutput, errors: [] };
}

// --- per-asset record (persisted shape) ------------------------------------------

/** One asset's full analysis record — request/response/parsed-output — as persisted on
 *  the run (see lib/maszynka/store.ts `assetAnalysisResults`). `output` is null and
 *  `errors` is set when the call itself failed (network error / invalid JSON / schema
 *  violation) — a single failed asset ends the whole run at `asset_analysis_failed`
 *  (PRD acceptance criterion), so this array is written once, in full, when the stage
 *  finishes (no append-then-retry loop like the Prompt builder's revise cycle). */
export interface AssetAnalysisRecord {
  assetId: string;
  role: AssetRole;
  url: string;
  request: unknown;
  response: unknown;
  output: AssetAnalysisOutput | null;
  errors?: string[];
}

// --- network call (impure) ------------------------------------------------------

/** POSTs the analysis request through our /api/chat BYOK proxy (non-streaming) and
 *  returns both the raw OpenRouter response (for run persistence/debug) and the
 *  assistant message content (for parseAssetAnalysisContent). Throws on a non-OK
 *  response or a response with no message content — callers treat both as this asset's
 *  analysis failing outright. */
export async function callAssetAnalysis(
  apiKey: string,
  body: AssetAnalysisRequestBody,
): Promise<{ raw: unknown; content: string }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-openrouter-key": apiKey },
    body: JSON.stringify(body),
  });

  let raw: unknown = null;
  try {
    raw = await res.json();
  } catch {
    /* non-JSON body — raw stays null, error message below falls back */
  }

  if (!res.ok) {
    const errObj = raw as { error?: { message?: string } | string } | null;
    const message =
      (errObj && typeof errObj.error === "object" ? errObj.error?.message : undefined) ??
      (typeof errObj?.error === "string" ? errObj.error : undefined) ??
      `Asset analysis request failed (${res.status})`;
    throw new Error(message);
  }

  const content = (raw as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Asset analysis response had no message content");
  }
  return { raw, content };
}
