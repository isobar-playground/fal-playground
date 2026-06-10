"use client";

import { fal } from "@fal-ai/client";
import type { ModelDef, ModelSettings } from "./models";
import type { ResultImage } from "./types";

let configuredKey: string | null = null;

/** Point the Fal client at the user's key (kept in their browser only). */
export function configureFal(key: string) {
  if (key === configuredKey) return;
  fal.config({ credentials: key });
  configuredKey = key;
}

/** Upload a local file to Fal storage and return its temporary URL. */
export async function uploadReference(file: File): Promise<string> {
  return fal.storage.upload(file);
}

function buildInput(
  model: ModelDef,
  prompt: string,
  imageUrls: string[],
  s: ModelSettings,
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt,
    num_images: Math.max(1, s.numImages),
  };
  if (model.family === "gpt-image") {
    input.image_size = s.gptSize;
    input.quality = s.gptQuality;
  }
  if (model.mode === "edit") {
    input.image_urls = imageUrls;
  }
  return input;
}

/** Run a single model and normalise its output to ResultImage[]. */
export async function runModel(
  model: ModelDef,
  prompt: string,
  imageUrls: string[],
  settings: ModelSettings,
  onLog?: (line: string) => void,
): Promise<ResultImage[]> {
  const result = await fal.subscribe(model.id, {
    input: buildInput(model, prompt, imageUrls, settings),
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_PROGRESS") {
        for (const log of update.logs ?? []) {
          if (log?.message) onLog?.(log.message);
        }
      }
    },
  });

  const data = result.data as { images?: Array<{ url: string; width?: number; height?: number }> };
  return (data.images ?? []).map((img) => ({
    url: img.url,
    width: img.width,
    height: img.height,
  }));
}
