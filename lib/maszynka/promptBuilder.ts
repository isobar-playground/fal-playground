// Prompt builder LLM stage (PRD section 9 / dump/Maszynka v2.0.md "Prompt builder";
// term defined in CONTEXT.md). Turns a validated Contract (see contract.ts) into
// structured JSON via OpenRouter, using the same /api/chat BYOK proxy the Chat tab
// uses (app/api/chat/route.ts) and `response_format: json_schema` strict — the
// schema below doubles as both the OpenRouter contract and the runtime validator,
// same pattern as configSchemas.ts / contract.ts (hand-rolled, no schema library;
// see those files' headers for why).
//
// This module mixes pure request/response helpers with one impure network call
// (callPromptBuilder), same layering as lib/chat/openrouter.ts.
import type { WirePart } from "../chat/attachments";
// Node's type-stripping runtime only auto-erases type-only imports; a runtime import
// (CHAT_MODELS etc. are real values, not just types) must resolve for real, so this one
// needs an explicit extension when run directly by node (see promptBuilder.check.ts).
import { CHAT_MODELS, CHAT_MODEL_BY_ID, DEFAULT_CHAT_MODEL, modelSupportsImages, type ChatModelDef } from "../chat/models.ts";
import type { Contract } from "./contract";

// --- model selection ---------------------------------------------------------
// Per PRD "LLM stages via OpenRouter": each stage picks its own OpenRouter model,
// with a vision-capable default (the builder gets the packshot as an image part
// below, since there's no asset-analysis stage yet to pre-digest it into text).
export const PROMPT_BUILDER_MODELS: ChatModelDef[] = CHAT_MODELS.filter(
  (m) => m.structuredOutput && modelSupportsImages(m.id),
);
export const PROMPT_BUILDER_MODEL_GROUPS: string[] = [...new Set(PROMPT_BUILDER_MODELS.map((m) => m.group))];

// DEFAULT_CHAT_MODEL (Claude Sonnet 4.6) is already vision + structured-output
// capable, so it doubles as the builder stage's default — no need for a second
// curated constant that could drift from the chat tab's default.
export const DEFAULT_PROMPT_BUILDER_MODEL: string =
  CHAT_MODEL_BY_ID[DEFAULT_CHAT_MODEL]?.structuredOutput && modelSupportsImages(DEFAULT_CHAT_MODEL)
    ? DEFAULT_CHAT_MODEL
    : (PROMPT_BUILDER_MODELS[0]?.id ?? DEFAULT_CHAT_MODEL);

// --- output shape + JSON Schema -----------------------------------------------

export interface PromptBuilderOutput {
  finalPrompt: string;
  negativePrompt: string;
  promptSummary: string;
  appliedRules: string[];
  riskNotes: string[];
}

/** Sent verbatim as `response_format.json_schema.schema` (OpenRouter strict mode:
 *  every property required, no additional properties). */
export const PROMPT_BUILDER_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["finalPrompt", "negativePrompt", "promptSummary", "appliedRules", "riskNotes"],
  properties: {
    finalPrompt: {
      type: "string",
      description: "The complete final prompt to send to the FAL image generation model.",
    },
    negativePrompt: {
      type: "string",
      description: "Negative prompt / things to avoid. Empty string if none apply.",
    },
    promptSummary: {
      type: "string",
      description: "A short, human-readable summary of what the builder did and why.",
    },
    appliedRules: {
      type: "array",
      items: { type: "string" },
      description: "IDs or names of the hook, style, camera setting and global rules actually applied.",
    },
    riskNotes: {
      type: "array",
      items: { type: "string" },
      description: "Risks, ambiguities, or priority-logic conflicts the builder flagged. Empty array if none.",
    },
  },
};

const PROMPT_BUILDER_SYSTEM_PROMPT = `You are the Prompt builder stage of the Maszynka Content Factory test bench.

You receive a single JSON "Contract" object describing one test run: the operator's raw prompt, any uploaded assets (asset "role" is systemic — packshot/style_reference/brand_reference/campaign_reference — never inferred from prose), a selected Hook (short attention-grabbing marketing text to render on the asset), a selected Style preset, a selected Camera setting preset, a set of global rules that always apply, an ordered Priority logic (most important first: content safety > product/brand preservation > packshot analysis > hook > style > camera setting > operator prompt — on conflict, the higher layer wins), the target model's capabilities, and generation settings (target language, aspect ratio, variant count).

If a packshot image is attached to this message, it is the product that MUST be preserved exactly: packaging, color, proportions, logo, label, variant. Never mutate it.

Your job: produce ONE JSON object (matching the required schema exactly) with:
- finalPrompt: the complete prompt to send to the image generation model, combining the operator's intent with the hook, style, camera setting and global rules per the priority logic.
- negativePrompt: things to avoid in the generated image (empty string if nothing specific applies).
- promptSummary: a short human-readable summary of what you built and why.
- appliedRules: the ids/names of the hook, style, camera setting and global rules you actually applied.
- riskNotes: anything ambiguous, conflicting, or risky you noticed while building the prompt (empty array if none).

Respond with the JSON object only.`;

function contractUserText(contract: Contract): string {
  return `Contract:\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\``;
}

// --- request building ----------------------------------------------------------

export interface PromptBuilderRequestBody {
  model: string;
  messages: { role: "system" | "user" | "assistant"; content: string | WirePart[] }[];
  temperature: number;
  max_tokens: number;
  top_p: number;
  stream: false;
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };
}

/** Fed back into the builder for its one allowed rebuild (PRD section 11 / issue #5):
 *  the Prompt reviewer's verdict on the first attempt, plus the attempt it rejected. */
export interface PromptBuilderRevisionContext {
  previousOutput: PromptBuilderOutput;
  reviewerIssues: string[];
  revisionInstruction: string;
}

/** Builds the exact OpenRouter chat-completions body for the builder stage. The
 *  packshot (if any) is attached as an image_url part so a vision model can look
 *  at it directly — there's no asset-analysis stage yet (a later slice) to turn it
 *  into text first. When `revision` is set (the Prompt reviewer sent this Contract's
 *  first attempt back with `revise`), the previous output and the reviewer's issues +
 *  revision instruction are appended as extra turns so the model revises rather than
 *  building from scratch — this is the run's one allowed rebuild, never a third call. */
export function buildPromptBuilderRequestBody(
  contract: Contract,
  model: string,
  revision?: PromptBuilderRevisionContext,
): PromptBuilderRequestBody {
  const packshot = contract.assets.find((a) => a.role === "packshot");
  const text = contractUserText(contract);
  const userContent: string | WirePart[] = packshot
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: packshot.url } },
      ]
    : text;

  const messages: PromptBuilderRequestBody["messages"] = [
    { role: "system", content: PROMPT_BUILDER_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
  if (revision) {
    messages.push({ role: "assistant", content: JSON.stringify(revision.previousOutput) });
    messages.push({
      role: "user",
      content:
        `The Prompt reviewer rejected this output. Issues: ${revision.reviewerIssues.join("; ") || "(none listed)"}. ` +
        `Revision instruction: ${revision.revisionInstruction || "(none given — use the issues above)"}. ` +
        `Produce a corrected JSON object (matching the same schema) that fixes these issues while still ` +
        `respecting the Contract above. This is the only rebuild allowed — make it count.`,
    });
  }

  return {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 2000,
    top_p: 1,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: { name: "prompt_builder_output", strict: true, schema: PROMPT_BUILDER_OUTPUT_SCHEMA },
    },
  };
}

// --- output validation (doubles as the runtime gate for PROMPT_BUILDER_OUTPUT_SCHEMA) --

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Validates a parsed builder response against the schema above. Empty array = valid. */
export function validatePromptBuilderOutput(value: unknown): string[] {
  if (!isPlainObject(value)) return ["output must be a JSON object"];
  const errors: string[] = [];
  if (!isNonEmptyString(value.finalPrompt)) errors.push("finalPrompt must be a non-empty string");
  if (typeof value.negativePrompt !== "string") errors.push("negativePrompt must be a string");
  if (!isNonEmptyString(value.promptSummary)) errors.push("promptSummary must be a non-empty string");
  if (!isStringArray(value.appliedRules)) errors.push("appliedRules must be an array of strings");
  if (!isStringArray(value.riskNotes)) errors.push("riskNotes must be an array of strings");
  return errors;
}

/** Parses + validates the builder's raw message content in one step. `output` is
 *  null whenever `errors` is non-empty — callers should never trust a non-empty
 *  `output` alongside errors. */
export function parsePromptBuilderContent(content: string): { output: PromptBuilderOutput | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { output: null, errors: [`response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const errors = validatePromptBuilderOutput(parsed);
  if (errors.length) return { output: null, errors };
  return { output: parsed as PromptBuilderOutput, errors: [] };
}

// --- attempt record (persisted shape) --------------------------------------------

/** One builder call's full record — request/response/parsed-output — as persisted on
 *  the run (see lib/maszynka/store.ts `promptBuilderAttempts`). Attempt 1 always runs;
 *  attempt 2 only happens when the Prompt reviewer sent attempt 1 back with `revise`
 *  (see promptReviewer.ts / issue #5). `output` is null and `errors` is set when the
 *  call itself failed (network error / invalid JSON / schema violation). */
export interface PromptBuilderAttemptRecord {
  attempt: 1 | 2;
  request: unknown;
  response: unknown;
  output: PromptBuilderOutput | null;
  errors?: string[];
}

// --- network call (impure) ------------------------------------------------------

/** POSTs the builder request through our /api/chat BYOK proxy (non-streaming) and
 *  returns both the raw OpenRouter response (for run persistence/debug) and the
 *  assistant message content (for parsePromptBuilderContent). Throws on a
 *  non-OK response or a response with no message content — callers treat both as
 *  the builder stage failing (see MaszynkaView's prompt_builder_output_validation_failed
 *  path). */
export async function callPromptBuilder(
  apiKey: string,
  body: PromptBuilderRequestBody,
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
      `Prompt builder request failed (${res.status})`;
    throw new Error(message);
  }

  const content = (raw as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Prompt builder response had no message content");
  }
  return { raw, content };
}
