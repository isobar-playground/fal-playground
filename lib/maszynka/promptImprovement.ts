// Prompt improvement LLM stage (PRD section 12 / dump/Maszynka v2.0.md section 8 "Prompt
// improvement"; issue #8). Unlike every other LLM stage in this pipeline (content
// safety, asset analysis, prompt builder, prompt reviewer — all automatic, run as part
// of the orchestrated pipeline in MaszynkaView's handleRun), this one is UI-driven and
// operator-triggered: the operator clicks "Improve prompt" *before* a Run even exists,
// reviews the proposal side-by-side with the raw prompt, and explicitly accepts or
// discards it. There is no dedicated run status for this stage (see status.ts) — it
// never touches Neon by itself; only the outcome (whether it was used, whether it was
// accepted, and the accepted text) is recorded on the run at creation time, alongside
// `userPromptRaw` (see store.ts's `promptImprovementUsed`/`promptImprovementAccepted`/
// `userPromptImproved` and the Run tracking table in the spec).
//
// Same OpenRouter /api/chat BYOK proxy + `response_format: json_schema` (strict)
// pattern as every other stage module — the schema below doubles as both the
// OpenRouter contract and the runtime validator (hand-rolled, no schema library; see
// promptBuilder.ts header for why). No image parts — this stage only ever rewrites the
// raw prompt text, per spec section 8 ("model poprawi jego prompt"); it does not need
// vision, unlike the other four stages.
//
// Same layering as the other stage modules: pure request/response helpers plus one
// impure network call (callPromptImprovement).
import { CHAT_MODELS, CHAT_MODEL_BY_ID, DEFAULT_CHAT_MODEL, type ChatModelDef } from "../chat/models.ts";
import type { StagePromptsConfig } from "./configSchemas";
// Explicit extension: a real runtime import (see contentSafety.ts's comment / this
// module's promptImprovement.check.ts).
import { resolvePromptImprovementSystemPrompt } from "./stagePromptResolver.ts";

// --- model selection ---------------------------------------------------------
// Structured output is mandatory (the schema gate below); vision is NOT required —
// this stage only ever reads/rewrites text, so the catalog is broader than the four
// vision stages (PRD "LLM stages via OpenRouter": each stage picks its own model).
export const PROMPT_IMPROVEMENT_MODELS: ChatModelDef[] = CHAT_MODELS.filter((m) => m.structuredOutput);
export const PROMPT_IMPROVEMENT_MODEL_GROUPS: string[] = [...new Set(PROMPT_IMPROVEMENT_MODELS.map((m) => m.group))];

export const DEFAULT_PROMPT_IMPROVEMENT_MODEL: string =
  CHAT_MODEL_BY_ID[DEFAULT_CHAT_MODEL]?.structuredOutput
    ? DEFAULT_CHAT_MODEL
    : (PROMPT_IMPROVEMENT_MODELS[0]?.id ?? DEFAULT_CHAT_MODEL);

// --- output shape + JSON Schema -----------------------------------------------

export interface PromptImprovementOutput {
  /** The rewritten prompt — shown side-by-side with the raw prompt for the operator to
   *  accept or discard (spec section 8). Never used until the operator explicitly
   *  accepts it. */
  userPromptImproved: string;
  /** A short, human-readable note on what changed and why — helps the operator judge
   *  the proposal without re-deriving the diff themselves. Empty string if there's
   *  nothing worth calling out. */
  rationale: string;
}

/** Sent verbatim as `response_format.json_schema.schema` (OpenRouter strict mode:
 *  every property required, no additional properties). */
export const PROMPT_IMPROVEMENT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["userPromptImproved", "rationale"],
  properties: {
    userPromptImproved: {
      type: "string",
      description: "The rewritten, improved version of the operator's raw creative prompt.",
    },
    rationale: {
      type: "string",
      description: "A short note on what changed and why. Empty string if nothing is worth calling out.",
    },
  },
};

// Hardcoded fallback (issue #19 / PRD story 33): used whenever a run has no
// `stage_prompts` config yet, or the operator left `promptImprovement.systemPrompt`
// blank — see stagePromptResolver.ts. Same text as the `stage_prompts` seed content
// (configSeeds.ts's `STAGE_PROMPTS_SEED.promptImprovement.systemPrompt`).
const PROMPT_IMPROVEMENT_SYSTEM_PROMPT = `You are the Prompt improvement stage of the Maszynka Content Factory test bench.

The operator has typed a raw creative prompt describing what they want an AI image-generation pipeline to produce. Your job is to propose a clearer, more specific, better-structured rewrite of that prompt — sharpen vague language, make implicit intent explicit, fix ambiguity or contradictions — WITHOUT inventing new creative direction the operator didn't imply, and without discarding their intent. This is a proposal only: the operator will explicitly accept or discard it before it is ever used.

Respond with ONE JSON object (matching the required schema exactly):
- userPromptImproved: the rewritten prompt.
- rationale: a short note on what changed and why (empty string if there's nothing worth calling out).

Respond with the JSON object only.`;

// --- request building ----------------------------------------------------------

export interface PromptImprovementRequestBody {
  model: string;
  messages: { role: "system" | "user"; content: string }[];
  temperature: number;
  max_tokens: number;
  top_p: number;
  stream: false;
  response_format: { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };
}

/** Builds the exact OpenRouter chat-completions body for the prompt improvement stage.
 *  Text-only — see module header for why no image parts are attached. `stagePrompts` is
 *  the run's resolved `stage_prompts` config snapshot (issue #19) — omit it (or pass
 *  null/undefined) to fall back to the hardcoded default, same behavior as before this
 *  stage was configurable. */
export function buildPromptImprovementRequestBody(
  userPromptRaw: string,
  model: string,
  stagePrompts?: StagePromptsConfig | null,
): PromptImprovementRequestBody {
  return {
    model,
    messages: [
      { role: "system", content: resolvePromptImprovementSystemPrompt(stagePrompts, PROMPT_IMPROVEMENT_SYSTEM_PROMPT) },
      { role: "user", content: `Raw prompt:\n${userPromptRaw}` },
    ],
    temperature: 0.3,
    max_tokens: 800,
    top_p: 1,
    stream: false,
    response_format: {
      type: "json_schema",
      json_schema: { name: "prompt_improvement_output", strict: true, schema: PROMPT_IMPROVEMENT_OUTPUT_SCHEMA },
    },
  };
}

// --- output validation (doubles as the runtime gate for PROMPT_IMPROVEMENT_OUTPUT_SCHEMA) --

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Validates a parsed prompt-improvement response against the schema above. Empty
 *  array = valid. */
export function validatePromptImprovementOutput(value: unknown): string[] {
  if (!isPlainObject(value)) return ["output must be a JSON object"];
  const errors: string[] = [];
  if (!isNonEmptyString(value.userPromptImproved)) errors.push("userPromptImproved must be a non-empty string");
  if (typeof value.rationale !== "string") errors.push("rationale must be a string");
  return errors;
}

/** Parses + validates the model's raw message content in one step. `output` is null
 *  whenever `errors` is non-empty — callers should never trust a non-empty `output`
 *  alongside errors. */
export function parsePromptImprovementContent(content: string): { output: PromptImprovementOutput | null; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return { output: null, errors: [`response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const errors = validatePromptImprovementOutput(parsed);
  if (errors.length) return { output: null, errors };
  return { output: parsed as PromptImprovementOutput, errors: [] };
}

// --- accept/discard resolution (pure, testable outside React) --------------------

/** The subset of MaszynkaView's client-side `ImprovementState` this needs — kept as a
 *  separate, narrower type here so this module doesn't depend on the component file. */
export interface ImprovementResolutionInput {
  status: "idle" | "loading" | "proposed" | "discarded" | "error";
  /** The exact raw prompt the proposal (or discard/error) was generated from. */
  sourcePromptRaw?: string;
  proposal?: { userPromptImproved: string };
  accepted?: boolean;
  error?: string;
}

export interface ImprovementResolution {
  promptImprovementUsed: boolean;
  promptImprovementAccepted: boolean;
  userPromptImproved: string | null;
  /** What actually flows into content safety / asset analysis / the Contract from here
   *  on: the accepted improved text when accepted, the raw prompt otherwise (spec
   *  section 8/9). */
  effectivePrompt: string;
}

/** Resolves the three run-tracking fields (issue #8) plus the prompt that should
 *  actually drive the rest of the pipeline, from the operator's current raw prompt and
 *  the Prompt improvement UI state. Pure — the component (MaszynkaView) is a thin
 *  caller, same layering as assembleContract in contract.ts.
 *
 *  - `promptImprovementUsed` is true whenever the state is "live" (generated from
 *    exactly the raw prompt as it stands right now, not a stale proposal left over from
 *    text the operator has since edited) and isn't "idle" — this stays true after a
 *    Discard (the operator *did* use the feature; they just rejected the proposal).
 *    Only editing the raw prompt resets it to "idle"/unused.
 *  - `promptImprovementAccepted` is true only for a live, still-accepted proposal.
 *  - `userPromptImproved` mirrors `promptImprovementAccepted`: set only when accepted,
 *    `null` otherwise (discarded, never proposed, or stale). */
export function resolveEffectivePrompt(rawPrompt: string, improvement: ImprovementResolutionInput): ImprovementResolution {
  const trimmedRaw = rawPrompt.trim();
  const isLive = improvement.sourcePromptRaw === trimmedRaw;
  const used = isLive && improvement.status !== "idle";
  const accepted = isLive && improvement.status === "proposed" && improvement.accepted === true;
  const userPromptImproved = accepted ? improvement.proposal!.userPromptImproved.trim() : null;
  return {
    promptImprovementUsed: used,
    promptImprovementAccepted: accepted,
    userPromptImproved,
    effectivePrompt: accepted ? userPromptImproved! : trimmedRaw,
  };
}

// --- network call (impure) ------------------------------------------------------

/** POSTs the improvement request through our /api/chat BYOK proxy (non-streaming) and
 *  returns both the raw OpenRouter response (kept only for the in-memory proposal
 *  state — never persisted, see module header) and the assistant message content (for
 *  parsePromptImprovementContent). Throws on a non-OK response or a response with no
 *  message content. */
export async function callPromptImprovement(
  apiKey: string,
  body: PromptImprovementRequestBody,
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
      `Prompt improvement request failed (${res.status})`;
    throw new Error(message);
  }

  const content = (raw as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Prompt improvement response had no message content");
  }
  return { raw, content };
}
