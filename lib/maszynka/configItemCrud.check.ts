// Runnable check for the pure Config item CRUD + id-suggestion helpers that back the
// shared Config form editor shell (issue #18; list-valued-field helpers added by #21).
// Run with:
//   node lib/maszynka/configItemCrud.check.ts   (or: npm run check:maszynka-config-items)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import {
  addConfigItem,
  addListEntry,
  deleteConfigItem,
  isDuplicateConfigId,
  moveConfigItem,
  removeListEntry,
  suggestConfigId,
  suggestUniqueConfigId,
  updateConfigItem,
  updateListEntry,
} from "./configItemCrud.ts";

type Hook = { id: string; text: string; toneGuidance?: string };

const hooks: Hook[] = [
  { id: "discount", text: "Save 20% today" },
  { id: "urgency", text: "Only while stocks last" },
];

// --- add ---------------------------------------------------------------------
{
  const next = addConfigItem(hooks, { id: "new-one", text: "Brand new hook" });
  assert.equal(next.length, 3, "add appends without removing existing items");
  assert.equal(next[2].id, "new-one");
  assert.equal(hooks.length, 2, "add must not mutate the input array");
}

// --- update / read-only id ----------------------------------------------------
{
  const next = updateConfigItem(hooks, "id", "discount", { text: "Save 30% today" });
  assert.equal(next.find((h) => h.id === "discount")?.text, "Save 30% today");
  assert.equal(next.find((h) => h.id === "urgency")?.text, "Only while stocks last", "other items untouched");
  assert.equal(next.length, hooks.length, "update never changes item count");

  // Story 15 / ADR 0001: existing ids are read-only — a patch trying to smuggle a new id
  // through must not change identity.
  const tampered = updateConfigItem(hooks, "id", "discount", { id: "hijacked", text: "x" } as Partial<Hook>);
  assert.equal(tampered.find((h) => h.text === "x")?.id, "discount", "id in patch is ignored, not applied");
  assert.equal(
    tampered.some((h) => h.id === "hijacked"),
    false,
    "update can never introduce a new id",
  );
}

// --- delete --------------------------------------------------------------------
{
  const next = deleteConfigItem(hooks, "id", "urgency");
  assert.equal(next.length, 1);
  assert.equal(next[0].id, "discount");
  assert.equal(hooks.length, 2, "delete must not mutate the input array");

  const noop = deleteConfigItem(hooks, "id", "does-not-exist");
  assert.equal(noop.length, hooks.length, "deleting an unknown id is a no-op, not a throw");
}

// --- reorder (priority_logic layers etc.) ---------------------------------------
{
  const layers = ["a", "b", "c", "d"];
  assert.deepEqual(moveConfigItem(layers, 0, 2), ["b", "c", "a", "d"], "move forward shifts items between");
  assert.deepEqual(moveConfigItem(layers, 3, 0), ["d", "a", "b", "c"], "move backward shifts items between");
  assert.deepEqual(moveConfigItem(layers, 1, 1), layers, "moving to the same index is a no-op");
  assert.deepEqual(moveConfigItem(layers, -1, 2), layers, "out-of-range fromIndex is a no-op, not a throw");
  assert.deepEqual(moveConfigItem(layers, 0, 99), layers, "out-of-range toIndex is a no-op, not a throw");
  assert.equal(layers.length, 4, "reorder must not mutate the input array");
}

// --- list-valued field entries (StyleConfig.avoid etc. — issue #21) ---------------
{
  const avoid = ["harsh flat lighting", "cluttered background"];

  const added = addListEntry(avoid, "neon colors");
  assert.deepEqual(added, ["harsh flat lighting", "cluttered background", "neon colors"], "add appends to the end");
  assert.equal(avoid.length, 2, "add must not mutate the input array");

  const updated = updateListEntry(avoid, 1, "busy background");
  assert.deepEqual(updated, ["harsh flat lighting", "busy background"], "update replaces only the targeted index");
  assert.equal(avoid[1], "cluttered background", "update must not mutate the input array");
  assert.deepEqual(updateListEntry(avoid, 5, "x"), avoid, "out-of-range index is a no-op, not a throw");
  assert.deepEqual(updateListEntry(avoid, -1, "x"), avoid, "negative index is a no-op, not a throw");

  const removed = removeListEntry(avoid, 0);
  assert.deepEqual(removed, ["cluttered background"], "remove drops only the targeted index");
  assert.equal(avoid.length, 2, "remove must not mutate the input array");
  assert.deepEqual(removeListEntry(avoid, 5), avoid, "out-of-range index is a no-op, not a throw");

  // Reordering a list-valued field's entries reuses moveConfigItem (already generic over
  // T[], exercised above for priority_logic-style layers) rather than a new algorithm.
  assert.deepEqual(moveConfigItem(avoid, 0, 1), ["cluttered background", "harsh flat lighting"]);
}

// --- duplicate id detection ------------------------------------------------------
{
  assert.equal(isDuplicateConfigId(hooks, "id", "discount"), true);
  assert.equal(isDuplicateConfigId(hooks, "id", "brand-new"), false);
  assert.equal(
    isDuplicateConfigId(hooks, "id", "discount", "discount"),
    false,
    "excludeId lets an item be checked against the rest of the list without self-colliding",
  );
}

// --- id suggestion from free text (story 14) --------------------------------------
assert.equal(suggestConfigId("Save 20% today!"), "save-20-today");
assert.equal(suggestConfigId("  Leading/trailing spaces  "), "leading-trailing-spaces");
assert.equal(
  suggestConfigId("ZAŁOŻENIA"),
  "za-o-enia",
  "non-ascii letters collapse to hyphens like any other non-alphanumeric run",
);
assert.equal(suggestConfigId(""), "item", "empty input still produces a non-empty slug");
assert.equal(suggestConfigId("   "), "item", "whitespace-only input still produces a non-empty slug");
assert.equal(
  suggestConfigId("a".repeat(80)).length <= 40,
  true,
  "suggestion is capped to a reasonable id length",
);
assert.equal(
  /^[a-z0-9-]*$/.test(suggestConfigId("Ω Hook: 'Buy now' — limited!")),
  true,
  "suggestion is always slug-safe characters",
);

// --- unique id suggestion (avoids silent duplicate on create) ---------------------
{
  const withDupeRisk: Hook[] = [{ id: "save-today", text: "x" }];
  assert.equal(suggestUniqueConfigId(withDupeRisk, "id", "brand-new"), "brand-new", "no collision, no suffix");
  assert.equal(suggestUniqueConfigId(withDupeRisk, "id", "save-today"), "save-today-2");
  const withTwoDupes: Hook[] = [
    { id: "save-today", text: "x" },
    { id: "save-today-2", text: "y" },
  ];
  assert.equal(suggestUniqueConfigId(withTwoDupes, "id", "save-today"), "save-today-3", "skips past every taken suffix");
}

console.log("lib/maszynka/configItemCrud.check.ts — all checks passed");
