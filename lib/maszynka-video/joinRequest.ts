// Final video join helpers (issue #30, ADR 0002): the ordered Clip list and the
// FAL ffmpeg request. Hard concatenation ONLY — full clips, global order, no
// trimming, no transitions, no re-encoding decisions; the request carries nothing
// but the clip URLs. Pure module (node-runnable for its check); the fal.subscribe
// call lives in joinClient.ts.

import type { PlannerScene } from "./plannerContract";

/** VERIFIED against https://fal.ai/models/fal-ai/ffmpeg-api/merge-videos/api
 *  (fetched 2026-08-07): input `{video_urls: list<string>}` (required; optional
 *  target_fps/resolution we deliberately do not send), output `{video: {url}}`. */
export const FFMPEG_MERGE_VIDEOS_ENDPOINT = "fal-ai/ffmpeg-api/merge-videos";

export interface OrderedClip {
  sceneId: string;
  order: number;
  videoUrl: string;
  durationSeconds: number | null;
}

/** The ordered clip list spanning every Grid batch, strictly by global `order`
 *  (issue #30). A Scene without a generated clip is reported in `missingSceneIds`
 *  instead — joining a partial sequence would silently produce the wrong video. */
export function orderedClips(
  scenes: Pick<PlannerScene, "sceneId" | "order" | "targetClipDurationSeconds">[],
  clips: Record<string, { videoUrl: string | null; durationSeconds: number | null }>,
): { clips: OrderedClip[]; missingSceneIds: string[] } {
  const result: OrderedClip[] = [];
  const missingSceneIds: string[] = [];
  for (const scene of [...scenes].sort((a, b) => a.order - b.order)) {
    const clip = scene.sceneId ? clips[scene.sceneId] : undefined;
    if (clip?.videoUrl) {
      result.push({
        sceneId: scene.sceneId,
        order: scene.order,
        videoUrl: clip.videoUrl,
        durationSeconds: clip.durationSeconds ?? scene.targetClipDurationSeconds,
      });
    } else {
      missingSceneIds.push(scene.sceneId || `order ${scene.order}`);
    }
  }
  return { clips: result, missingSceneIds };
}

/** Total duration = the SUM of the scene durations (issue #30). `allKnown` is false
 *  when any clip has no recorded duration — the sum then covers only the known ones. */
export function totalDurationSeconds(clips: OrderedClip[]): { seconds: number; allKnown: boolean } {
  let seconds = 0;
  let allKnown = true;
  for (const clip of clips) {
    if (clip.durationSeconds == null) allKnown = false;
    else seconds += clip.durationSeconds;
  }
  return { seconds, allKnown };
}

/** The exact merge-videos input: clip URLs in global order and NOTHING else — no
 *  trims, no transitions, no fps/resolution overrides (ADR 0002). */
export function buildJoinInput(clips: OrderedClip[]): { video_urls: string[] } {
  return { video_urls: clips.map((c) => c.videoUrl) };
}
