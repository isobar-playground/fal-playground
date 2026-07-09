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
// recommendedModels, scoringCriteria — see configSchemas.ts). `model_capability_matrix`
// (boolean/number fields) and priority_logic's `{ layers: [...] }` wrapper-object body and
// stage_prompts' non-item-list body still fall back to raw JSON — tracked for #22/#23.
import type { ConfigKind } from "./configSchemas";
import type { ConfigItem } from "./configItemCrud";

export type ConfigFieldType = "text" | "textarea" | "stringList";

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

/** Config kinds with a registered structured-form definition. Kinds absent from this map
 *  fall back to the raw JSON editor until their slice (#22-#23) adds a form def. */
export const CONFIG_FORM_DEFS: Partial<Record<ConfigKind, ConfigItemFormDef>> = {
  hooks: HOOK_FORM_DEF,
  styles: STYLE_FORM_DEF,
  camera_settings: CAMERA_SETTING_FORM_DEF,
};
