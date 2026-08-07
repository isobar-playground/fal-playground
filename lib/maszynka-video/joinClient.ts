"use client";

// The impure half of the Final video join (issue #30): one fal.subscribe call to
// the verified ffmpeg merge-videos endpoint with the operator's BYOK key
// (configureFal, shared with every other FAL call in the app). Split from
// joinRequest.ts so the request building stays node-checkable.
import { fal } from "@fal-ai/client";
import { FFMPEG_MERGE_VIDEOS_ENDPOINT } from "./joinRequest";

export async function runJoinClips(input: { video_urls: string[] }): Promise<{ videoUrl: string; raw: unknown }> {
  const result = await fal.subscribe(FFMPEG_MERGE_VIDEOS_ENDPOINT, { input, logs: true });
  const data = result.data as { video?: { url?: string } };
  if (!data.video?.url) throw new Error("FAL ffmpeg returned no video URL.");
  return { videoUrl: data.video.url, raw: result.data };
}
