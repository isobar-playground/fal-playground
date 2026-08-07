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
});
assert.deepEqual(full, {
  id: "vr-1",
  createdAt: "2026-08-07T10:00:00.000Z",
  updatedAt: "2026-08-07T11:00:00.000Z",
  name: "First spot test",
  globalRules: "No competitor logos.",
  priorityLogic: "safety > brand > hook",
});

// --- NULL paste fields (pre-fill rows / never-pasted runs) surface as "" -------------
const sparse = rowToVideoRun({
  id: "vr-2",
  created_at: "2026-08-07T10:00:00.000Z",
  updated_at: "2026-08-07T10:00:00.000Z",
  name: "Bare run",
  global_rules: null,
  priority_logic: null,
});
assert.equal(sparse.globalRules, "");
assert.equal(sparse.priorityLogic, "");

console.log("lib/maszynka-video/runMapping.ts — all checks passed");
