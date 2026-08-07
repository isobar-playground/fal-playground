// Planner stage request building + network call (PRD 0003 "Planner", issue #25).
// One non-streaming OpenRouter request through the same /api/chat BYOK proxy the
// Chat tab and the Maszynka LLM stages use. The operator pastes the full system
// prompt and the input JSON — the app never authors scene-splitting, layout,
// global-rules or priority-logic content, it only assembles the pasted pieces
// into messages. `response_format: {type: "json_object"}` and `reasoning.effort`
// are ALWAYS sent; max_tokens / temperature / top_p only when filled in
// (0/empty = omit — PRD: models without those parameters must not error).

export type PlannerReasoningEffort = "low" | "medium" | "high";

/** Operator-editable planner configuration, persisted verbatim on the Video run.
 *  The three numeric knobs are strings ("" = omit), matching the catalog-settings
 *  idiom elsewhere in the repo (lib/models.ts ModelSettings). */
export interface PlannerConfig {
  model: string;
  reasoningEffort: PlannerReasoningEffort;
  maxTokens: string;
  temperature: string;
  topP: string;
  systemPrompt: string;
  inputJson: string;
}

export const DEFAULT_PLANNER_MODEL = "openai/gpt-5.6-luna";

export const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  model: DEFAULT_PLANNER_MODEL,
  reasoningEffort: "medium",
  maxTokens: "",
  temperature: "",
  topP: "",
  systemPrompt: "",
  inputJson: "",
};

/** A multimodal user-content part on the OpenRouter wire (text or image). */
export type PlannerWirePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface PlannerRequestBody {
  model: string;
  messages: { role: "system" | "user"; content: string | PlannerWirePart[] }[];
  stream: false;
  response_format: { type: "json_object" };
  reasoning: { effort: PlannerReasoningEffort };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
}

/** "" / non-numeric / 0 all mean "omit" (PRD: 0/empty = omit). */
function filledNumber(raw: string): number | undefined {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) && n !== 0 ? n : undefined;
}

/** Builds the exact OpenRouter chat-completions body for the Planner. The common
 *  fields (global rules / priority logic) ride along as their own system messages,
 *  pasted verbatim and only when non-empty — the app adds no framing text around
 *  them. `referenceUrls` (issue #26) become image parts alongside the input JSON
 *  so the planner sees the actual reference pixels, not just URLs in text. */
export function buildPlannerRequestBody(
  config: PlannerConfig,
  common: { globalRules: string; priorityLogic: string },
  referenceUrls: string[] = [],
): PlannerRequestBody {
  const systemMessages = [config.systemPrompt, common.globalRules, common.priorityLogic]
    .filter((text) => text.trim() !== "")
    .map((text) => ({ role: "system" as const, content: text }));

  const userContent: string | PlannerWirePart[] = referenceUrls.length
    ? [
        { type: "text", text: config.inputJson },
        ...referenceUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ]
    : config.inputJson;

  const body: PlannerRequestBody = {
    model: config.model,
    messages: [...systemMessages, { role: "user", content: userContent }],
    stream: false,
    response_format: { type: "json_object" },
    reasoning: { effort: config.reasoningEffort },
  };
  const maxTokens = filledNumber(config.maxTokens);
  if (maxTokens !== undefined) body.max_tokens = maxTokens;
  const temperature = filledNumber(config.temperature);
  if (temperature !== undefined) body.temperature = temperature;
  const topP = filledNumber(config.topP);
  if (topP !== undefined) body.top_p = topP;
  return body;
}

/** POSTs the planner request through our /api/chat BYOK proxy (non-streaming) and
 *  returns both the raw OpenRouter response (for run persistence/debug) and the
 *  assistant message content (for parsePlannerContent). Throws on a non-OK response
 *  or a response with no message content. */
export async function callPlanner(
  orKey: string,
  body: PlannerRequestBody,
): Promise<{ raw: unknown; content: string }> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-openrouter-key": orKey },
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
      `Planner request failed (${res.status})`;
    throw new Error(message);
  }

  const content = (raw as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Planner response had no message content");
  }
  return { raw, content };
}
