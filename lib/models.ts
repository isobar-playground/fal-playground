// Model catalog + price estimation for the Fal prompt playground.
//
// PROTOTYPE NOTE: prices are hardcoded from the Fal model pages (June 2026) and
// are only *estimates*. Fal is the source of truth for what you actually pay.
//   - nano-banana:  flat $0.039 / image
//   - gpt-image-1:  varies by quality x size (+ a small text-token charge we ignore)

export type ModelMode = "generate" | "edit";
export type ModelFamily = "nano-banana" | "gpt-image";

export type GptQuality = "low" | "medium" | "high";
export type GptSize = "1024x1024" | "1536x1024" | "1024x1536";

export interface ModelDef {
  key: string; // internal id used in app state
  id: string; // Fal endpoint id
  label: string;
  family: ModelFamily;
  mode: ModelMode;
  /** edit models require at least one reference image */
  needsReferences: boolean;
  blurb: string;
}

export const MODELS: ModelDef[] = [
  {
    key: "nano-banana",
    id: "fal-ai/nano-banana",
    label: "Nano Banana — generowanie",
    family: "nano-banana",
    mode: "generate",
    needsReferences: false,
    blurb: "Google Gemini Flash Image. Tworzy obraz wyłącznie z promptu tekstowego.",
  },
  {
    key: "nano-banana-edit",
    id: "fal-ai/nano-banana/edit",
    label: "Nano Banana — edycja",
    family: "nano-banana",
    mode: "edit",
    needsReferences: true,
    blurb: "Edytuje / łączy obrazy referencyjne według promptu. Wymaga referencji.",
  },
  {
    key: "gpt-image-1",
    id: "fal-ai/gpt-image-1/text-to-image",
    label: "GPT Image 1 — generowanie",
    family: "gpt-image",
    mode: "generate",
    needsReferences: false,
    blurb: "OpenAI GPT Image 1. Tworzy obraz z promptu. Wybierasz jakość i rozmiar.",
  },
  {
    key: "gpt-image-1-edit",
    id: "fal-ai/gpt-image-1/edit-image",
    label: "GPT Image 1 — edycja",
    family: "gpt-image",
    mode: "edit",
    needsReferences: true,
    blurb: "OpenAI GPT Image 1 z obrazami referencyjnymi. Wymaga referencji.",
  },
];

export const MODEL_BY_KEY: Record<string, ModelDef> = Object.fromEntries(
  MODELS.map((m) => [m.key, m]),
);

/** Per-model knobs the user can tweak. */
export interface ModelSettings {
  numImages: number;
  gptQuality: GptQuality;
  gptSize: GptSize;
}

export const DEFAULT_SETTINGS: ModelSettings = {
  numImages: 1,
  gptQuality: "medium",
  gptSize: "1024x1024",
};

// gpt-image-1 price per output image, by quality and size (USD).
const GPT_PRICE: Record<GptSize, Record<GptQuality, number>> = {
  "1024x1024": { low: 0.011, medium: 0.042, high: 0.167 },
  "1536x1024": { low: 0.016, medium: 0.063, high: 0.25 },
  "1024x1536": { low: 0.016, medium: 0.063, high: 0.25 },
};

/** Estimated USD cost for one model given its settings. */
export function estimateModelCost(model: ModelDef, s: ModelSettings): number {
  const n = Math.max(1, s.numImages);
  if (model.family === "nano-banana") return 0.039 * n;
  return GPT_PRICE[s.gptSize][s.gptQuality] * n;
}

export const SIZE_LABELS: Record<GptSize, string> = {
  "1024x1024": "Kwadrat 1024×1024",
  "1536x1024": "Poziom 1536×1024",
  "1024x1536": "Pion 1024×1536",
};

export const QUALITY_LABELS: Record<GptQuality, string> = {
  low: "Niska",
  medium: "Średnia",
  high: "Wysoka",
};
