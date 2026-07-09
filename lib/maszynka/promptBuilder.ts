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
// Explicit extension: a real runtime import (see contentSafety.ts's comment / this
// module's promptBuilder.check.ts).
import { resolvePromptBuilderRevisionInstruction, resolvePromptBuilderSystemPrompt } from "./stagePromptResolver.ts";

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

// Hardcoded fallback (issue #19 / PRD story 33): used whenever a Contract's
// `stagePrompts` snapshot has no `promptBuilder.systemPrompt` (or, defensively, none at
// all) — see stagePromptResolver.ts. Same text as the `stage_prompts` seed content
// (configSeeds.ts's `STAGE_PROMPTS_SEED.promptBuilder.systemPrompt`).
const PROMPT_BUILDER_SYSTEM_PROMPT = `You are the Prompt builder stage of the Maszynka Content Factory test bench.

You receive a single JSON "Contract" object describing one test run: the operator's raw prompt, a "safetyConstraints" array (operator-facing constraints from the Content safety pre-check stage that ran before this Contract was even assembled — see below), any uploaded assets (asset "role" is systemic — packshot/style_reference/brand_reference/campaign_reference — never inferred from prose) each carrying an "analysis" object (the Asset analysis stage's structured description: "description", "attributes" as role-specific key/value facts, and "preserveElements" — packaging/color/proportions/logo/label/variant to preserve, populated only for the packshot), a selected Hook (short attention-grabbing marketing text to render on the asset), a selected Style preset, a selected Camera setting preset, a set of global rules that always apply, an ordered Priority logic (most important first: content safety > product/brand preservation > packshot analysis > hook > style > camera setting > operator prompt — on conflict, the higher layer wins), the target model's capabilities, and generation settings (target language, aspect ratio, variant count).

"safetyConstraints" is rank 1 in the priority logic — higher than product/brand preservation, higher than the hook, higher than everything else. If it is non-empty, finalPrompt MUST honor every listed constraint exactly (e.g. "no visible alcohol branding" means finalPrompt must not describe or imply alcohol branding, even if the operator's raw prompt or a reference asset suggests otherwise); treat these as hard requirements, never as optional style guidance. An empty array means no extra constraints apply beyond the global content-safety rule already baked into the priority logic.

Use each asset strictly within its role and its "analysis" output: the packshot (its "preserveElements" list is non-negotiable — packaging, color, proportions, logo, label, variant MUST be preserved exactly, never mutated) is the product to feature; a style_reference informs only look/mood/lighting/palette; a brand_reference informs only brand elements/palette/layout feel; a campaign_reference informs only the series' rhythm/consistency — never treat a reference asset as a preservation target, and never copy old marketing text from a campaign_reference verbatim. If a packshot image is attached to this message directly (in addition to its analysis text), cross-check it visually against "preserveElements".

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

// Hardcoded fallback (issue #19 / PRD story 33): used whenever a Contract's
// `stagePrompts` snapshot has no `promptBuilder.revisionInstructionTemplate` (or,
// defensively, none at all) — see stagePromptResolver.ts. `{{issues}}`/
// `{{revisionInstruction}}` are substituted with the Prompt reviewer's actual issues/
// instruction for this attempt (PRD story 25). Same text as the `stage_prompts` seed
// content (configSeeds.ts's `STAGE_PROMPTS_SEED.promptBuilder.revisionInstructionTemplate`).
const PROMPT_BUILDER_REVISION_INSTRUCTION_TEMPLATE =
  "The Prompt reviewer rejected this output. Issues: {{issues}}. " +
  "Revision instruction: {{revisionInstruction}}. " +
  "Produce a corrected JSON object (matching the same schema) that fixes these issues while still " +
  "respecting the Contract above. This is the only rebuild allowed — make it count.";

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
 *  packshot (if any) is attached as an image_url part *in addition to* its Asset
 *  analysis text (which rides along inside the serialized Contract below — see issue
 *  #6 / assetAnalysis.ts) so a vision model can also look at the actual product
 *  directly for exact preservation; reference assets rely on their analysis text alone
 *  (no extra image parts) since their role only needs a scoped description, not pixel-
 *  level preservation. When `revision` is set (the Prompt reviewer sent this Contract's
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

  const stagePromptsConfig = contract.stagePrompts?.snapshot;
  const messages: PromptBuilderRequestBody["messages"] = [
    { role: "system", content: resolvePromptBuilderSystemPrompt(stagePromptsConfig, PROMPT_BUILDER_SYSTEM_PROMPT) },
    { role: "user", content: userContent },
  ];
  if (revision) {
    messages.push({ role: "assistant", content: JSON.stringify(revision.previousOutput) });
    messages.push({
      role: "user",
      content: resolvePromptBuilderRevisionInstruction(stagePromptsConfig, PROMPT_BUILDER_REVISION_INSTRUCTION_TEMPLATE, {
        issues: revision.reviewerIssues,
        revisionInstruction: revision.revisionInstruction,
      }),
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
