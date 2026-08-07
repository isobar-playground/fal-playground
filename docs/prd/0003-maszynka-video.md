# PRD: Maszynka Video

Source context: planning session on August 7, 2026, based on `dump/CFDE-Maszynka Video-070826-150934.pdf`. Domain terms are defined in `CONTEXT.md` (Maszynka Video section); media-processing decisions are recorded in `docs/adr/0002-maszynka-video-media-processing.md`.

## Problem Statement

The playground covers single-prompt image/video tests and the Maszynka image test bench, but there is no tooling for the Content Factory **video** pipeline: an LLM planner splits a brief into scenes, FAL generates scenes as grid images, panels are cropped out, each panel is animated with image-to-video, and the clips are joined into one final video. Today the operator runs the planner preset by hand in OpenRouter and has no way to execute or inspect the grid → crop → clip → join stages at all.

## Solution

A fifth top-level tab, **Maszynka Video**, separate from the existing Maszynka (the two pipelines share no stage). Own view component and `lib/maszynka-video/` module set. Video runs are recorded server-side in Neon and shared across operators, following the ADR 0001 rationale.

The screen mirrors the pipeline as sequential sections. Every stage output is editable before the next stage consumes it; **Run full flow** executes all stages in order, stopping only on hard validation failures.

### Pipeline

1. **Planner** — GPT-5.6 (default Luna tier) via OpenRouter through the existing `/api/chat` proxy, `stream: false`, `response_format: {type: "json_object"}` always sent, `reasoning.effort` from a select (default `medium`). `max_tokens`, `temperature`, `top_p` are sent only when filled in (0/empty = omit). Reference files are uploaded via FAL storage and passed to the planner as multimodal image parts. The operator pastes the full system prompt and the input JSON; the app never authors global rules or priority logic content.
   - Short video (5–30 s): planner returns one `scenePlan` + one `gridGenerationPayload` (~4 s per scene, max 4 scenes per grid).
   - Long video (31–180 s): planner returns one `masterScenePlan` + multiple `gridBatches` (max 4 scenes each), e.g. 60 s = 15 scenes = 4 grids.
   - Scene splitting and grid layout (including the open 17–20 s case) are owned by the pasted system prompt, not by app code. The app displays the output, recognizes `gridBatches`, and preserves global `sceneId` and `order`.
2. **Grids** — one section per grid (per `gridBatch` for long video). Fields: image model endpoint (existing image catalog), `gridGenerationPayload`, reference files, `canvasSize` (read from the payload), raw model parameters (JSON pass-through), Generate grid, grid preview, raw request/response. Each grid runs independently.
3. **Crops** — panels are cut in the browser: equal-fraction cuts per the payload layout, with each cut line snapped to a detected gutter (1D gradient projection) within a ±5% window. Per crop: `batchId`, `sceneId`, global `order`, `gridSlot`, preview, **Replace crop** (manual upload via FAL storage). Mapping is by `sceneId` only.
4. **Scenes (image-to-video)** — one section per scene: `sceneId`, `order`, crop preview, the scene's JSON fragment, video model endpoint (run-level default from the video catalog filtered to image-to-video, overridable per scene), `targetClipDurationSeconds` from the scene JSON, raw model parameters, Generate scene, video preview, raw request/response. Hard validation: `crop.sceneId === sceneJson.sceneId` — no request is sent on mismatch.
5. **Final video** — ordered clip list by global `order`, total duration (sum), **Join clips** via the FAL ffmpeg endpoint (hard concatenation of full clips — no trimming, no transitions), final video preview, `finalVideoUrl`.

### Planner output contract

The app relies only on the field names from the source spec; everything else passes through untouched and stays editable as JSON:

```json
{
  "masterScenePlan": {
    "targetFinalDurationSeconds": 60,
    "sceneCount": 15,
    "sceneDurationsSeconds": [],
    "scenes": []
  },
  "gridBatches": [
    {
      "batchId": "grid-01",
      "sceneIds": ["scene-01", "scene-02", "scene-03", "scene-04"],
      "gridGenerationPayload": {}
    }
  ]
}
```

Short video uses `scenePlan` + a single top-level `gridGenerationPayload` instead. Scene entries carry `sceneId`, `order`, `gridSlot`, and a duration; a non-JSON planner response surfaces as `validationError`.

### Reference scene counts (from the spec)

| Video length | Scenes | Layout |
|---|---|---|
| 5–8 s | 2 | 1x2 |
| 9–12 s | 3 | 1x3 |
| 13–16 s | 4 | 2x2 |
| 17–20 s | 5 | layout owned by planner prompt |
| 21–24 s | 6 | 2x3 |
| 25–30 s | 8 | 2x4 |
| 40 s | 10 | grids of ≤4 |
| 60 s | 15 | grids of ≤4 |
| 90 s | 22 | grids of ≤4 |
| 120 s | 30 | grids of ≤4 |
| 150 s | ~38 | grids of ≤4 |
| 180 s | 45 | grids of ≤4 |

These live in the planner's system prompt; the app does not enforce them.

## User Stories

1. As an operator, I want a Maszynka Video tab next to the existing tabs, so that video pipeline tests do not mix with the image test bench.
2. As an operator, I want to paste global rules and priority logic into dedicated fields, so that I control their content without a deploy.
3. As an operator, I want to upload reference images once, so that both the planner and the grid generation receive them.
4. As an operator, I want to name a run, so that I can find it in the shared history.
5. As an operator, I want to configure the planner (model, reasoning effort, max tokens, temperature, top-p, system prompt, input JSON), so that the run reproduces my manual OpenRouter preset.
6. As an operator, I want empty planner parameters to be omitted from the request, so that models without those parameters do not error.
7. As an operator, I want to see the planner's raw response, parsed JSON, scene plan, grid payloads, and any validation error, so that I can debug the planning stage.
8. As an operator, I want to edit every planner output before the next stage, so that I can correct the plan without re-running the planner.
9. As an operator, I want each grid to run separately with its own payload, references, and raw parameters, so that I can iterate on one grid without regenerating the rest.
10. As an operator, I want panels cropped automatically with gutter detection, so that slightly uneven grids still cut correctly.
11. As an operator, I want to see every crop with its sceneId, order, and grid slot, so that I can verify the mapping before animation.
12. As an operator, I want to replace any crop manually, so that a bad panel does not force a full grid re-run.
13. As an operator, I want a run-level default video model with per-scene override, so that I do not configure dozens of scenes one by one.
14. As an operator, I want the app to refuse to animate a scene when the crop's sceneId does not match the scene JSON, so that clips never come from the wrong panel.
15. As an operator, I want each scene's clip generated separately with previews and raw request/response, so that I can retry individual scenes.
16. As an operator, I want Join clips to concatenate full clips in global order with no trims or transitions, so that the result is exactly the planned sequence.
17. As an operator, I want a final video preview and a stored URL, so that I can share the result.
18. As an operator, I want Run full flow to execute all stages sequentially with progress and a stop button, halting only on hard validation errors, so that a clean run needs one click.
19. As an operator, I want the run (config + stage outputs) recorded server-side, so that other operators can see and compare runs.

## Decisions

- Separate fifth tab; the existing Maszynka and its dead `assetType: "video"` are untouched.
- Video runs persist in Neon (new table + routes modeled on `lib/maszynka/store.ts`), shared across operators.
- Clips are joined via the FAL ffmpeg endpoint; crops are cut in the browser (Canvas + seam-snap). See ADR 0002.
- Reference files reach the planner as multimodal image parts, not just URLs in text.
- One editable configuration per current test — no preset management system.
- New `lib/maszynka-video/` modules ship with `.check.ts` self-checks in the repo idiom (contract parsing, seam-snap, payload building, sceneId validation).

## Out of Scope

- Preset/config-kind management for the video pipeline.
- Any trimming, transition, or re-encoding logic in the final join.
- Scene-splitting or layout logic in app code — the pasted planner prompt owns it.
- Authoring global rules / priority logic content.
