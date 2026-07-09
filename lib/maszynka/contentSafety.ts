// Content safety pre-check LLM stage (PRD section 10 / dump/Maszynka v2.0.md section 6
// "Content safety pre-check"; issue #7). This is the FIRST stage in the pipeline — it
// runs before the Asset analysis stage (issue #6) and before any FAL generation call, so
// prohibited/regulated/legally-risky/model-policy-violating input never incurs FAL
// generation cost. Priority logic (CONTEXT.md: "content safety > product/brand
// preservation > packshot analysis > hook > style > camera setting > operator prompt")
// puts this stage's verdict at the very top of the stack.
//
// One vision LLM call (not per-asset like Asset analysis — a single call sees the
// operator's raw prompt plus every uploaded asset at once, since the check is about the
// whole run's input, not any one asset's role) via OpenRouter's /api/chat BYOK proxy +
// `response_format: json_schema` (strict) — same pattern as assetAnalysis.ts/
// promptBuilder.ts/promptReviewer.ts; the schema below doubles as both the OpenRouter
// contract and the runtime validator (hand-rolled, no schema library; see
// promptBuilder.ts header for why). No external moderation API — this is deliberate
// per PRD/ADR.
//
// Same layering as the other stage modules: pure request/response helpers plus one
// impure network call (callContentSafety).
import type { WirePart } from "../chat/attachments";
import { CHAT_MODELS, CHAT_MODEL_BY_ID, DEFAULT_CHAT_MODEL, modelSupportsImages, type ChatModelDef } from "../chat/models.ts";
import type { AssetRole } from "./contract";
import type { StagePromptsConfig } from "./configSchemas";
// Explicit extension: a real runtime import (resolveContentSafetySystemPrompt is a
// value, not just a type), so Node's type-stripping runtime needs it to resolve
// directly (see promptBuilder.ts's header for the same constraint / contentSafety.check.ts).
import { resolveContentSafetySystemPrompt } from "./stagePromptResolver.ts";

// --- model selection ---------------------------------------------------------
// Vision is mandatory (the stage must look at every uploaded asset, not just read the
// prompt) and structured output keeps the schema gate meaningful — same filter as the
// asset analysis/builder/reviewer stages (PRD "LLM stages via OpenRouter": each stage
// picks its own model).
export const CONTENT_SAFETY_MODELS: ChatModelDef[] = CHAT_MODELS.filter(
  (m) => m.structuredOutput && modelSupportsImages(m.id),
);
export const CONTENT_SAFETY_MODEL_GROUPS: string[] = [...new Set(CONTENT_SAFETY_MODELS.map((m) => m.group))];

export const DEFAULT_CONTENT_SAFETY_MODEL: string =
  CHAT_MODEL_BY_ID[DEFAULT_CHAT_MODEL]?.structuredOutput && modelSupportsImages(DEFAULT_CHAT_MODEL)
    ? DEFAULT_CHAT_MODEL
    : (CONTENT_SAFETY_MODELS[0]?.id ?? DEFAULT_CHAT_MODEL);

// --- output shape + JSON Schema -----------------------------------------------

export type ContentSafetyStatus =
  | "content_safety_passed"
  | "content_safety_allowed_with_constraints"
  | "content_safety_revise_required"
  | "content_safety_blocked";
const CONTENT_SAFETY_STATUSES: ContentSafetyStatus[] = [
  "content_safety_passed",
  "content_safety_allowed_with_constraints",
  "content_safety_revise_required",
  "content_safety_blocked",
];

export interface ContentSafetyOutput {
  status: ContentSafetyStatus;
  /** Concrete findings behind the status — empty array only when status is
   *  `content_safety_passed`. */
  reasons: string[];
  /** Operator-facing constraints the run must honor. Populated only when status is
   *  `content_safety_allowed_with_constraints`; these flow into the Prompt builder
   *  Contract as `safetyConstraints` (see contract.ts) — the highest-priority layer the
   *  Prompt builder must respect (PRD priority logic: content safety is rank 1). */
  constraints: string[];
}

/** Sent verbatim as `response_format.json_schema.schema` (OpenRouter strict mode:
 *  every property required, no additional properties). */
export const CONTENT_SAFETY_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["status", "reasons", "constraints"],
  properties: {
    status: {
      type: "string",
      enum: CONTENT_SAFETY_STATUSES,
      description:
        "'content_safety_passed' if nothing of concern was found. 'content_safety_allowed_with_constraints' if the " +
        "run may proceed but only under specific constraints. 'content_safety_revise_required' if the operator " +
        "must change the prompt/assets before this run can proceed at all. 'content_safety_blocked' if this run " +
        "must stop outright and should not be retried.",
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      description:
        "Concrete findings behind the status — what prohibited/regulated/risky/policy-violating content was (or " +
        "wasn't) found. Empty array only when status is 'content_safety_passed'.",
    },
    constraints: {
      type: "array",
      items: { type: "string" },
      description:
        "Specific, operator-facing constraints the run must honor (e.g. 'no visible alcohol branding', 'no " +
        "medical claims'). Populated only when status is 'content_safety_allowed_with_constraints'; empty array " +
        "for every other status.",
    },
  },
};

// Hardcoded fallback (issue #19 / PRD story 33): used whenever a run has no
// `stage_prompts` config yet, or the operator left `contentSafety.systemPrompt` blank —
// see stagePromptResolver.ts. This same text is also the `stage_prompts` seed content
// (configSeeds.ts's `STAGE_PROMPTS_SEED.contentSafety.systemPrompt`, copied by hand there
// rather than imported — see that file's header for why).
const CONTENT_SAFETY_SYSTEM_PROMPT = `You are the Content safety pre-check stage of the Maszynka Content Factory test bench — the FIRST stage of the pipeline, running before Asset analysis and before any FAL generation call. Priority logic ranks content safety at the very top: your verdict overrides every other layer (product/brand preservation, hook, style, camera setting, operator prompt).

You are given the operator's raw prompt and every uploaded asset image (if any). An asset's systemic role — packshot, style_reference, brand_reference, campaign_reference — is not relevant to this check; inspect every image's actual content regardless of role.

Check the prompt and every image for content that is prohibited, legally regulated, legally risky, or likely to violate a downstream image-generation model's own content policy — for example: sexual content involving minors, non-consensual intimate imagery, extreme violence or gore, instructions for illegal activity, hate symbols or hateful content, weapons in a threatening context, or regulated-product claims (e.g. medical/pharmaceutical claims) the operator has no right to make.

Respond with ONE JSON object (matching the required schema exactly):
- status: "content_safety_passed" if nothing of concern was found; "content_safety_allowed_with_constraints" if the run may proceed but only under specific constraints; "content_safety_revise_required" if the operator must change the prompt/assets before this run can proceed at all; "content_safety_blocked" if this run must stop outright and should not be retried.
- reasons: concrete findings behind the status (empty array only when status is "content_safety_passed").
- constraints: specific, operator-facing constraints the run must honor — populated only when status is "content_safety_allowed_with_constraints" (empty array for every other status).

Respond with the JSON object only.`;

function contentSafetyUserText(userPromptRaw: string, assets: { role: AssetRole }[]): string {
  const assetLine = assets.length
    ? `Uploaded assets (${assets.length}): ${assets.map((a) => a.role).join(", ")}. Each is attached below as an image.`
    : "No assets were uploaded for this run.";
  return `User prompt:\n${userPromptRaw}\n\n${assetLine}`;
}

// --- request building ----------------------------------------------------------

export interface ContentSafetyRequestBody {
  model: string;
  messages: { role: "system" | "user"; content: string | WirePart[] }[];
  temperature: number;
  max_tokens: number;
  top_p: number;
  stream: false;
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };
}

/** Builds the exact OpenRouter chat-completions body for the content safety pre-check.
 *  Unlike the Asset analysis stage (one call per asset), this is a single call covering
 *  the operator's raw prompt plus every uploaded asset at once — the check is about the
 *  whole run's input as a unit, not any one asset's role. Every asset is attached as an
 *  image_url part so the vision model can inspect actual pixel content, not just role
 *  labels. `stagePrompts` is the run's resolved `stage_prompts` config snapshot (issue
 *  #19) — omit it (or pass null/undefined) to fall back to the hardcoded default above,
 *  same behavior as before this stage was configurable. */
export function buildContentSafetyRequestBody(
  userPromptRaw: string,
  assets: { role: AssetRole; url: string }[],
  model: string,
  stagePrompts?: StagePromptsConfig | null,
): ContentSafetyRequestBody {
  const text = contentSafetyUserText(userPromptRaw, assets);
  const userContent: string | WirePart[] = assets.length
    ? [{ type: "text", text }, ...assets.map((a) => ({ type: "image_url" as const, image_url: { url: a.url } }))]
    : text;
  const systemPrompt = resolveContentSafetySystemPrompt(stagePrompts, CONTENT_SAFETY_SYSTEM_PROMPT);

  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 800,
    top_p: 1,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: { name: "content_safety_output", strict: true, schema: CONTENT_SAFETY_OUTPUT_SCHEMA },
    },
  };
}

// --- output validation (doubles as the runtime gate for CONTENT_SAFETY_OUTPUT_SCHEMA) --

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Validates a parsed content-safety response against the schema above. Empty array =
 *  valid. */
export function validateContentSafetyOutput(value: unknown): string[] {
  if (!isPlainObject(value)) return ["output must be a JSON object"];
  const errors: string[] = [];
  if (typeof value.status !== "string" || !CONTENT_SAFETY_STATUSES.includes(value.status as ContentSafetyStatus)) {
    errors.push(`status must be one of: ${CONTENT_SAFETY_STATUSES.join(", ")}`);
  }
  if (!isStringArray(value.reasons)) errors.push("reasons must be an array of strings");
  if (!isStringArray(value.constraints)) errors.push("constraints must be an array of strings");
  return errors;
}

/** Parses + validates the model's raw message content in one step. `output` is null
 *  whenever `errors` is non-empty — callers should never trust a non-empty `output`
 *  alongside errors. */
export function parseContentSafetyContent(content: string): { output: ContentSafetyOutput | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { output: null, errors: [`response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const errors = validateContentSafetyOutput(parsed);
  if (errors.length) return { output: null, errors };
  return { output: parsed as ContentSafetyOutput, errors: [] };
}

// --- persisted record (persisted shape) ------------------------------------------

/** The stage's full record — request/response/parsed-output — as persisted on the run
 *  (see lib/maszynka/store.ts `contentSafetyRequest`/`contentSafetyResponse`/
 *  `contentSafetyOutput`). One call per run, no revise loop of its own (unlike the
 *  Prompt builder/reviewer pair) — `content_safety_revise_required` means the *operator*
 *  must change the input and start a new run, not that this stage retries itself.
 *  `output` is null and `errors` is set when the call itself failed (network error /
 *  invalid JSON / schema violation); callers treat that the same as a fail-closed
 *  `content_safety_blocked` — there is no dedicated "technical failure" status in the
 *  PRD's four-way vocabulary, and a safety gate should never fail open. */
export interface ContentSafetyRecord {
  request: unknown;
  response: unknown;
  output: ContentSafetyOutput | null;
  errors?: string[];
}

// --- network call (impure) ------------------------------------------------------

/** POSTs the content-safety request through our /api/chat BYOK proxy (non-streaming)
 *  and returns both the raw OpenRouter response (for run persistence/debug) and the
 *  assistant message content (for parseContentSafetyContent). Throws on a non-OK
 *  response or a response with no message content — callers treat both as this run
 *  failing the safety gate closed (see module header). */
export async function callContentSafety(
  apiKey: string,
  body: ContentSafetyRequestBody,
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
      `Content safety pre-check request failed (${res.status})`;
    throw new Error(message);
  }

  const content = (raw as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Content safety pre-check response had no message content");
  }
  return { raw, content };
}
