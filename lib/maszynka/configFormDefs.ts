// Field-definition model for the shared Config form editor shell (issue #18). Each
// registered Config kind maps to a `ConfigItemFormDef`: which field is the item's
// identity (read-only after creation — ADR 0001 / PRD story 15), what fields the form
// renders, and how a new item's id is suggested from free text (PRD story 14). The
// shell component (app/MaszynkaConfigs.tsx) is generic over this shape — it doesn't know
// about hooks/styles/cameras individually, only how to render `ConfigFieldDef[]` and run
// the CRUD helpers in configItemCrud.ts.
//
// This slice (#18) wires exactly one Config kind — `hooks`, the simplest shape — end to
// end as a concrete proof the shell works. It's a genuine proof, not a full
// generalization yet: this model only covers a kind whose body *is* a flat array of
// objects with flat string fields and one id key. The other array-shaped kinds (styles,
// camera_settings, model_capability_matrix) need at least a string-array and/or
// boolean/number `ConfigFieldType` added before their form defs can plug in unchanged;
// priority_logic's body is `{ layers: [...] }` (an object wrapping the array, not the
// array itself) and stage_prompts has no id-keyed item list at all — both will likely
// need a small shell change (or a different editor entirely for stage_prompts, given its
// PRD-mandated restore behavior) rather than "just register a form def". Tracked for
// #20-#22; this file intentionally doesn't try to guess their shapes in advance.
import type { ConfigKind } from "./configSchemas";
import type { ConfigItem } from "./configItemCrud";

export type ConfigFieldType = "text" | "textarea";

export interface ConfigFieldDef {
  /** Property name on the item, e.g. "text" or "placementGuidance". */
  key: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
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

/** Config kinds with a registered structured-form definition. Kinds absent from this map
 *  fall back to the raw JSON editor until their slice (#20-#22) adds a form def. */
export const CONFIG_FORM_DEFS: Partial<Record<ConfigKind, ConfigItemFormDef>> = {
  hooks: HOOK_FORM_DEF,
};
