// Runnable check tying the shared Config form editor shell's field definitions
// (configFormDefs.ts) to the pure CRUD helpers (configItemCrud.ts), the per-kind
// validator (configSchemas.ts), and the shipped seed (configSeeds.ts) — issue #20
// ("Add form CRUD for Hooks") added the hooks section below; issue #21 ("Add form CRUD
// for Styles and Camera settings") added the styles/camera_settings sections, including
// the new `stringList` field type's add/edit/remove/reorder behavior. Issue #22 ("Add
// form CRUD for Global rules, Priority logic, and Model capability") adds the
// global_rules/priority_logic/model_capability_matrix sections, including
// `itemsFromBody`/`bodyFromItems` (priority_logic's `{ layers: [...] }` body isn't itself
// the item array) and the new `boolean`/`number` field types. The other check files each
// cover one layer in isolation (configItemCrud.check.ts exercises the generic helpers
// against hand-rolled shapes; config.check.ts checks every seed against its schema) but
// nothing else exercises a real `CONFIG_FORM_DEFS` entry — the actual object the UI
// (MaszynkaConfigs.tsx / MaszynkaConfigItemForm.tsx) renders — end to end against the
// real seed data. Run with:
//   node lib/maszynka/configFormDefs.check.ts   (or: npm run check:maszynka-config-form-defs)
// No test framework in this repo by design (see docs/prd/0001-maszynka-test-bench.md,
// "Testing Decisions") — Node 22+ strips TS types natively.
import assert from "node:assert/strict";
import { buildFormBody, CONFIG_FORM_DEFS, extractFormItems } from "./configFormDefs.ts";
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
  type ConfigItem,
} from "./configItemCrud.ts";
import {
  validateConfigBody,
  type CameraSettingConfig,
  type GlobalRuleConfig,
  type HookConfig,
  type LightingConfig,
  type ModelCapabilityEntry,
  type PriorityLogicConfig,
  type StyleConfig,
} from "./configSchemas.ts";
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

// ======================================================================================
// styles (issue #21)
// ======================================================================================
type Style = StyleConfig & ConfigItem;

const styleFormDef = CONFIG_FORM_DEFS.styles;
assert.ok(styleFormDef, "styles must have a registered ConfigItemFormDef (issue #21)");

const seedStyles = CONFIG_SEEDS.styles as Style[];
assert.equal(
  validateConfigBody("styles", seedStyles).length,
  0,
  "seeded styles must already be schema-valid (sanity check before mutating them below)",
);

// --- form def shape matches what the validator/seed actually expect ------------------
assert.equal(styleFormDef.idKey, "styleId", "Style identity field is StyleConfig.styleId");
assert.equal(styleFormDef.suggestIdFromKey, "styleName", "PRD story 14: id is suggested from the Style name");
const styleFieldKeys = styleFormDef.fields.map((f) => f.key);
assert.deepEqual(
  styleFieldKeys.sort(),
  [
    "styleName",
    "visualIntent",
    "lighting",
    "colorDirection",
    "compositionBias",
    "typographyBehavior",
    "avoid",
    "recommendedModels",
    "scoringCriteria",
  ].sort(),
  "style form must expose every StyleConfig field besides the id (issue #21 acceptance)",
);
for (const key of ["styleName", "visualIntent", "lighting", "colorDirection", "compositionBias", "typographyBehavior"]) {
  assert.equal(styleFormDef.fields.find((f) => f.key === key)?.required, true, `${key} is required on Style`);
}
for (const key of ["avoid", "recommendedModels", "scoringCriteria"]) {
  assert.equal(styleFormDef.fields.find((f) => f.key === key)?.type, "stringList", `${key} is a list-valued field`);
}

// Every seed style must actually populate the string fields the form renders, so a
// form-driven edit of the shipped seed touches real data rather than an empty string.
for (const style of seedStyles) {
  for (const key of styleFieldKeys) {
    const value = style[key];
    if (Array.isArray(value)) {
      assert.ok(value.length > 0, `seed style "${style.styleId}" should have a non-empty ${key} list`);
    } else {
      assert.ok(typeof value === "string" && value, `seed style "${style.styleId}" should have a non-empty ${key}`);
    }
  }
}

// --- emptyItem() is a valid starting point for the create form ------------------------
{
  const empty = styleFormDef.emptyItem();
  assert.equal(empty[styleFormDef.idKey], "", "a brand-new style starts with no id — the shell fills it in on create");
  assert.deepEqual(empty.avoid, [], "list-valued fields start empty, not undefined");
  const filled = {
    ...empty,
    styleId: "placeholder",
    styleName: "Placeholder",
    visualIntent: "i",
    lighting: "l",
    colorDirection: "c",
    compositionBias: "b",
    typographyBehavior: "t",
  };
  assert.deepEqual(
    validateConfigBody("styles", [filled]),
    [],
    "emptyItem() plus an id and required fields must be a schema-valid style",
  );
}

// --- add: suggested id, exercised against the real seed -------------------------------
{
  const draft = { ...styleFormDef.emptyItem(), styleName: "Retro Print Ad" };
  const suggested = suggestUniqueConfigId(seedStyles, styleFormDef.idKey, suggestConfigId(draft.styleName));
  assert.equal(suggested, "retro-print-ad");
  assert.equal(isDuplicateConfigId(seedStyles, styleFormDef.idKey, suggested), false);

  const newStyle = {
    ...draft,
    styleId: suggested,
    visualIntent: "i",
    lighting: "l",
    colorDirection: "c",
    compositionBias: "b",
    typographyBehavior: "t",
  } as Style;
  const withNewStyle = addConfigItem(seedStyles, newStyle);
  assert.equal(withNewStyle.length, seedStyles.length + 1);
  assert.deepEqual(
    validateConfigBody("styles", withNewStyle),
    [],
    "adding a style with a suggested id and required fields must stay schema-valid",
  );

  // Missing required fields must be rejected — issue #21 "Validation rejects malformed
  // Preset bodies and shows actionable errors".
  const missingFields = addConfigItem(seedStyles, { styleId: "incomplete", styleName: "Incomplete" } as Style);
  assert.ok(validateConfigBody("styles", missingFields).length > 0, "a style missing required fields must fail validation");
}

// --- edit: string fields update without touching id -----------------------------------
{
  const target = seedStyles[0];
  const patch = { visualIntent: "Updated visual intent", lighting: "Updated lighting" };
  const updated = updateConfigItem(seedStyles, styleFormDef.idKey, target.styleId, patch);
  const updatedStyle = updated.find((s) => s.styleId === target.styleId);
  assert.equal(updatedStyle?.visualIntent, patch.visualIntent);
  assert.equal(updatedStyle?.lighting, patch.lighting);
  assert.equal(updated.length, seedStyles.length, "editing never changes the item count");
  assert.deepEqual(validateConfigBody("styles", updated), [], "an edited style list must stay schema-valid");

  // Story 15 / ADR 0001: id in the patch must never win, even against real seed data.
  const tampered = updateConfigItem(seedStyles, styleFormDef.idKey, target.styleId, {
    styleId: "hijacked",
    visualIntent: "x",
  } as Partial<Style>);
  assert.equal(
    tampered.some((s) => s.styleId === "hijacked"),
    false,
    "editing a seeded style can never change its id",
  );
}

// --- list-valued field CRUD: add/edit/remove/reorder within a single style's array ----
{
  const target = seedStyles[0];
  assert.ok(target.avoid.length >= 2, "premium_luxury seed needs at least 2 `avoid` entries to exercise reorder");

  const withAddedAvoid = addListEntry(target.avoid, "washed-out colors");
  const afterAdd = updateConfigItem(seedStyles, styleFormDef.idKey, target.styleId, { avoid: withAddedAvoid });
  assert.equal(afterAdd.find((s) => s.styleId === target.styleId)?.avoid.length, target.avoid.length + 1);
  assert.deepEqual(validateConfigBody("styles", afterAdd), [], "adding an avoid entry must stay schema-valid");

  const withEditedAvoid = updateListEntry(target.avoid, 0, "harsh unflattering lighting");
  assert.equal(withEditedAvoid[0], "harsh unflattering lighting");
  assert.equal(target.avoid[0], "harsh flat lighting", "editing a list entry must not mutate the original array");

  const withRemovedAvoid = removeListEntry(target.avoid, 0);
  assert.equal(withRemovedAvoid.length, target.avoid.length - 1);
  assert.deepEqual(
    withRemovedAvoid,
    target.avoid.slice(1),
    "removing index 0 drops only the first entry",
  );

  const reordered = moveConfigItem(target.avoid, 0, target.avoid.length - 1);
  assert.equal(reordered[reordered.length - 1], target.avoid[0], "reorder moves the entry to the requested position");
  assert.equal(reordered.length, target.avoid.length, "reorder never changes the entry count");
}

// --- delete: removes from the next version, list stays schema-valid ------------------
{
  const target = seedStyles[seedStyles.length - 1];
  const deleted = deleteConfigItem(seedStyles, styleFormDef.idKey, target.styleId);
  assert.equal(deleted.length, seedStyles.length - 1);
  assert.equal(
    deleted.some((s) => s.styleId === target.styleId),
    false,
  );
  assert.deepEqual(validateConfigBody("styles", deleted), [], "the list after deleting a seeded style must stay valid");
}

// ======================================================================================
// camera_settings (issue #21)
// ======================================================================================
type CameraSetting = CameraSettingConfig & ConfigItem;

const cameraFormDef = CONFIG_FORM_DEFS.camera_settings;
assert.ok(cameraFormDef, "camera_settings must have a registered ConfigItemFormDef (issue #21)");

const seedCameraSettings = CONFIG_SEEDS.camera_settings as CameraSetting[];
assert.equal(
  validateConfigBody("camera_settings", seedCameraSettings).length,
  0,
  "seeded camera settings must already be schema-valid (sanity check before mutating them below)",
);

// --- form def shape matches what the validator/seed actually expect ------------------
assert.equal(cameraFormDef.idKey, "cameraSettingId", "Camera setting identity field is CameraSettingConfig.cameraSettingId");
assert.equal(
  cameraFormDef.suggestIdFromKey,
  "cameraSettingName",
  "PRD story 14: id is suggested from the Camera setting name",
);
const cameraFieldKeys = cameraFormDef.fields.map((f) => f.key);
assert.deepEqual(
  cameraFieldKeys.sort(),
  [
    "cameraSettingName",
    "cameraIntent",
    "shotType",
    "framing",
    "angle",
    "cameraDistance",
    "lensFeel",
    "motionIntensity",
    "stability",
    "imageTranslation",
    "avoid",
    "recommendedModels",
    "scoringCriteria",
  ].sort(),
  "camera setting form must expose every CameraSettingConfig field besides the id (issue #21 acceptance)",
);
for (const key of [
  "cameraSettingName",
  "cameraIntent",
  "shotType",
  "framing",
  "angle",
  "cameraDistance",
  "lensFeel",
  "motionIntensity",
  "stability",
  "imageTranslation",
]) {
  assert.equal(cameraFormDef.fields.find((f) => f.key === key)?.required, true, `${key} is required on CameraSetting`);
}
for (const key of ["avoid", "recommendedModels", "scoringCriteria"]) {
  assert.equal(cameraFormDef.fields.find((f) => f.key === key)?.type, "stringList", `${key} is a list-valued field`);
}

// Every seed camera setting must actually populate the string fields the form renders.
for (const cam of seedCameraSettings) {
  for (const key of cameraFieldKeys) {
    const value = cam[key];
    if (Array.isArray(value)) {
      assert.ok(value.length > 0, `seed camera setting "${cam.cameraSettingId}" should have a non-empty ${key} list`);
    } else {
      assert.ok(typeof value === "string" && value, `seed camera setting "${cam.cameraSettingId}" should have a non-empty ${key}`);
    }
  }
}

// --- emptyItem() is a valid starting point for the create form ------------------------
{
  const empty = cameraFormDef.emptyItem();
  assert.equal(
    empty[cameraFormDef.idKey],
    "",
    "a brand-new camera setting starts with no id — the shell fills it in on create",
  );
  assert.deepEqual(empty.avoid, [], "list-valued fields start empty, not undefined");
  const filled = {
    ...empty,
    cameraSettingId: "placeholder",
    cameraSettingName: "Placeholder",
    cameraIntent: "i",
    shotType: "s",
    framing: "f",
    angle: "a",
    cameraDistance: "d",
    lensFeel: "l",
    motionIntensity: "m",
    stability: "st",
    imageTranslation: "it",
  };
  assert.deepEqual(
    validateConfigBody("camera_settings", [filled]),
    [],
    "emptyItem() plus an id and required fields must be a schema-valid camera setting",
  );
}

// --- add: suggested id, exercised against the real seed -------------------------------
{
  const draft = { ...cameraFormDef.emptyItem(), cameraSettingName: "Drone Flyover" };
  const suggested = suggestUniqueConfigId(seedCameraSettings, cameraFormDef.idKey, suggestConfigId(draft.cameraSettingName));
  assert.equal(suggested, "drone-flyover");
  assert.equal(isDuplicateConfigId(seedCameraSettings, cameraFormDef.idKey, suggested), false);

  const newCam = {
    ...draft,
    cameraSettingId: suggested,
    cameraIntent: "i",
    shotType: "s",
    framing: "f",
    angle: "a",
    cameraDistance: "d",
    lensFeel: "l",
    motionIntensity: "m",
    stability: "st",
    imageTranslation: "it",
  } as CameraSetting;
  const withNewCam = addConfigItem(seedCameraSettings, newCam);
  assert.equal(withNewCam.length, seedCameraSettings.length + 1);
  assert.deepEqual(
    validateConfigBody("camera_settings", withNewCam),
    [],
    "adding a camera setting with a suggested id and required fields must stay schema-valid",
  );

  // Missing required fields must be rejected — issue #21 "Validation rejects malformed
  // Preset bodies and shows actionable errors".
  const missingFields = addConfigItem(seedCameraSettings, {
    cameraSettingId: "incomplete",
    cameraSettingName: "Incomplete",
  } as CameraSetting);
  assert.ok(
    validateConfigBody("camera_settings", missingFields).length > 0,
    "a camera setting missing required fields must fail validation",
  );
}

// --- edit: string fields update without touching id -----------------------------------
{
  const target = seedCameraSettings[0];
  const patch = { cameraIntent: "Updated camera intent", framing: "Updated framing" };
  const updated = updateConfigItem(seedCameraSettings, cameraFormDef.idKey, target.cameraSettingId, patch);
  const updatedCam = updated.find((c) => c.cameraSettingId === target.cameraSettingId);
  assert.equal(updatedCam?.cameraIntent, patch.cameraIntent);
  assert.equal(updatedCam?.framing, patch.framing);
  assert.equal(updated.length, seedCameraSettings.length, "editing never changes the item count");
  assert.deepEqual(
    validateConfigBody("camera_settings", updated),
    [],
    "an edited camera setting list must stay schema-valid",
  );

  // Story 15 / ADR 0001: id in the patch must never win, even against real seed data.
  const tampered = updateConfigItem(seedCameraSettings, cameraFormDef.idKey, target.cameraSettingId, {
    cameraSettingId: "hijacked",
    cameraIntent: "x",
  } as Partial<CameraSetting>);
  assert.equal(
    tampered.some((c) => c.cameraSettingId === "hijacked"),
    false,
    "editing a seeded camera setting can never change its id",
  );
}

// --- list-valued field CRUD: add/edit/remove/reorder within a single item's array -----
{
  const target = seedCameraSettings[0];
  assert.ok(
    target.recommendedModels.length >= 2,
    "locked_tripod_studio seed needs at least 2 `recommendedModels` entries to exercise reorder",
  );

  const withAddedModel = addListEntry(target.recommendedModels, "flux-2-pro-edit");
  const afterAdd = updateConfigItem(seedCameraSettings, cameraFormDef.idKey, target.cameraSettingId, {
    recommendedModels: withAddedModel,
  });
  assert.equal(
    afterAdd.find((c) => c.cameraSettingId === target.cameraSettingId)?.recommendedModels.length,
    target.recommendedModels.length + 1,
  );
  assert.deepEqual(
    validateConfigBody("camera_settings", afterAdd),
    [],
    "adding a recommendedModels entry must stay schema-valid",
  );

  const withEditedModel = updateListEntry(target.recommendedModels, 0, "gpt-image-2-edit-v2");
  assert.equal(withEditedModel[0], "gpt-image-2-edit-v2");
  assert.equal(
    target.recommendedModels[0],
    "gpt-image-2-edit",
    "editing a list entry must not mutate the original array",
  );

  const withRemovedModel = removeListEntry(target.recommendedModels, 0);
  assert.equal(withRemovedModel.length, target.recommendedModels.length - 1);
  assert.deepEqual(withRemovedModel, target.recommendedModels.slice(1), "removing index 0 drops only the first entry");

  const reordered = moveConfigItem(target.recommendedModels, 0, target.recommendedModels.length - 1);
  assert.equal(
    reordered[reordered.length - 1],
    target.recommendedModels[0],
    "reorder moves the entry to the requested position",
  );
  assert.equal(reordered.length, target.recommendedModels.length, "reorder never changes the entry count");
}

// --- delete: removes from the next version, list stays schema-valid ------------------
{
  const target = seedCameraSettings[seedCameraSettings.length - 1];
  const deleted = deleteConfigItem(seedCameraSettings, cameraFormDef.idKey, target.cameraSettingId);
  assert.equal(deleted.length, seedCameraSettings.length - 1);
  assert.equal(
    deleted.some((c) => c.cameraSettingId === target.cameraSettingId),
    false,
  );
  assert.deepEqual(
    validateConfigBody("camera_settings", deleted),
    [],
    "the list after deleting a seeded camera setting must stay valid",
  );
}

// ======================================================================================
// lighting — standalone Lighting preset library, addable like Hooks/Styles
// ======================================================================================
type Lighting = LightingConfig & ConfigItem;

const lightingFormDef = CONFIG_FORM_DEFS.lighting;
assert.ok(lightingFormDef, "lighting must have a registered ConfigItemFormDef");

const seedLighting = CONFIG_SEEDS.lighting as Lighting[];
assert.equal(
  validateConfigBody("lighting", seedLighting).length,
  0,
  "seeded lighting presets must already be schema-valid (sanity check before mutating them below)",
);

assert.equal(lightingFormDef.idKey, "id", "Lighting identity field is LightingConfig.id");
assert.equal(lightingFormDef.suggestIdFromKey, "name", "id is suggested from the lighting preset name");
const lightingFieldKeys = lightingFormDef.fields.map((f) => f.key);
assert.deepEqual(
  lightingFieldKeys.sort(),
  ["name", "instruction"].sort(),
  "lighting form must expose name and instruction",
);
for (const key of ["name", "instruction"]) {
  assert.equal(lightingFormDef.fields.find((f) => f.key === key)?.required, true, `${key} is required on Lighting`);
}

for (const preset of seedLighting) {
  for (const key of lightingFieldKeys) {
    assert.ok(
      typeof preset[key] === "string" && preset[key],
      `seed lighting preset "${preset.id}" should have a non-empty ${key} for the form to demonstrate editing it`,
    );
  }
}

// --- add: suggested id, exercised against the real seed -------------------------------
{
  const empty = lightingFormDef.emptyItem();
  assert.equal(empty[lightingFormDef.idKey], "", "a brand-new lighting preset starts with no id");

  const draft = { ...empty, name: "Rim Light", instruction: "Strong backlight rim, subject silhouetted at the edges." };
  const suggested = suggestUniqueConfigId(seedLighting, lightingFormDef.idKey, suggestConfigId(draft.name));
  assert.equal(suggested, "rim-light");
  assert.equal(isDuplicateConfigId(seedLighting, lightingFormDef.idKey, suggested), false);

  const withNewPreset = addConfigItem(seedLighting, { ...draft, id: suggested } as Lighting);
  assert.equal(withNewPreset.length, seedLighting.length + 1);
  assert.deepEqual(
    validateConfigBody("lighting", withNewPreset),
    [],
    "adding a lighting preset with a suggested id and required fields must stay schema-valid",
  );

  const missingInstruction = addConfigItem(seedLighting, { id: "incomplete", name: "Incomplete" } as Lighting);
  assert.ok(
    validateConfigBody("lighting", missingInstruction).length > 0,
    "a lighting preset missing instruction must fail validation",
  );
}

// --- edit: name/instruction update without touching id --------------------------------
{
  const target = seedLighting[0];
  const patch = { name: "Updated name", instruction: "Updated instruction" };
  const updated = updateConfigItem(seedLighting, lightingFormDef.idKey, target.id, patch);
  const updatedPreset = updated.find((p) => p.id === target.id);
  assert.equal(updatedPreset?.name, patch.name);
  assert.equal(updatedPreset?.instruction, patch.instruction);
  assert.equal(updated.length, seedLighting.length, "editing never changes the item count");
  assert.deepEqual(validateConfigBody("lighting", updated), [], "an edited lighting list must stay schema-valid");

  const tampered = updateConfigItem(seedLighting, lightingFormDef.idKey, target.id, {
    id: "hijacked",
    name: "x",
  } as Partial<Lighting>);
  assert.equal(
    tampered.some((p) => p.id === "hijacked"),
    false,
    "editing a seeded lighting preset can never change its id",
  );
}

// --- delete: removes from the next version, list stays schema-valid ------------------
{
  const target = seedLighting[seedLighting.length - 1];
  const deleted = deleteConfigItem(seedLighting, lightingFormDef.idKey, target.id);
  assert.equal(deleted.length, seedLighting.length - 1);
  assert.equal(
    deleted.some((p) => p.id === target.id),
    false,
  );
  assert.deepEqual(validateConfigBody("lighting", deleted), [], "the list after deleting a seeded lighting preset must stay valid");
}

// ======================================================================================
// global_rules (issue #22)
// ======================================================================================
type GlobalRule = GlobalRuleConfig & ConfigItem;

const globalRuleFormDef = CONFIG_FORM_DEFS.global_rules;
assert.ok(globalRuleFormDef, "global_rules must have a registered ConfigItemFormDef (issue #22)");

const seedGlobalRules = CONFIG_SEEDS.global_rules as GlobalRule[];
assert.equal(
  validateConfigBody("global_rules", seedGlobalRules).length,
  0,
  "seeded global rules must already be schema-valid (sanity check before mutating them below)",
);

assert.equal(globalRuleFormDef.idKey, "id", "Global rule identity field is GlobalRuleConfig.id");
assert.equal(globalRuleFormDef.suggestIdFromKey, "name", "PRD story 14: id is suggested from the rule name");
const globalRuleFieldKeys = globalRuleFormDef.fields.map((f) => f.key);
assert.deepEqual(
  globalRuleFieldKeys.sort(),
  ["name", "description"].sort(),
  "global rule form must expose name and description (issue #22 acceptance)",
);
for (const key of ["name", "description"]) {
  assert.equal(globalRuleFormDef.fields.find((f) => f.key === key)?.required, true, `${key} is required on GlobalRule`);
}

for (const rule of seedGlobalRules) {
  for (const key of globalRuleFieldKeys) {
    assert.ok(
      typeof rule[key] === "string" && rule[key],
      `seed global rule "${rule.id}" should have a non-empty ${key} for the form to demonstrate editing it`,
    );
  }
}

// --- add: suggested id, exercised against the real seed -------------------------------
{
  const empty = globalRuleFormDef.emptyItem();
  assert.equal(empty[globalRuleFormDef.idKey], "", "a brand-new rule starts with no id");

  const draft = { ...empty, name: "Packaging claims", description: "Check regulated packaging claims." };
  const suggested = suggestUniqueConfigId(seedGlobalRules, globalRuleFormDef.idKey, suggestConfigId(draft.name));
  assert.equal(suggested, "packaging-claims");
  assert.equal(isDuplicateConfigId(seedGlobalRules, globalRuleFormDef.idKey, suggested), false);

  const withNewRule = addConfigItem(seedGlobalRules, { ...draft, id: suggested } as GlobalRule);
  assert.equal(withNewRule.length, seedGlobalRules.length + 1);
  assert.deepEqual(
    validateConfigBody("global_rules", withNewRule),
    [],
    "adding a global rule with a suggested id and required fields must stay schema-valid",
  );

  // issue #22 acceptance: "Validation rejects malformed bodies and shows actionable
  // errors."
  const missingDescription = addConfigItem(seedGlobalRules, { id: "incomplete", name: "Incomplete" } as GlobalRule);
  assert.ok(
    validateConfigBody("global_rules", missingDescription).length > 0,
    "a global rule missing description must fail validation",
  );
}

// --- edit: name/description update without touching id -------------------------------
{
  const target = seedGlobalRules[0];
  const patch = { name: "Updated name", description: "Updated description" };
  const updated = updateConfigItem(seedGlobalRules, globalRuleFormDef.idKey, target.id, patch);
  const updatedRule = updated.find((r) => r.id === target.id);
  assert.equal(updatedRule?.name, patch.name);
  assert.equal(updatedRule?.description, patch.description);
  assert.equal(updated.length, seedGlobalRules.length, "editing never changes the item count");
  assert.deepEqual(validateConfigBody("global_rules", updated), [], "an edited global rule list must stay schema-valid");

  const tampered = updateConfigItem(seedGlobalRules, globalRuleFormDef.idKey, target.id, {
    id: "hijacked",
    name: "x",
  } as Partial<GlobalRule>);
  assert.equal(
    tampered.some((r) => r.id === "hijacked"),
    false,
    "editing a seeded global rule can never change its id",
  );
}

// --- delete: removes from the next version, list stays schema-valid ------------------
{
  const target = seedGlobalRules[seedGlobalRules.length - 1];
  const deleted = deleteConfigItem(seedGlobalRules, globalRuleFormDef.idKey, target.id);
  assert.equal(deleted.length, seedGlobalRules.length - 1);
  assert.equal(
    deleted.some((r) => r.id === target.id),
    false,
  );
  assert.deepEqual(
    validateConfigBody("global_rules", deleted),
    [],
    "the list after deleting a seeded global rule must stay valid",
  );
}

// ======================================================================================
// priority_logic (issue #22) — the one kind whose body isn't itself the item array
// ======================================================================================
const priorityFormDef = CONFIG_FORM_DEFS.priority_logic;
assert.ok(priorityFormDef, "priority_logic must have a registered ConfigItemFormDef (issue #22)");
assert.equal(priorityFormDef.reorderable, true, "priority_logic layers must support reordering (ADR 0001)");

const seedPriorityLogic = CONFIG_SEEDS.priority_logic as PriorityLogicConfig;
assert.equal(
  validateConfigBody("priority_logic", seedPriorityLogic).length,
  0,
  "seeded priority_logic must already be schema-valid (sanity check before mutating it below)",
);

assert.equal(priorityFormDef.idKey, "id", "Priority layer identity field is the layer's id");
assert.equal(priorityFormDef.suggestIdFromKey, "label", "PRD story 14: id is suggested from the layer label");
assert.deepEqual(
  priorityFormDef.fields.map((f) => f.key),
  ["label"],
  "priority layer form exposes just the label — id is the identity field",
);

// --- itemsFromBody / bodyFromItems round-trip the `{ layers: [...] }` wrapper --------
{
  const extracted = extractFormItems(priorityFormDef, seedPriorityLogic);
  assert.ok(extracted, "extractFormItems must unwrap priority_logic's `layers` array");
  assert.deepEqual(extracted, seedPriorityLogic.layers, "extracted items are exactly the seeded layers");
  assert.deepEqual(
    buildFormBody(priorityFormDef, extracted!),
    seedPriorityLogic,
    "bodyFromItems must rebuild the exact `{ layers: [...] }` shape extractFormItems unwrapped",
  );

  assert.equal(
    extractFormItems(priorityFormDef, { notLayers: [] }),
    null,
    "extractFormItems returns null for a body that doesn't have a `layers` array",
  );
  assert.equal(extractFormItems(priorityFormDef, ["a", "b"]), null, "a bare array is not priority_logic's body shape");
}

// --- add: suggested id, exercised against the real seed -------------------------------
{
  const layers = seedPriorityLogic.layers as (ConfigItem & { id: string; label: string })[];
  const empty = priorityFormDef.emptyItem();
  assert.equal(empty[priorityFormDef.idKey], "", "a brand-new layer starts with no id");

  const draft = { ...empty, label: "Operator override" };
  const suggested = suggestUniqueConfigId(layers, priorityFormDef.idKey, suggestConfigId(draft.label));
  assert.equal(suggested, "operator-override");
  assert.equal(isDuplicateConfigId(layers, priorityFormDef.idKey, suggested), false);

  const withNewLayer = addConfigItem(layers, { ...draft, id: suggested });
  assert.equal(withNewLayer.length, layers.length + 1);
  assert.deepEqual(
    validateConfigBody("priority_logic", buildFormBody(priorityFormDef, withNewLayer)),
    [],
    "adding a layer, rewrapped into the `layers` body, must stay schema-valid",
  );
}

// --- edit: renaming a layer's label without touching its id --------------------------
{
  const layers = seedPriorityLogic.layers as (ConfigItem & { id: string; label: string })[];
  const target = layers[0];
  const renamed = updateConfigItem(layers, priorityFormDef.idKey, target.id, { label: "Renamed layer" });
  assert.equal(renamed.find((l) => l.id === target.id)?.label, "Renamed layer");
  assert.equal(renamed.length, layers.length, "renaming never changes the layer count");
  assert.deepEqual(
    validateConfigBody("priority_logic", buildFormBody(priorityFormDef, renamed)),
    [],
    "a renamed-layer body must stay schema-valid",
  );

  const tampered = updateConfigItem(layers, priorityFormDef.idKey, target.id, {
    id: "hijacked",
    label: "x",
  } as Partial<ConfigItem>);
  assert.equal(
    tampered.some((l) => l.id === "hijacked"),
    false,
    "renaming a seeded layer can never change its id",
  );
}

// --- reorder: full CRUD acceptance includes moving layers (ADR 0001) -----------------
{
  const layers = seedPriorityLogic.layers as (ConfigItem & { id: string; label: string })[];
  assert.ok(layers.length >= 2, "seed needs at least 2 layers to exercise reorder");

  const reordered = moveConfigItem(layers, 0, layers.length - 1);
  assert.equal(reordered[reordered.length - 1].id, layers[0].id, "reorder moves the layer to the requested position");
  assert.equal(reordered.length, layers.length, "reorder never changes the layer count");
  assert.deepEqual(
    validateConfigBody("priority_logic", buildFormBody(priorityFormDef, reordered)),
    [],
    "a reordered-layers body must stay schema-valid",
  );
}

// --- delete: removing a layer down to the schema's minimum is rejected ---------------
{
  const layers = seedPriorityLogic.layers as (ConfigItem & { id: string; label: string })[];
  const target = layers[layers.length - 1];
  const deleted = deleteConfigItem(layers, priorityFormDef.idKey, target.id);
  assert.equal(deleted.length, layers.length - 1);
  assert.deepEqual(
    validateConfigBody("priority_logic", buildFormBody(priorityFormDef, deleted)),
    [],
    "deleting one of several layers must stay schema-valid",
  );

  // configSchemas.ts's validatePriorityLogic requires a non-empty `layers` array —
  // deleting down to zero must be caught by the same validator the save button runs,
  // not silently accepted.
  assert.ok(
    validateConfigBody("priority_logic", buildFormBody(priorityFormDef, [])).length > 0,
    "an empty layers body must fail validation (issue #22 acceptance: malformed bodies are rejected)",
  );
}

// ======================================================================================
// model_capability_matrix (issue #22)
// ======================================================================================
type ModelCapability = ModelCapabilityEntry & ConfigItem;

const capabilityFormDef = CONFIG_FORM_DEFS.model_capability_matrix;
assert.ok(capabilityFormDef, "model_capability_matrix must have a registered ConfigItemFormDef (issue #22)");

const seedCapabilities = CONFIG_SEEDS.model_capability_matrix as ModelCapability[];
assert.equal(
  validateConfigBody("model_capability_matrix", seedCapabilities).length,
  0,
  "seeded model capability matrix must already be schema-valid (sanity check before mutating it below)",
);
assert.ok(seedCapabilities.length >= 1, "seed needs at least one model capability entry to exercise edit/delete");

assert.equal(capabilityFormDef.idKey, "modelKey", "Model capability identity field is ModelCapabilityEntry.modelKey");
const capabilityFieldKeys = capabilityFormDef.fields.map((f) => f.key);
assert.deepEqual(
  capabilityFieldKeys.sort(),
  ["modelId", "modelLabel", "supportsNegativePrompt", "supportsSeed", "supportsMultiImage", "maxInputImages", "notes"].sort(),
  "model capability form must expose every ModelCapabilityEntry field besides the id (issue #22 acceptance)",
);
assert.equal(capabilityFormDef.fields.find((f) => f.key === "maxInputImages")?.type, "number", "maxInputImages is a numeric field");
for (const key of ["supportsNegativePrompt", "supportsSeed", "supportsMultiImage"]) {
  assert.equal(capabilityFormDef.fields.find((f) => f.key === key)?.type, "boolean", `${key} is a boolean field`);
}
for (const key of ["modelId", "modelLabel"]) {
  assert.equal(capabilityFormDef.fields.find((f) => f.key === key)?.type, "text", `${key} is a text field`);
}

// --- emptyItem() is a valid starting point for the create form ------------------------
{
  const empty = capabilityFormDef.emptyItem();
  assert.equal(empty[capabilityFormDef.idKey], "", "a brand-new entry starts with no id");
  assert.equal(empty.supportsNegativePrompt, false, "boolean fields default to false, not undefined");
  assert.equal(empty.maxInputImages, 0, "numeric fields default to a real number, not undefined");
  const filled = { ...empty, modelKey: "placeholder", modelId: "placeholder-v1", modelLabel: "Placeholder" };
  assert.deepEqual(
    validateConfigBody("model_capability_matrix", [filled]),
    [],
    "emptyItem() plus an id and required text fields must be a schema-valid entry",
  );
}

// --- add: suggested id, boolean/numeric fields carried through unchanged -------------
{
  const draft = {
    ...capabilityFormDef.emptyItem(),
    modelId: "new-model-v1",
    modelLabel: "New Model",
    supportsNegativePrompt: true,
    supportsSeed: true,
    maxInputImages: 4,
    supportsMultiImage: true,
  };
  const suggested = suggestUniqueConfigId(seedCapabilities, capabilityFormDef.idKey, suggestConfigId(draft.modelLabel));
  assert.equal(suggested, "new-model");
  assert.equal(isDuplicateConfigId(seedCapabilities, capabilityFormDef.idKey, suggested), false);

  const withNewEntry = addConfigItem(seedCapabilities, { ...draft, modelKey: suggested } as ModelCapability);
  assert.equal(withNewEntry.length, seedCapabilities.length + 1);
  const added = withNewEntry.find((e) => e.modelKey === suggested);
  assert.equal(added?.supportsNegativePrompt, true, "boolean field value is preserved on add");
  assert.equal(added?.maxInputImages, 4, "numeric field value is preserved on add");
  assert.deepEqual(
    validateConfigBody("model_capability_matrix", withNewEntry),
    [],
    "adding a capability entry with required fields must stay schema-valid",
  );

  // issue #22 acceptance: "Validation rejects malformed bodies and shows actionable
  // errors" — a non-boolean in a boolean field, or a negative maxInputImages, must fail.
  const badBoolean = addConfigItem(seedCapabilities, {
    ...draft,
    modelKey: "bad-boolean",
    supportsNegativePrompt: "yes",
  } as unknown as ModelCapability);
  assert.ok(
    validateConfigBody("model_capability_matrix", badBoolean).length > 0,
    "a non-boolean value in a boolean field must fail validation",
  );

  const negativeMax = addConfigItem(seedCapabilities, {
    ...draft,
    modelKey: "bad-max",
    maxInputImages: -1,
  } as ModelCapability);
  assert.ok(
    validateConfigBody("model_capability_matrix", negativeMax).length > 0,
    "a negative maxInputImages must fail validation",
  );
}

// --- edit: text/boolean/numeric fields update without touching id --------------------
{
  const target = seedCapabilities[0];
  const patch = { modelLabel: "Updated label", supportsSeed: !target.supportsSeed, maxInputImages: 9 };
  const updated = updateConfigItem(seedCapabilities, capabilityFormDef.idKey, target.modelKey, patch);
  const updatedEntry = updated.find((e) => e.modelKey === target.modelKey);
  assert.equal(updatedEntry?.modelLabel, patch.modelLabel);
  assert.equal(updatedEntry?.supportsSeed, patch.supportsSeed);
  assert.equal(updatedEntry?.maxInputImages, patch.maxInputImages);
  assert.equal(updated.length, seedCapabilities.length, "editing never changes the item count");
  assert.deepEqual(
    validateConfigBody("model_capability_matrix", updated),
    [],
    "an edited model capability matrix must stay schema-valid",
  );

  const tampered = updateConfigItem(seedCapabilities, capabilityFormDef.idKey, target.modelKey, {
    modelKey: "hijacked",
    modelLabel: "x",
  } as Partial<ModelCapability>);
  assert.equal(
    tampered.some((e) => e.modelKey === "hijacked"),
    false,
    "editing a seeded model capability entry can never change its id",
  );
}

// --- delete: removes from the next version, list stays schema-valid ------------------
{
  const target = seedCapabilities[seedCapabilities.length - 1];
  const deleted = deleteConfigItem(seedCapabilities, capabilityFormDef.idKey, target.modelKey);
  assert.equal(deleted.length, seedCapabilities.length - 1);
  assert.equal(
    deleted.some((e) => e.modelKey === target.modelKey),
    false,
  );
  assert.deepEqual(
    validateConfigBody("model_capability_matrix", deleted),
    [],
    "the list after deleting a seeded model capability entry must stay valid",
  );
}

console.log("lib/maszynka/configFormDefs.check.ts — all checks passed");
