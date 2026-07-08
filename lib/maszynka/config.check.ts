// Runnable check for the new non-trivial logic this slice adds: append-only
// version-increment (configVersion.ts) and per-kind JSON schema validation
// (configSchemas.ts) — including a regression check that every shipped seed
// (configSeeds.ts) actually satisfies its own kind's schema, so a future edit to one
// file can't silently desync from the other. Run with:
//   node lib/maszynka/config.check.ts   (or: npm run check:maszynka-configs)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively, so this runs with no build
// step and no dependency.
import assert from "node:assert/strict";
import { nextVersion } from "./configVersion.ts";
import { CONFIG_KINDS, validateConfigBody } from "./configSchemas.ts";
import { CONFIG_SEEDS } from "./configSeeds.ts";

// --- version increment ------------------------------------------------------
assert.equal(nextVersion([]), 1, "empty kind starts at version 1");
assert.equal(nextVersion([1]), 2);
assert.equal(nextVersion([1, 2, 5]), 6, "next version is one past the max, not the count");
assert.equal(nextVersion([3, 1, 2]), 4, "order of existing versions shouldn't matter");

// --- seed data must satisfy its own kind's schema ---------------------------
for (const kind of CONFIG_KINDS) {
  const errors = validateConfigBody(kind, CONFIG_SEEDS[kind]);
  assert.deepEqual(errors, [], `seed for "${kind}" must be schema-valid, got: ${errors.join("; ")}`);
}
assert.equal(CONFIG_KINDS.length, 6, "PRD/ADR name exactly six config kinds");

// --- validators reject malformed bodies (spot checks per kind) --------------
assert.ok(validateConfigBody("hooks", { not: "an array" }).length, "hooks body must be an array");
assert.ok(validateConfigBody("hooks", [{ id: "x" }]).length, "hooks entries need a non-empty text");
assert.ok(
  validateConfigBody("hooks", [
    { id: "dup", text: "a" },
    { id: "dup", text: "b" },
  ]).length,
  "duplicate hook ids are rejected",
);

assert.ok(validateConfigBody("styles", [{ styleId: "x" }]).length, "styles entries need all required fields");
assert.ok(
  validateConfigBody("styles", [{ styleId: "x", styleName: "X", visualIntent: "i", lighting: "l", colorDirection: "c", compositionBias: "b", typographyBehavior: "t", avoid: "not-an-array", recommendedModels: [], scoringCriteria: [] }]).length,
  "styles array fields must actually be arrays",
);

assert.ok(validateConfigBody("priority_logic", { layers: [] }).length, "priority_logic needs at least one layer");
assert.ok(validateConfigBody("priority_logic", "not-an-object").length);

assert.ok(
  validateConfigBody("model_capability_matrix", [{ modelKey: "m", modelId: "m", modelLabel: "M", supportsNegativePrompt: "yes", supportsSeed: true, supportsMultiImage: true, maxInputImages: 1 }]).length,
  "capability booleans must actually be booleans",
);

console.log("lib/maszynka/config.check.ts — all checks passed");
