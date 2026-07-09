// Field-definition model for the shared Config form editor shell (issue #18). Each
// registered Config kind maps to a `ConfigItemFormDef`: which field is the item's
// identity (read-only after creation — ADR 0001 / PRD story 15), what fields the form
// renders, and how a new item's id is suggested from free text (PRD story 14). The
// shell component (app/MaszynkaConfigs.tsx) is generic over this shape — it doesn't know
// about hooks/styles/cameras individually, only how to render `ConfigFieldDef[]` and run
// the CRUD helpers in configItemCrud.ts.
//
// Issue #18 wired exactly one Config kind — `hooks`, the simplest shape — end to end as
// a concrete proof the shell works: a flat array of objects with flat string fields and
// one id key. Issue #21 extends the model with a `stringList` field type (add/edit/
// remove/reorder entries within a single item, backed by configItemCrud.ts's
// addListEntry/updateListEntry/removeListEntry/moveConfigItem) and registers `styles` and
// `camera_settings`, both of which carry three string-array fields (avoid,
// recommendedModels, scoringCriteria — see configSchemas.ts).
//
// Issue #22 adds `boolean`/`number` field types (for `model_capability_matrix`'s
// supports*/maxInputImages fields), a `reorderable` flag so the shell renders move-up/
// move-down controls for a kind's top-level items (`priority_logic` layers — ADR 0001:
// "full CRUD ... including adding, removing, renaming, and reordering layers" — reusing
// the same generic `moveConfigItem` the `stringList` field already uses for
// in-item reordering), and `itemsFromBody`/`bodyFromItems` so a kind whose body isn't
// itself the item array (`priority_logic`'s body is `{ layers: [...] }`, not a bare
// array — configSchemas.ts) can still plug into the shell, which otherwise assumes
// `body === items`. `stage_prompts`' non-item-list body still falls back to raw JSON —
// tracked for #23.
import type { ConfigKind } from "./configSchemas";
import type { ConfigItem } from "./configItemCrud";

export type ConfigFieldType = "text" | "textarea" | "stringList" | "boolean" | "number";

export interface ConfigFieldDef {
  /** Property name on the item, e.g. "text" or "placementGuidance". */
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  /** `stringList` fields only: singular noun for one entry (e.g. "avoid entry"), used in
   *  the "no entries yet" / "add entry" / delete-confirmation copy. Falls back to a
   *  generic "entry" if omitted. */
  entryLabel?: string;
}

// Not generic over the item type: the shell (app/MaszynkaConfigs.tsx) always operates on
// plain `ConfigItem` JSON objects (it round-trips them straight to/from the append-only
// save endpoint), so a form def is a recipe for rendering/creating *some* ConfigItem
// shape rather than a type-checked view of e.g. HookConfig specifically.
export interface ConfigItemFormDef {
  /** Singular display name used in labels/confirmations, e.g. "Hook". */
  itemLabel: string;
  /** Property name that identifies an item within the kind's array body. */
  idKey: string;
  idFieldLabel: string;
  /** Non-id fields rendered by the generic form. */
  fields: ConfigFieldDef[];
  /** A brand-new item before the operator fills anything in (id populated by caller). */
  emptyItem: () => ConfigItem;
  /** Field key whose current value seeds the suggested id text (PRD story 14). */
  suggestIdFromKey: string;
  /** When true, the shell renders move-up/move-down controls on each top-level item row
   *  (backed by `moveConfigItem` from configItemCrud.ts) — for kinds with an
   *  operator-defined order, currently just `priority_logic`. Defaults to false: most
   *  kinds (hooks, styles, ...) have no meaningful order. */
  reorderable?: boolean;
  /** Extract the editable item array from the kind's raw Config body. Only needed when
   *  the body isn't itself the item array — e.g. `priority_logic`'s
   *  `{ layers: [...] }` wrapper (configSchemas.ts). Returns null if `body` doesn't have
   *  the expected shape (caller falls back to the raw JSON editor). Defaults to
   *  "body is the array" when omitted. */
  itemsFromBody?: (body: unknown) => ConfigItem[] | null;
  /** Inverse of `itemsFromBody`: rebuild the full Config body from the edited item array.
   *  Defaults to "items are the body" when omitted. */
  bodyFromItems?: (items: ConfigItem[]) => unknown;
}

/** `itemsFromBody`, applied uniformly whether or not a form def overrides it — kinds that
 *  don't need the object wrapper (hooks, styles, camera_settings, global_rules,
 *  model_capability_matrix) just have their array body pass through unchanged. */
export function extractFormItems(formDef: ConfigItemFormDef, body: unknown): ConfigItem[] | null {
  if (formDef.itemsFromBody) return formDef.itemsFromBody(body);
  return Array.isArray(body) ? (body as ConfigItem[]) : null;
}

/** Inverse of `extractFormItems` — always use this (not `formDef.bodyFromItems` directly)
 *  so callers get the "items are the body" default for free. */
export function buildFormBody(formDef: ConfigItemFormDef, items: ConfigItem[]): unknown {
  return formDef.bodyFromItems ? formDef.bodyFromItems(items) : items;
}

const HOOK_FORM_DEF: ConfigItemFormDef = {
  itemLabel: "Hook",
  idKey: "id",
  idFieldLabel: "ID",
  fields: [
    { key: "text", label: "Hook text", type: "textarea", required: true },
    { key: "placementGuidance", label: "Placement guidance", type: "text" },
    { key: "toneGuidance", label: "Tone guidance", type: "text" },
  ],
  emptyItem: (): ConfigItem => ({ id: "", text: "", placementGuidance: "", toneGuidance: "" }),
  suggestIdFromKey: "text",
};

// Shared by styles and camera_settings — both StyleConfig and CameraSettingConfig
// (configSchemas.ts) end in the same three string-array fields with the same validation
// rule (must be arrays of strings, may be empty).
const AVOID_MODELS_SCORING_FIELDS: ConfigFieldDef[] = [
  { key: "avoid", label: "Avoid", type: "stringList", entryLabel: "avoid entry" },
  { key: "recommendedModels", label: "Recommended models", type: "stringList", entryLabel: "recommended model" },
  { key: "scoringCriteria", label: "Scoring criteria", type: "stringList", entryLabel: "scoring criterion" },
];

const STYLE_FORM_DEF: ConfigItemFormDef = {
  itemLabel: "Style",
  idKey: "styleId",
  idFieldLabel: "Style ID",
  fields: [
    { key: "styleName", label: "Style name", type: "text", required: true },
    { key: "visualIntent", label: "Visual intent", type: "textarea", required: true },
    { key: "lighting", label: "Lighting", type: "textarea", required: true },
    { key: "colorDirection", label: "Color direction", type: "textarea", required: true },
    { key: "compositionBias", label: "Composition bias", type: "textarea", required: true },
    { key: "typographyBehavior", label: "Typography behavior", type: "textarea", required: true },
    ...AVOID_MODELS_SCORING_FIELDS,
  ],
  emptyItem: (): ConfigItem => ({
    styleId: "",
    styleName: "",
    visualIntent: "",
    lighting: "",
    colorDirection: "",
    compositionBias: "",
    typographyBehavior: "",
    avoid: [],
    recommendedModels: [],
    scoringCriteria: [],
  }),
  suggestIdFromKey: "styleName",
};

const CAMERA_SETTING_FORM_DEF: ConfigItemFormDef = {
  itemLabel: "Camera setting",
  idKey: "cameraSettingId",
  idFieldLabel: "Camera setting ID",
  fields: [
    { key: "cameraSettingName", label: "Camera setting name", type: "text", required: true },
    { key: "cameraIntent", label: "Camera intent", type: "textarea", required: true },
    { key: "shotType", label: "Shot type", type: "text", required: true },
    { key: "framing", label: "Framing", type: "textarea", required: true },
    { key: "angle", label: "Angle", type: "text", required: true },
    { key: "cameraDistance", label: "Camera distance", type: "text", required: true },
    { key: "lensFeel", label: "Lens feel", type: "textarea", required: true },
    { key: "motionIntensity", label: "Motion intensity", type: "text", required: true },
    { key: "stability", label: "Stability", type: "text", required: true },
    { key: "imageTranslation", label: "Image translation", type: "textarea", required: true },
    ...AVOID_MODELS_SCORING_FIELDS,
  ],
  emptyItem: (): ConfigItem => ({
    cameraSettingId: "",
    cameraSettingName: "",
    cameraIntent: "",
    shotType: "",
    framing: "",
    angle: "",
    cameraDistance: "",
    lensFeel: "",
    motionIntensity: "",
    stability: "",
    imageTranslation: "",
    avoid: [],
    recommendedModels: [],
    scoringCriteria: [],
  }),
  suggestIdFromKey: "cameraSettingName",
};

// GlobalRuleConfig (configSchemas.ts) is the same flat id/name/description shape as
// HookConfig — issue #22 "Global rules can be added, edited, and deleted through
// structured fields."
const GLOBAL_RULE_FORM_DEF: ConfigItemFormDef = {
  itemLabel: "Global rule",
  idKey: "id",
  idFieldLabel: "ID",
  fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "description", label: "Description", type: "textarea", required: true },
  ],
  emptyItem: (): ConfigItem => ({ id: "", name: "", description: "" }),
  suggestIdFromKey: "name",
};

function hasLayersArray(body: unknown): body is { layers: unknown[] } {
  return typeof body === "object" && body !== null && !Array.isArray(body) && Array.isArray((body as { layers?: unknown }).layers);
}

// PriorityLogicConfig's body is `{ layers: [{ id, label }] }` (configSchemas.ts) — not a
// bare array like every other kind registered here — so this is the one form def that
// needs `itemsFromBody`/`bodyFromItems` to plug the `layers` array into the shell's
// generic item-array editor. `reorderable: true` is what ADR 0001 / issue #22 call "full
// CRUD ... including adding, removing, renaming, and reordering layers" — the shell reuses
// `moveConfigItem` (configItemCrud.ts) against the top-level item list for this, the same
// helper `stringList` fields already use to reorder entries within one item.
const PRIORITY_LOGIC_FORM_DEF: ConfigItemFormDef = {
  itemLabel: "Priority layer",
  idKey: "id",
  idFieldLabel: "ID",
  fields: [{ key: "label", label: "Label", type: "text", required: true }],
  emptyItem: (): ConfigItem => ({ id: "", label: "" }),
  suggestIdFromKey: "label",
  reorderable: true,
  itemsFromBody: (body) => (hasLayersArray(body) ? (body.layers as ConfigItem[]) : null),
  bodyFromItems: (items) => ({ layers: items }),
};

// ModelCapabilityEntry (configSchemas.ts) is the first kind needing the `boolean`/
// `number` field types — issue #22 "Model capability entries can be added, edited, and
// deleted with appropriate text, boolean, and numeric controls."
const MODEL_CAPABILITY_FORM_DEF: ConfigItemFormDef = {
  itemLabel: "Model capability",
  idKey: "modelKey",
  idFieldLabel: "Model key",
  fields: [
    { key: "modelId", label: "Model ID", type: "text", required: true },
    { key: "modelLabel", label: "Model label", type: "text", required: true },
    { key: "supportsNegativePrompt", label: "Supports negative prompt", type: "boolean" },
    { key: "supportsSeed", label: "Supports seed", type: "boolean" },
    { key: "supportsMultiImage", label: "Supports multi-image", type: "boolean" },
    { key: "maxInputImages", label: "Max input images", type: "number", required: true },
    { key: "notes", label: "Notes", type: "textarea" },
  ],
  emptyItem: (): ConfigItem => ({
    modelKey: "",
    modelId: "",
    modelLabel: "",
    supportsNegativePrompt: false,
    supportsSeed: false,
    maxInputImages: 0,
    supportsMultiImage: false,
    notes: "",
  }),
  suggestIdFromKey: "modelLabel",
};

/** Config kinds with a registered structured-form definition. Kinds absent from this map
 *  fall back to the raw JSON editor until their slice (#23) adds a form def. */
export const CONFIG_FORM_DEFS: Partial<Record<ConfigKind, ConfigItemFormDef>> = {
  hooks: HOOK_FORM_DEF,
  styles: STYLE_FORM_DEF,
  camera_settings: CAMERA_SETTING_FORM_DEF,
  global_rules: GLOBAL_RULE_FORM_DEF,
  priority_logic: PRIORITY_LOGIC_FORM_DEF,
  model_capability_matrix: MODEL_CAPABILITY_FORM_DEF,
};
