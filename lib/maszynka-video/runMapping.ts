// Pure row↔run mapping for Maszynka Video runs (Video run — CONTEXT.md "Maszynka
// Video"), split from store.ts so the `.check.ts` self-check can run under plain
// `node` (store.ts pulls in the Neon driver via an extensionless import node can't
// resolve). The Video run field list lives here; store.ts owns the DDL and SQL.

/** One uploaded reference image (issue #26): uploaded ONCE through FAL storage, then
 *  reused by both the Planner (as a multimodal image part) and the grid generation
 *  stage (as its referenceFiles). `name` is the original filename, display only. */
export interface VideoReferenceFile {
  id: string;
  url: string;
  name: string;
}

/** One grid generation result (issue #27), keyed by `batchId` in `VideoRun.grids` so
 *  regenerating one grid upserts its own entry and leaves every other grid untouched.
 *  `request` is the exact FAL endpoint + input sent; `rawParams` is the operator's
 *  raw-model-parameters text as entered (re-shown when the run reopens). */
export interface VideoGridRecord {
  batchId: string;
  modelKey: string;
  rawParams: string;
  request: unknown;
  response: unknown;
  imageUrl: string | null;
  error: string | null;
}

export interface VideoRun {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Operator-facing name for finding the run in the shared history (PRD 0003 story 4). */
  name: string;
  /** Pasted verbatim by the operator — the app never authors this content (PRD 0003). */
  globalRules: string;
  priorityLogic: string;
  // Planner stage (issue #25) — see lib/maszynka-video/planner.ts / plannerContract.ts.
  // `plannerConfig` is the operator's PlannerConfig as entered; request/response are the
  // raw OpenRouter wire records; `plannerOutput` is the CURRENT parsed planner JSON —
  // possibly operator-edited (PRD story 8) — that later stages re-derive the contract
  // from. `plannerValidationError` non-null blocks every later stage (issue #25); it is
  // cleared (set "") on a successful planner run, never left stale.
  plannerConfig: unknown;
  plannerRequest: unknown;
  plannerResponse: unknown;
  plannerOutput: unknown;
  plannerValidationError: string | null;
  /** Reference files (issue #26) — full-replace list, removing one before running the
   *  planner excludes it from the request. */
  referenceFiles: VideoReferenceFile[];
  /** Grid results by batchId (issue #27) — server-side upsert per grid, never a full
   *  replace, so parallel operators can't clobber each other's grids. */
  grids: Record<string, VideoGridRecord>;
}

export interface VideoRunRow {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  global_rules: string | null;
  priority_logic: string | null;
  planner_config: unknown;
  planner_request: unknown;
  planner_response: unknown;
  planner_output: unknown;
  planner_validation_error: string | null;
  reference_files: VideoReferenceFile[] | null;
  grids: Record<string, VideoGridRecord> | null;
}

export function rowToVideoRun(row: VideoRunRow): VideoRun {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    name: row.name,
    globalRules: row.global_rules ?? "",
    priorityLogic: row.priority_logic ?? "",
    plannerConfig: row.planner_config ?? null,
    plannerRequest: row.planner_request ?? null,
    plannerResponse: row.planner_response ?? null,
    plannerOutput: row.planner_output ?? null,
    // "" (cleared on a successful run) and NULL (never ran) both mean "no error".
    plannerValidationError: row.planner_validation_error || null,
    referenceFiles: row.reference_files ?? [],
    grids: row.grids ?? {},
  };
}
