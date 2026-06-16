"use client";

// Video run path via `fal.subscribe`. Separate from the image runner (lib/fal.ts)
// by design, but reuses `configureFal` / `uploadReference` from there (the key
// config + storage upload are identical for video). Video jobs are long-running,
// so we stream queue status (position) + logs back through `onStatus` for the UI.

import { fal } from "@fal-ai/client";
import { buildVideoInput, type VideoModelDef, type VideoSettings } from "./models";
import type { ResultVideo } from "../types";

export { configureFal, uploadReference } from "../fal";

/** Coarse live status surfaced to the result card while a job runs. */
export interface VideoRunStatus {
  phase: "queued" | "running";
  queuePosition?: number;
  log?: string;
}

export async function runVideoModel(
  model: VideoModelDef,
  prompt: string,
  frames: { startUrl?: string; endUrl?: string },
  settings: VideoSettings,
  onStatus?: (s: VideoRunStatus) => void,
): Promise<ResultVideo> {
  const result = await fal.subscribe(model.id, {
    input: buildVideoInput(model, prompt, frames, settings),
    logs: true,
    onQueueUpdate(update) {
      if (update.status === "IN_QUEUE") {
        onStatus?.({ phase: "queued", queuePosition: update.queue_position });
      } else if (update.status === "IN_PROGRESS") {
        const last = (update.logs ?? []).filter((l) => l?.message).pop();
        onStatus?.({ phase: "running", log: last?.message });
      }
    },
  });

  // Fal video endpoints return a single `video` object; some also echo dimensions.
  const data = result.data as {
    video?: { url?: string; width?: number; height?: number };
    seed?: number;
  };
  const video = data.video;
  if (!video?.url) throw new Error("Fal returned no video URL.");
  return {
    url: video.url,
    width: typeof video.width === "number" ? video.width : undefined,
    height: typeof video.height === "number" ? video.height : undefined,
  };
}
