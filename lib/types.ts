import type { ModelSettings } from "./models";
import type { VideoSettings } from "./video/models";

export type Reference =
  | { kind: "file"; id: string; file: File; previewUrl: string; label?: string }
  | { kind: "url"; id: string; url: string; origin: "generated" | "manual"; label?: string };

/** Which prompt variant a run item was generated from. */
export type PromptKind = "original" | "beautified";

export interface ResultImage {
  url: string;
  width?: number;
  height?: number;
}

export type RunItemStatus = "pending" | "running" | "done" | "error";

export interface RunItem {
  id: string; // unique per item — keys runs (in "both" mode one modelKey yields two items)
  modelKey: string;
  modelLabel: string;
  prompt: string; // the prompt text actually sent for this item
  promptKind: PromptKind; // which variant produced it
  status: RunItemStatus;
  images: ResultImage[];
  error?: string;
  unitCost: number; // USD per image
  estimatedCost: number; // unitCost * requested images
  actualCost?: number; // unitCost * returned images (set when done)
  settings: ModelSettings;
  params?: Record<string, unknown>; // input params sent to Fal (prompt/image_urls stripped)
  refUrls?: string[]; // image_urls passed to edit/image-to-image models
}

export interface GenerationRun {
  id: string;
  createdAt: number;
  prompt: string;
  referenceUrls: string[];
  items: RunItem[];
}

// --- video (separate code path, parallel to the image types above) -------

/** Top-level mode the wizard is in. Persisted; default "image". */
export type AppMode = "image" | "video";

export interface ResultVideo {
  url: string;
  posterUrl?: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

export type VideoRunItemStatus = "pending" | "running" | "done" | "error";

export interface VideoRunItem {
  id: string;
  modelKey: string;
  modelLabel: string;
  prompt: string; // prompt text actually sent
  promptKind: PromptKind; // which variant produced it (shared beautifier)
  status: VideoRunItemStatus;
  video?: ResultVideo; // set when done
  error?: string;
  estimatedCost: number; // USD, from live/local price × duration
  actualCost?: number; // set when done (same estimate; Fal exposes only base price)
  settings: VideoSettings;
  params?: Record<string, unknown>; // input params sent to Fal (prompt/frame urls stripped)
  startUrl?: string; // start frame passed in (for the card)
  endUrl?: string; // optional end frame passed in
}

export interface VideoRun {
  id: string;
  createdAt: number;
  prompt: string;
  items: VideoRunItem[];
}

/** Full session snapshot for export/import (share progress with others). */
export interface SessionExport {
  app: "fal-prompt-playground";
  version: number;
  exportedAt: string;
  key: string;
  promptHistory: { text: string; ts: number }[];
  runs: GenerationRun[];
  selectedKeys: string[];
  settings: Record<string, ModelSettings>;
  references: { url: string; origin: "generated" | "manual"; label?: string }[];
  // Video additions (version 2+). Optional on read so legacy/v1 files still import.
  mode?: AppMode;
  videoRuns?: VideoRun[];
  videoSelectedKey?: string;
  videoSettings?: Record<string, VideoSettings>;
}
