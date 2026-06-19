// Curated OpenRouter chat-model catalog. Mirrors the spirit of lib/models.ts:
// a small, typed, static list so the picker isn't OpenRouter's full catalog of
// hundreds of slugs. `id` is the OpenRouter model slug used verbatim in the API
// request. Tunable — extend/trim freely.
//
// Selection rule: per provider, for each quality tier, the newest model plus up to
// four versions back. General-purpose chat models only — specialized variants
// (codex, audio, search, image, -fast, o-series, Gemma, preview builds, dated
// snapshots) are omitted. Slugs verified against the live OpenRouter catalog.
//
// `group` is the picker category: Claude by tier (Opus/Sonnet/Haiku), GPT by
// version (each version bundling base/pro/mini/nano), Gemini by tier. The picker
// renders one optgroup per group in array order.
//
// `reasoning: true` marks models that accept OpenRouter's `reasoning` parameter
// (verified via the catalog's supported_parameters). Only the two legacy Haikus
// lack it.
//
// `structuredOutput: true` marks models that support `response_format` +
// `structured_outputs` (verified via the catalog's supported_parameters). Tracked
// as a separate flag from `reasoning` even though, in this catalog, the same two
// legacy Haikus are the only ones lacking it — the two capabilities are unrelated.

export interface ChatModelDef {
  /** OpenRouter model slug (sent verbatim as `model`). */
  id: string;
  /** Short display label for the picker. */
  label: string;
  /** Picker category (tier for Claude/Gemini, version for GPT). */
  group: string;
  /** One-line description. */
  blurb: string;
  /** Approximate context window (tokens), for a hint in the UI. */
  contextLength?: number;
  /** Whether the model supports the OpenRouter `reasoning` parameter. */
  reasoning?: boolean;
  /** Whether the model supports `response_format` / structured outputs. */
  structuredOutput?: boolean;
}

// Claude — grouped by tier.
const C_OPUS = "Claude Opus";
const C_SONNET = "Claude Sonnet";
const C_HAIKU = "Claude Haiku";
// GPT — grouped by version (each bundles base / pro / mini / nano).
const GPT_55 = "GPT-5.5";
const GPT_54 = "GPT-5.4";
const GPT_52 = "GPT-5.2";
const GPT_51 = "GPT-5.1";
const GPT_5 = "GPT-5";
// Gemini — grouped by tier.
const G_PRO = "Gemini Pro";
const G_FLASH = "Gemini Flash";
const G_FLASH_LITE = "Gemini Flash-Lite";

export const CHAT_MODELS: ChatModelDef[] = [
  // === Claude Opus — most capable tier (newest + 4 back) ====================
  {
    id: "anthropic/claude-opus-4.8",
    label: "Claude Opus 4.8",
    group: C_OPUS,
    blurb: "Anthropic's most capable tier — deepest reasoning.",
    contextLength: 1_000_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "anthropic/claude-opus-4.7",
    label: "Claude Opus 4.7",
    group: C_OPUS,
    blurb: "Previous flagship Opus.",
    contextLength: 1_000_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "anthropic/claude-opus-4.6",
    label: "Claude Opus 4.6",
    group: C_OPUS,
    blurb: "Earlier Opus generation.",
    contextLength: 1_000_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "anthropic/claude-opus-4.5",
    label: "Claude Opus 4.5",
    group: C_OPUS,
    blurb: "Earlier Opus generation.",
    contextLength: 200_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "anthropic/claude-opus-4.1",
    label: "Claude Opus 4.1",
    group: C_OPUS,
    blurb: "Earlier Opus generation.",
    contextLength: 200_000,
    reasoning: true,
    structuredOutput: true,
  },

  // === Claude Sonnet — balanced tier ========================================
  {
    id: "anthropic/claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    group: C_SONNET,
    blurb: "Balanced Claude — strong general default.",
    contextLength: 1_000_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "anthropic/claude-sonnet-4.5",
    label: "Claude Sonnet 4.5",
    group: C_SONNET,
    blurb: "Previous balanced Sonnet.",
    contextLength: 1_000_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet 4",
    group: C_SONNET,
    blurb: "Earlier Sonnet generation.",
    contextLength: 1_000_000,
    reasoning: true,
    structuredOutput: true,
  },

  // === Claude Haiku — fast, low-cost tier ===================================
  {
    id: "anthropic/claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    group: C_HAIKU,
    blurb: "Fast, low-cost Claude — good for quick turns.",
    contextLength: 200_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "anthropic/claude-3.5-haiku",
    label: "Claude 3.5 Haiku",
    group: C_HAIKU,
    blurb: "Previous fast Haiku.",
    contextLength: 200_000,
  },
  {
    id: "anthropic/claude-3-haiku",
    label: "Claude 3 Haiku",
    group: C_HAIKU,
    blurb: "Earlier fast Haiku.",
    contextLength: 200_000,
  },

  // === GPT-5.5 ==============================================================
  {
    id: "openai/gpt-5.5",
    label: "GPT-5.5",
    group: GPT_55,
    blurb: "OpenAI flagship — broad knowledge and coding.",
    contextLength: 1_050_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "openai/gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    group: GPT_55,
    blurb: "OpenAI's highest-effort reasoning tier.",
    contextLength: 1_050_000,
    reasoning: true,
    structuredOutput: true,
  },

  // === GPT-5.4 ==============================================================
  {
    id: "openai/gpt-5.4",
    label: "GPT-5.4",
    group: GPT_54,
    blurb: "Previous GPT flagship.",
    contextLength: 1_050_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "openai/gpt-5.4-pro",
    label: "GPT-5.4 Pro",
    group: GPT_54,
    blurb: "Previous Pro reasoning tier.",
    contextLength: 1_050_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "openai/gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    group: GPT_54,
    blurb: "Smaller, faster, cheaper GPT.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "openai/gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    group: GPT_54,
    blurb: "Smallest, cheapest GPT — quick tasks.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },

  // === GPT-5.2 ==============================================================
  {
    id: "openai/gpt-5.2",
    label: "GPT-5.2",
    group: GPT_52,
    blurb: "Earlier GPT-5 generation.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "openai/gpt-5.2-pro",
    label: "GPT-5.2 Pro",
    group: GPT_52,
    blurb: "Earlier Pro reasoning tier.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },

  // === GPT-5.1 ==============================================================
  {
    id: "openai/gpt-5.1",
    label: "GPT-5.1",
    group: GPT_51,
    blurb: "Earlier GPT-5 generation.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },

  // === GPT-5 ================================================================
  {
    id: "openai/gpt-5",
    label: "GPT-5",
    group: GPT_5,
    blurb: "First GPT-5 release.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "openai/gpt-5-pro",
    label: "GPT-5 Pro",
    group: GPT_5,
    blurb: "First GPT-5 Pro tier.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "openai/gpt-5-mini",
    label: "GPT-5 Mini",
    group: GPT_5,
    blurb: "Earlier small GPT tier.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "openai/gpt-5-nano",
    label: "GPT-5 Nano",
    group: GPT_5,
    blurb: "Earlier nano GPT tier.",
    contextLength: 400_000,
    reasoning: true,
    structuredOutput: true,
  },

  // === Gemini Pro — most capable tier =======================================
  {
    id: "google/gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    group: G_PRO,
    blurb: "Google's flagship Gemini Pro.",
    contextLength: 1_048_576,
    reasoning: true,
    structuredOutput: true,
  },

  // === Gemini Flash — fast, efficient tier ==================================
  {
    id: "google/gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    group: G_FLASH,
    blurb: "Fast, efficient Gemini.",
    contextLength: 1_048_576,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "google/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    group: G_FLASH,
    blurb: "Earlier fast Gemini Flash.",
    contextLength: 1_048_576,
    reasoning: true,
    structuredOutput: true,
  },

  // === Gemini Flash-Lite — lightest, cheapest tier ==========================
  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    group: G_FLASH_LITE,
    blurb: "Lightest, cheapest Gemini.",
    contextLength: 1_048_576,
    reasoning: true,
    structuredOutput: true,
  },
  {
    id: "google/gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash Lite",
    group: G_FLASH_LITE,
    blurb: "Earlier light Gemini.",
    contextLength: 1_048_576,
    reasoning: true,
    structuredOutput: true,
  },
];

export const CHAT_MODEL_BY_ID: Record<string, ChatModelDef> = Object.fromEntries(
  CHAT_MODELS.map((m) => [m.id, m]),
);
export const CHAT_MODEL_GROUPS: string[] = [...new Set(CHAT_MODELS.map((m) => m.group))];

/** Whether a model accepts the OpenRouter `reasoning` parameter. */
export const modelSupportsReasoning = (id: string): boolean => Boolean(CHAT_MODEL_BY_ID[id]?.reasoning);

/** Whether a model supports `response_format` / structured outputs. */
export const modelSupportsStructuredOutput = (id: string): boolean =>
  Boolean(CHAT_MODEL_BY_ID[id]?.structuredOutput);

/** Default model a new conversation starts on. */
export const DEFAULT_CHAT_MODEL = "anthropic/claude-sonnet-4.6";

/**
 * Cheap model used for the one-shot auto-title request after the first exchange.
 * Kept separate from the conversation model so titling never costs flagship rates.
 */
export const AUTO_TITLE_MODEL = "anthropic/claude-haiku-4.5";

export const chatModelLabel = (id: string): string => CHAT_MODEL_BY_ID[id]?.label ?? id;
