// Planner output contract (PRD 0003 "Planner output contract", issue #25). The app
// relies ONLY on the field names from the source spec — scenePlan / masterScenePlan /
// gridBatches / gridGenerationPayload and the per-scene sceneId / order / gridSlot /
// duration — everything else passes through untouched and stays editable as JSON.
// Scene splitting and grid layout are owned by the pasted planner prompt, never by
// this code: parsing here is tolerant (missing pieces yield empty lists, not errors);
// the ONLY hard failure is a response that isn't a JSON object at all, which becomes
// `validationError` and blocks every later stage.

/** One planned Scene (CONTEXT.md "Scene"), normalized for the later stages. `raw` is
 *  the untouched pass-through fragment the Clip stage sends to the video model. */
export interface PlannerScene {
  sceneId: string;
  /** Global order across every Grid batch. Falls back to the scene's position when
   *  the planner omitted `order` — the display keeps working, the operator can fix
   *  the JSON. */
  order: number;
  /** Displayed verbatim (string/number/whatever the planner emitted) — slot semantics
   *  belong to the planner prompt's layout, not to app code. Null when absent. */
  gridSlot: unknown;
  /** Seconds for the Clip stage (PRD: `targetClipDurationSeconds` from the scene
   *  JSON; `durationSeconds`/`duration` accepted as fallbacks). Null when absent. */
  targetClipDurationSeconds: number | null;
  raw: Record<string, unknown>;
}

/** One Grid batch (CONTEXT.md "Grid batch") — for a short video, the single
 *  synthetic batch wrapping the top-level `gridGenerationPayload`. */
export interface PlannerGridBatch {
  batchId: string;
  sceneIds: string[];
  gridGenerationPayload: Record<string, unknown>;
}

export interface PlannerContract {
  /** The full parsed planner JSON, pass-through (unknown fields preserved). Null
   *  when `validationError` is set. */
  parsed: Record<string, unknown> | null;
  /** Set ONLY when the response was not a JSON object — the one hard validation
   *  failure that blocks later stages (issue #25). */
  validationError: string | null;
  /** Short-video plan (pass-through), when present. */
  scenePlan: unknown;
  /** Long-video plan (pass-through), when present. */
  masterScenePlan: unknown;
  /** Normalized batches: `gridBatches` for a long video, or one synthetic batch for
   *  a short video's top-level `gridGenerationPayload`. Empty when neither exists. */
  batches: PlannerGridBatch[];
  /** Every Scene found in the (master) scene plan, sorted by global `order`. */
  scenes: PlannerScene[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const EMPTY: Omit<PlannerContract, "validationError"> = {
  parsed: null,
  scenePlan: null,
  masterScenePlan: null,
  batches: [],
  scenes: [],
};

function sceneFromRaw(raw: Record<string, unknown>, index: number): PlannerScene {
  return {
    sceneId: typeof raw.sceneId === "string" ? raw.sceneId : raw.sceneId != null ? String(raw.sceneId) : "",
    order: asNumber(raw.order) ?? index + 1,
    gridSlot: raw.gridSlot ?? null,
    targetClipDurationSeconds:
      asNumber(raw.targetClipDurationSeconds) ?? asNumber(raw.durationSeconds) ?? asNumber(raw.duration),
    raw,
  };
}

/** Derives the contract from an already-parsed planner output object — also the
 *  entry point for operator-EDITED output (PRD story 8: every planner output is
 *  editable before the next stage consumes it; edits re-derive batches/scenes). */
export function derivePlannerContract(parsed: unknown): PlannerContract {
  if (!isPlainObject(parsed)) {
    return { ...EMPTY, validationError: "Planner response must be a single JSON object." };
  }

  const scenePlan = parsed.scenePlan ?? null;
  const masterScenePlan = parsed.masterScenePlan ?? null;
  const plan = isPlainObject(masterScenePlan) ? masterScenePlan : isPlainObject(scenePlan) ? scenePlan : null;
  const scenes = (Array.isArray(plan?.scenes) ? plan.scenes : [])
    .filter(isPlainObject)
    .map(sceneFromRaw)
    .sort((a, b) => a.order - b.order);

  let batches: PlannerGridBatch[] = [];
  if (Array.isArray(parsed.gridBatches)) {
    batches = parsed.gridBatches.filter(isPlainObject).map((b, i) => ({
      batchId: typeof b.batchId === "string" && b.batchId ? b.batchId : `grid-${String(i + 1).padStart(2, "0")}`,
      sceneIds: Array.isArray(b.sceneIds) ? b.sceneIds.filter((s): s is string => typeof s === "string") : [],
      gridGenerationPayload: isPlainObject(b.gridGenerationPayload) ? b.gridGenerationPayload : {},
    }));
  } else if (isPlainObject(parsed.gridGenerationPayload)) {
    // Short video: one scenePlan + one top-level payload — normalized into a single
    // synthetic batch covering every scene, so the grid/crop stages have one shape.
    batches = [
      {
        batchId: "grid-01",
        sceneIds: scenes.map((s) => s.sceneId).filter(Boolean),
        gridGenerationPayload: parsed.gridGenerationPayload,
      },
    ];
  }

  return { parsed, validationError: null, scenePlan, masterScenePlan, batches, scenes };
}

/** Writes an edited grid payload back into the parsed planner output — the payload
 *  STAYS part of the planner output (one source of truth for the grid stage AND the
 *  crop stage's layout), so a grid-section payload edit is a planner-output edit
 *  (PRD story 8). `batchIndex` is the position in the DERIVED batches list: for a
 *  long video that's the matching plain-object entry of `gridBatches` (in order);
 *  for a short video (index 0) it's the top-level `gridGenerationPayload`. Unknown
 *  sibling fields on the batch entry are preserved. */
export function withUpdatedGridPayload(
  parsed: Record<string, unknown>,
  batchIndex: number,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (Array.isArray(parsed.gridBatches)) {
    let objIndex = -1;
    const gridBatches = parsed.gridBatches.map((b) => {
      if (!isPlainObject(b)) return b;
      objIndex += 1;
      return objIndex === batchIndex ? { ...b, gridGenerationPayload: payload } : b;
    });
    return { ...parsed, gridBatches };
  }
  return { ...parsed, gridGenerationPayload: payload };
}

/** Parses the planner's raw message content. A non-JSON response is the spec's
 *  `validationError` case (PRD: "a non-JSON planner response surfaces as
 *  validationError") — it blocks later stages. */
export function parsePlannerContent(content: string): PlannerContract {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return {
      ...EMPTY,
      validationError: `Planner response was not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return derivePlannerContract(parsed);
}
