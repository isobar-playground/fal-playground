import type { ModelSettings } from "./models";

/** A reference image, either a freshly-picked local file or an existing URL. */
export type Reference =
  | { kind: "file"; id: string; file: File; previewUrl: string }
  | { kind: "url"; id: string; url: string; origin: "generated" | "manual" };

export interface ResultImage {
  url: string;
  width?: number;
  height?: number;
}

export type RunItemStatus = "pending" | "running" | "done" | "error";

/** Per-model slice of one generation run. */
export interface RunItem {
  modelKey: string;
  modelLabel: string;
  status: RunItemStatus;
  images: ResultImage[];
  error?: string;
  estimatedCost: number;
  settings: ModelSettings;
}

/** One "Generuj" press = one run, fanned out across the selected models. */
export interface GenerationRun {
  id: string;
  createdAt: number;
  prompt: string;
  referenceUrls: string[];
  items: RunItem[];
}
