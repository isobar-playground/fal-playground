// Runnable check tying the shared Config form editor shell's field definitions
// (configFormDefs.ts) to the pure CRUD helpers (configItemCrud.ts), the per-kind
// validator (configSchemas.ts), and the shipped seed (configSeeds.ts) — issue #20
// ("Add form CRUD for Hooks"). The other check files each cover one layer in isolation
// (configItemCrud.check.ts exercises the generic helpers against a hand-rolled `Hook`
// shape; config.check.ts checks every seed against its schema) but nothing previously
// exercised CONFIG_FORM_DEFS.hooks — the actual object the UI (MaszynkaConfigs.tsx /
// MaszynkaConfigItemForm.tsx) renders — end to end against the real seed data. Run with:
//   node lib/maszynka/configFormDefs.check.ts   (or: npm run check:maszynka-config-form-defs)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import { CONFIG_FORM_DEFS } from "./configFormDefs.ts";
import {
  addConfigItem,
  deleteConfigItem,
  isDuplicateConfigId,
  suggestConfigId,
  suggestUniqueConfigId,
  updateConfigItem,
  type ConfigItem,
} from "./configItemCrud.ts";
import { validateConfigBody, type HookConfig } from "./configSchemas.ts";
import { CONFIG_SEEDS } from "./configSeeds.ts";

// `HookConfig` (an `interface`) doesn't structurally satisfy the `ConfigItem` generic
// constraint the CRUD helpers use (`Record<string, unknown>` requires an index
// signature, which interfaces don't get for free — unlike object-literal `type`
// aliases). Intersecting with `ConfigItem` gives every seed hook that index signature
// for the calls below without changing its actual shape.
type Hook = HookConfig & ConfigItem;

const hookFormDef = CONFIG_FORM_DEFS.hooks;
assert.ok(hookFormDef, "hooks must have a registered ConfigItemFormDef (issue #18/#20)");

const seedHooks = CONFIG_SEEDS.hooks as Hook[];
assert.equal(
  validateConfigBody("hooks", seedHooks).length,
  0,
  "seeded hooks must already be schema-valid (sanity check before mutating them below)",
);

// --- form def shape matches what the validator/seed actually expect ------------------
assert.equal(hookFormDef.idKey, "id", "Hook identity field is HookConfig.id");
assert.equal(hookFormDef.suggestIdFromKey, "text", "PRD story 14: id is suggested from the Hook text field");
const fieldKeys = hookFormDef.fields.map((f) => f.key);
assert.deepEqual(
  fieldKeys.sort(),
  ["placementGuidance", "text", "toneGuidance"].sort(),
  "form must expose text, placement guidance, and tone guidance (issue #20 acceptance)",
);
assert.equal(
  hookFormDef.fields.find((f) => f.key === "text")?.required,
  true,
  "Hook text is required (issue #20 acceptance)",
);
for (const optionalKey of ["placementGuidance", "toneGuidance"]) {
  assert.notEqual(
    hookFormDef.fields.find((f) => f.key === optionalKey)?.required,
    true,
    `${optionalKey} must stay optional — configSchemas.ts only requires it when present`,
  );
}

// Every seed hook must actually populate the fields the form renders as editable, so a
// form-driven edit of the shipped seed touches real data rather than an empty string.
for (const hook of seedHooks) {
  for (const key of fieldKeys) {
    assert.ok(
      typeof hook[key] === "string" && hook[key],
      `seed hook "${hook.id}" should have a non-empty ${key} for the form to demonstrate editing it`,
    );
  }
}

// --- emptyItem() is a valid starting point for the create form ------------------------
{
  const empty = hookFormDef.emptyItem();
  assert.equal(empty[hookFormDef.idKey], "", "a brand-new item starts with no id — the shell fills it in on create");
  assert.equal(
    validateConfigBody("hooks", [{ ...empty, id: "placeholder", text: "Some hook text" }]).length,
    0,
    "emptyItem() plus an id and required text must be a schema-valid hook",
  );
}

// --- add: suggested id + required text, exercised against the real seed --------------
{
  const draft = { ...hookFormDef.emptyItem(), text: "Buy now, thank us later" };
  const suggested = suggestUniqueConfigId(seedHooks, hookFormDef.idKey, suggestConfigId(draft.text));
  assert.equal(suggested, "buy-now-thank-us-later");
  assert.equal(isDuplicateConfigId(seedHooks, hookFormDef.idKey, suggested), false);

  const withNewHook = addConfigItem(seedHooks, { ...draft, id: suggested } as Hook);
  assert.equal(withNewHook.length, seedHooks.length + 1);
  assert.deepEqual(
    validateConfigBody("hooks", withNewHook),
    [],
    "adding a hook with a suggested id and required text must stay schema-valid",
  );

  // Missing required text must be rejected — issue #20 "Validation rejects malformed
  // Hook bodies and shows actionable errors".
  const missingText = addConfigItem(seedHooks, { id: "no-text", text: "" } as Hook);
  assert.ok(validateConfigBody("hooks", missingText).length > 0, "empty hook text must fail validation");
}

// --- edit: text, placement guidance, tone guidance update without touching id --------
{
  const target = seedHooks[0];
  const patch = {
    text: "Updated hook text",
    placementGuidance: "Updated placement guidance",
    toneGuidance: "Updated tone guidance",
  };
  const updated = updateConfigItem(seedHooks, hookFormDef.idKey, target.id, patch);
  const updatedHook = updated.find((h) => h.id === target.id);
  assert.equal(updatedHook?.text, patch.text);
  assert.equal(updatedHook?.placementGuidance, patch.placementGuidance);
  assert.equal(updatedHook?.toneGuidance, patch.toneGuidance);
  assert.equal(updated.length, seedHooks.length, "editing never changes the item count");
  assert.deepEqual(validateConfigBody("hooks", updated), [], "an edited hook list must stay schema-valid");

  // Story 15 / ADR 0001: id in the patch must never win, even against real seed data.
  const tampered = updateConfigItem(seedHooks, hookFormDef.idKey, target.id, {
    id: "hijacked",
    text: "x",
  } as Partial<Hook>);
  assert.equal(
    tampered.some((h) => h.id === "hijacked"),
    false,
    "editing a seeded hook can never change its id",
  );
}

// --- delete: removes from the next version, list stays schema-valid ------------------
{
  const target = seedHooks[seedHooks.length - 1];
  const deleted = deleteConfigItem(seedHooks, hookFormDef.idKey, target.id);
  assert.equal(deleted.length, seedHooks.length - 1);
  assert.equal(
    deleted.some((h) => h.id === target.id),
    false,
  );
  assert.deepEqual(validateConfigBody("hooks", deleted), [], "the list after deleting a seeded hook must stay valid");
}

console.log("lib/maszynka/configFormDefs.check.ts — all checks passed");
