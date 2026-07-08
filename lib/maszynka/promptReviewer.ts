// Prompt reviewer LLM stage (PRD section 11 / dump/Maszynka v2.0.md "Prompt reviewer";
// term defined in CONTEXT.md). Gates the Prompt builder's output before FAL generation:
// returns pass / revise / failed with issues + a revision instruction, via the same
// OpenRouter /api/chat BYOK proxy + `response_format: json_schema` (strict) pattern as
// promptBuilder.ts — the schema below doubles as both the OpenRouter contract and the
// runtime validator (hand-rolled, no schema library; see promptBuilder.ts header for why).
//
// Checks per spec section 11: asset roles honored, product preservation present, style
// and camera setting used, hook matches hook config, no stale copy carried over from the
// operator's raw prompt, no content-safety violations, no fields unsupported by the
// selected model. This repo doesn't yet have asset-role uploads beyond `packshot` or a
// dedicated asset-analysis stage (asset roles / reference-copy detection is issue #6) —
// the reviewer system prompt says so explicitly and only asks it to check what it can
// actually see today (the packshot, if attached, plus the Contract and builder output)
// rather than silently pretending to gate on inputs that don't exist yet.
//
// Same layering as promptBuilder.ts: pure request/response helpers plus one impure
// network call (callPromptReviewer).
import type { WirePart } from "../chat/attachments";
import { CHAT_MODELS, CHAT_MODEL_BY_ID, DEFAULT_CHAT_MODEL, modelSupportsImages, type ChatModelDef } from "../chat/models.ts";
import type { Contract } from "./contract";
import type { PromptBuilderOutput } from "./promptBuilder";

// --- model selection ---------------------------------------------------------
// Same catalog filter as the builder stage (structured output + vision, since the
// reviewer is handed the packshot image alongside the Contract/output text so it can
// cross-check product preservation claims against what the product actually looks
// like) — see PRD "LLM stages via OpenRouter" (each stage picks its own model).
export const PROMPT_REVIEWER_MODELS: ChatModelDef[] = CHAT_MODELS.filter(
  (m) => m.structuredOutput && modelSupportsImages(m.id),
);
export const PROMPT_REVIEWER_MODEL_GROUPS: string[] = [...new Set(PROMPT_REVIEWER_MODELS.map((m) => m.group))];

export const DEFAULT_PROMPT_REVIEWER_MODEL: string =
  CHAT_MODEL_BY_ID[DEFAULT_CHAT_MODEL]?.structuredOutput && modelSupportsImages(DEFAULT_CHAT_MODEL)
    ? DEFAULT_CHAT_MODEL
    : (PROMPT_REVIEWER_MODELS[0]?.id ?? DEFAULT_CHAT_MODEL);

// --- output shape + JSON Schema -----------------------------------------------

export type PromptReviewerStatus = "pass" | "revise" | "failed";
const PROMPT_REVIEWER_STATUSES: PromptReviewerStatus[] = ["pass", "revise", "failed"];

export interface PromptReviewerOutput {
  status: PromptReviewerStatus;
  issues: string[];
  revisionInstruction: string;
}

/** Sent verbatim as `response_format.json_schema.schema` (OpenRouter strict mode:
 *  every property required, no additional properties). */
export const PROMPT_REVIEWER_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["status", "issues", "revisionInstruction"],
  properties: {
    status: {
      type: "string",
      enum: PROMPT_REVIEWER_STATUSES,
      description:
        "'pass' if the builder output clears every check below. 'revise' if it has fixable issues a rebuild " +
        "can address. 'failed' if it is fundamentally unsuitable (e.g. a content-safety violation) and should " +
        "not be retried.",
    },
    issues: {
      type: "array",
      items: { type: "string" },
      description: "Concrete problems found, one per issue. Empty array only when status is 'pass'.",
    },
    revisionInstruction: {
      type: "string",
      description:
        "A specific, actionable instruction for the Prompt builder's next attempt. Empty string when status " +
        "is not 'revise'.",
    },
  },
};

const PROMPT_REVIEWER_SYSTEM_PROMPT = `You are the Prompt reviewer stage of the Maszynka Content Factory test bench.

You receive the same Contract the Prompt builder used (operator's raw prompt, uploaded assets and their systemic roles — today only "packshot" is wired up in this test bench, a selected Hook, Style and Camera setting, global rules, an ordered priority logic, the target model's capability entry, and generation settings) and the Prompt builder's output (finalPrompt, negativePrompt, promptSummary, appliedRules, riskNotes). Your job is to gate that output before it reaches FAL generation — never rewrite it yourself.

Check, at minimum:
1. Asset roles are honored — if a packshot is attached, finalPrompt must clearly treat it as the product to feature, not a generic/background reference. (Other asset roles — style/brand/campaign reference — aren't wired up in this test bench yet; skip that part of the check when no such asset is present.)
2. Product preservation is present — if a packshot is attached, finalPrompt must explicitly preserve the product's packaging, color, proportions, logo, label, variant. Compare the packshot image (attached below, if present) against finalPrompt's description.
3. The selected Style and Camera setting are actually reflected in finalPrompt (their visual intent, lighting/framing/angle etc. — not ignored, not replaced with something unrelated).
4. If the Contract carries a Hook, its exact text must appear (or be very clearly rendered) in finalPrompt — not dropped, not paraphrased into something different.
5. finalPrompt does not carry over stale marketing copy from the operator's raw prompt that conflicts with or duplicates the Hook.
6. finalPrompt and negativePrompt do not violate content safety (no illegal content, no sexualization of minors, no hateful or otherwise disallowed material).
7. finalPrompt and negativePrompt do not rely on fields the selected model's capability entry doesn't support — e.g. a populated negativePrompt when the model's capability entry says negative prompts aren't supported.

Respond with ONE JSON object (matching the required schema exactly):
- status: "pass" if every applicable check above passes; "revise" if there are fixable issues; "failed" if the output is fundamentally unsuitable and should not be retried (e.g. a safety violation).
- issues: the concrete problems you found (empty array only when status is "pass").
- revisionInstruction: a specific, actionable instruction for the Prompt builder's next attempt (empty string unless status is "revise").

Respond with the JSON object only.`;

function reviewerUserText(contract: Contract, builderOutput: PromptBuilderOutput): string {
  return (
    `Contract:\n\`\`\`json\n${JSON.stringify(contract, null, 2)}\n\`\`\`\n\n` +
    `Prompt builder output:\n\`\`\`json\n${JSON.stringify(builderOutput, null, 2)}\n\`\`\``
  );
}

// --- request building ----------------------------------------------------------

export interface PromptReviewerRequestBody {
  model: string;
  messages: { role: "system" | "user"; content: string | WirePart[] }[];
  temperature: number;
  max_tokens: number;
  top_p: number;
  stream: false;
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };
}

/** Builds the exact OpenRouter chat-completions body for the reviewer stage. The
 *  packshot (if any) is attached as an image_url part, same as the builder stage, so a
 *  vision model can cross-check the product-preservation check against the real
 *  product photo rather than trusting the builder's prose alone. */
export function buildPromptReviewerRequestBody(
  contract: Contract,
  builderOutput: PromptBuilderOutput,
  model: string,
): PromptReviewerRequestBody {
  const packshot = contract.assets.find((a) => a.role === "packshot");
  const text = reviewerUserText(contract, builderOutput);
  const userContent: string | WirePart[] = packshot
    ? [
        { type: "text", text },
        { type: "image_url", image_url: { url: packshot.url } },
      ]
    : text;

  return {
    model,
    messages: [
      { role: "system", content: PROMPT_REVIEWER_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    temperature: 0.2,
    max_tokens: 1200,
    top_p: 1,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: { name: "prompt_reviewer_output", strict: true, schema: PROMPT_REVIEWER_OUTPUT_SCHEMA },
    },
  };
}

// --- output validation (doubles as the runtime gate for PROMPT_REVIEWER_OUTPUT_SCHEMA) --

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/** Validates a parsed reviewer response against the schema above. Empty array = valid. */
export function validatePromptReviewerOutput(value: unknown): string[] {
  if (!isPlainObject(value)) return ["output must be a JSON object"];
  const errors: string[] = [];
  if (typeof value.status !== "string" || !PROMPT_REVIEWER_STATUSES.includes(value.status as PromptReviewerStatus)) {
    errors.push(`status must be one of: ${PROMPT_REVIEWER_STATUSES.join(", ")}`);
  }
  if (!isStringArray(value.issues)) errors.push("issues must be an array of strings");
  if (typeof value.revisionInstruction !== "string") errors.push("revisionInstruction must be a string");
  return errors;
}

/** Parses + validates the reviewer's raw message content in one step. `output` is null
 *  whenever `errors` is non-empty — callers should never trust a non-empty `output`
 *  alongside errors. */
export function parsePromptReviewerContent(content: string): { output: PromptReviewerOutput | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { output: null, errors: [`response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const errors = validatePromptReviewerOutput(parsed);
  if (errors.length) return { output: null, errors };
  return { output: parsed as PromptReviewerOutput, errors: [] };
}

// --- attempt record (persisted shape) --------------------------------------------

/** One reviewer call's full record — request/response/parsed-output — as persisted on
 *  the run (see lib/maszynka/store.ts `promptReviewerAttempts`). `output` is null and
 *  `errors` is set when the call itself failed (network error / invalid JSON / schema
 *  violation) rather than returning a reviewer verdict. */
export interface PromptReviewerAttemptRecord {
  attempt: 1 | 2;
  request: unknown;
  response: unknown;
  output: PromptReviewerOutput | null;
  errors?: string[];
}

// --- network call (impure) ------------------------------------------------------

/** POSTs the reviewer request through our /api/chat BYOK proxy (non-streaming) and
 *  returns both the raw OpenRouter response (for run persistence/debug) and the
 *  assistant message content (for parsePromptReviewerContent). Throws on a non-OK
 *  response or a response with no message content — callers treat both as the reviewer
 *  stage failing outright (ends the run at `prompt_build_failed`, since there is no
 *  verdict to act on). */
export async function callPromptReviewer(
  apiKey: string,
  body: PromptReviewerRequestBody,
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
      `Prompt reviewer request failed (${res.status})`;
    throw new Error(message);
  }

  const content = (raw as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Prompt reviewer response had no message content");
  }
  return { raw, content };
}
