"use client";

import { fal } from "@fal-ai/client";
import type { ModelDef } from "./models";
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

// Takes a pre-built `input` object (built by the caller via `buildInput`, or a
// verbatim user override). The runner no longer constructs the request itself —
// the panel, the send path, and the result record all share one source of truth.
export async function runModel(
  model: ModelDef,
  input: Record<string, unknown>,
  onLog?: (line: string) => void,
): Promise<{ images: ResultImage[]; seed?: number }> {
  const result = await fal.subscribe(model.id, {
    input,
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_PROGRESS") {
        for (const log of update.logs ?? []) {
          if (log?.message) onLog?.(log.message);
        }
      }
    },
  });

  const data = result.data as {
    images?: Array<{ url: string; width?: number; height?: number }>;
    seed?: number;
  };
  const images = (data.images ?? []).map((img) => ({ url: img.url, width: img.width, height: img.height }));
  return { images, seed: typeof data.seed === "number" ? data.seed : undefined };
}
