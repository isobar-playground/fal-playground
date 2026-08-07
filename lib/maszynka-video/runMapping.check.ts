// Runnable check for lib/maszynka-video/runMapping.ts — the Video run row↔run
// mapping used by the Neon store (store.ts). Run with:
//   node lib/maszynka-video/runMapping.check.ts   (or: npm run check:maszynka-video-run-mapping)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { rowToVideoRun } from "./runMapping.ts";

// --- a fully populated row maps field-for-field --------------------------------------
const full = rowToVideoRun({
  id: "vr-1",
  created_at: "2026-08-07T10:00:00.000Z",
  updated_at: "2026-08-07T11:00:00.000Z",
  name: "First spot test",
  global_rules: "No competitor logos.",
  priority_logic: "safety > brand > hook",
  planner_config: { model: "openai/gpt-5.6-luna" },
  planner_request: { model: "openai/gpt-5.6-luna" },
  planner_response: { id: "gen-1" },
  planner_output: { scenePlan: {} },
  planner_validation_error: "response was not valid JSON",
});
assert.deepEqual(full, {
  id: "vr-1",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T11:00:00.000Z",
  name: "First spot test",
  globalRules: "No competitor logos.",
  priorityLogic: "safety > brand > hook",
  plannerConfig: { model: "openai/gpt-5.6-luna" },
  plannerRequest: { model: "openai/gpt-5.6-luna" },
  plannerResponse: { id: "gen-1" },
  plannerOutput: { scenePlan: {} },
  plannerValidationError: "response was not valid JSON",
});

// --- NULL paste fields (pre-fill rows / never-pasted runs) surface as "" -------------
const sparse = rowToVideoRun({
  id: "vr-2",
  created_at: "2026-08-07T10:00:00.000Z",
  updated_at: "2026-08-07T10:00:00.000Z",
  name: "Bare run",
  global_rules: null,
  priority_logic: null,
  planner_config: null,
  planner_request: null,
  planner_response: null,
  planner_output: null,
  planner_validation_error: null,
});
assert.equal(sparse.globalRules, "");
assert.equal(sparse.priorityLogic, "");
assert.equal(sparse.plannerConfig, null);
assert.equal(sparse.plannerOutput, null);
assert.equal(sparse.plannerValidationError, null);

// --- "" (cleared after a successful planner re-run) reads back as "no error" --------
const cleared = rowToVideoRun({
  id: "vr-3",
  created_at: "2026-08-07T10:00:00.000Z",
  updated_at: "2026-08-07T10:00:00.000Z",
  name: "Cleared run",
  global_rules: null,
  priority_logic: null,
  planner_config: null,
  planner_request: null,
  planner_response: null,
  planner_output: { scenePlan: {} },
  planner_validation_error: "",
});
assert.equal(cleared.plannerValidationError, null);

console.log("lib/maszynka-video/runMapping.ts — all checks passed");
