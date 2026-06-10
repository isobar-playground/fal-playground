"use client";

import { fal } from "@fal-ai/client";
import { buildInput, type ModelDef, type ModelSettings } from "./models";
import type { ResultImage } from "./types";

let configuredKey: string | null = null;

export function configureFal(key: string) {
  if (key === configuredKey) return;
  fal.config({ credentials: key });
  configuredKey = key;
}

export async function uploadReference(file: File): Promise<string> {
  return fal.storage.upload(file);
}

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
  return (data.images ?? []).map((img) => ({ url: img.url, width: img.width, height: img.height }));
}
