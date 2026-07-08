// Config kinds + JSON body validators for Maszynka config storage (ADR 0001, PRD
// "Config kinds"). Pure, framework-free — no Neon/React import — so it can be shared by
// the API routes, the client editor (client-side pre-check before it even hits the
// network), and the runnable check (config.check.ts). Each kind's body shape follows
// `dump/Maszynka v2.0.md` sections 4-5 (styles/camera settings field structure) and
// CONTEXT.md (hook fields, priority logic as an ordered rank list).
//
// Deliberately hand-rolled instead of a schema library (ajv etc.) — six small, stable
// shapes don't earn a dependency; see PRD "Testing Decisions" / repo's no-over-
// engineering convention. If the Contract/stage schemas (next slice) grow much more
// complex, revisit.

export type ConfigKind =
  | "hooks"
  | "styles"
  | "camera_settings"
  | "global_rules"
  | "priority_logic"
  | "model_capability_matrix";

export const CONFIG_KINDS: ConfigKind[] = [
  "hooks",
  "styles",
  "camera_settings",
  "global_rules",
  "priority_logic",
  "model_capability_matrix",
];

export const CONFIG_KIND_LABELS: Record<ConfigKind, string> = {
  hooks: "Hooks",
  styles: "Styles",
  camera_settings: "Camera settings",
  global_rules: "Global rules",
  priority_logic: "Priority logic",
  model_capability_matrix: "Model capability matrix",
};

export function isConfigKind(v: string): v is ConfigKind {
  return (CONFIG_KINDS as string[]).includes(v);
}

// --- shared field checks ----------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Required non-empty-string fields, reported by key. */
function checkStringFields(item: Record<string, unknown>, keys: string[], path: string): string[] {
  return keys.filter((k) => !isNonEmptyString(item[k])).map((k) => `${path}.${k} must be a non-empty string`);
}
/** Required string-array fields (may be empty arrays, just must be arrays of strings). */
function checkStringArrayFields(item: Record<string, unknown>, keys: string[], path: string): string[] {
  return keys.filter((k) => !isStringArray(item[k])).map((k) => `${path}.${k} must be an array of strings`);
}

function checkUniqueIds(items: Record<string, unknown>[], idKey: string): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const item of items) {
    const id = item[idKey];
    if (typeof id !== "string") continue;
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return dupes.size ? [`duplicate ${idKey}: ${[...dupes].join(", ")}`] : [];
}

// --- per-kind validators -----------------------------------------------------

function validateHooks(body: unknown): string[] {
  if (!Array.isArray(body)) return ["body must be an array of hooks"];
  const errors: string[] = [];
  body.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`hooks[${i}] must be an object`);
      return;
    }
    errors.push(...checkStringFields(item, ["id", "text"], `hooks[${i}]`));
    for (const k of ["placementGuidance", "toneGuidance"]) {
      if (k in item && typeof item[k] !== "string") errors.push(`hooks[${i}].${k} must be a string`);
    }
  });
  errors.push(...checkUniqueIds(body.filter(isPlainObject), "id"));
  return errors;
}

const STYLE_STRING_FIELDS = [
  "styleId",
  "styleName",
  "visualIntent",
  "lighting",
  "colorDirection",
  "compositionBias",
  "typographyBehavior",
];
const STYLE_ARRAY_FIELDS = ["avoid", "recommendedModels", "scoringCriteria"];

function validateStyles(body: unknown): string[] {
  if (!Array.isArray(body)) return ["body must be an array of styles"];
  const errors: string[] = [];
  body.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`styles[${i}] must be an object`);
      return;
    }
    errors.push(...checkStringFields(item, STYLE_STRING_FIELDS, `styles[${i}]`));
    errors.push(...checkStringArrayFields(item, STYLE_ARRAY_FIELDS, `styles[${i}]`));
  });
  errors.push(...checkUniqueIds(body.filter(isPlainObject), "styleId"));
  return errors;
}

const CAMERA_STRING_FIELDS = [
  "cameraSettingId",
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
];
const CAMERA_ARRAY_FIELDS = ["avoid", "recommendedModels", "scoringCriteria"];

function validateCameraSettings(body: unknown): string[] {
  if (!Array.isArray(body)) return ["body must be an array of camera settings"];
  const errors: string[] = [];
  body.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`camera_settings[${i}] must be an object`);
      return;
    }
    errors.push(...checkStringFields(item, CAMERA_STRING_FIELDS, `camera_settings[${i}]`));
    errors.push(...checkStringArrayFields(item, CAMERA_ARRAY_FIELDS, `camera_settings[${i}]`));
  });
  errors.push(...checkUniqueIds(body.filter(isPlainObject), "cameraSettingId"));
  return errors;
}

function validateGlobalRules(body: unknown): string[] {
  if (!Array.isArray(body)) return ["body must be an array of global rules"];
  const errors: string[] = [];
  body.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`global_rules[${i}] must be an object`);
      return;
    }
    errors.push(...checkStringFields(item, ["id", "name", "description"], `global_rules[${i}]`));
  });
  errors.push(...checkUniqueIds(body.filter(isPlainObject), "id"));
  return errors;
}

function validatePriorityLogic(body: unknown): string[] {
  if (!isPlainObject(body)) return ["body must be an object with a `layers` array"];
  if (!Array.isArray(body.layers) || body.layers.length === 0) {
    return ["body.layers must be a non-empty array"];
  }
  const errors: string[] = [];
  body.layers.forEach((item: unknown, i: number) => {
    if (!isPlainObject(item)) {
      errors.push(`layers[${i}] must be an object`);
      return;
    }
    errors.push(...checkStringFields(item, ["id", "label"], `layers[${i}]`));
  });
  errors.push(...checkUniqueIds((body.layers as unknown[]).filter(isPlainObject), "id"));
  return errors;
}

const CAPABILITY_STRING_FIELDS = ["modelKey", "modelId", "modelLabel"];
const CAPABILITY_BOOLEAN_FIELDS = ["supportsNegativePrompt", "supportsSeed", "supportsMultiImage"];

function validateModelCapabilityMatrix(body: unknown): string[] {
  if (!Array.isArray(body)) return ["body must be an array of model capability entries"];
  const errors: string[] = [];
  body.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`model_capability_matrix[${i}] must be an object`);
      return;
    }
    errors.push(...checkStringFields(item, CAPABILITY_STRING_FIELDS, `model_capability_matrix[${i}]`));
    for (const k of CAPABILITY_BOOLEAN_FIELDS) {
      if (!isBoolean(item[k])) errors.push(`model_capability_matrix[${i}].${k} must be a boolean`);
    }
    if (!isFiniteNumber(item.maxInputImages) || item.maxInputImages < 0) {
      errors.push(`model_capability_matrix[${i}].maxInputImages must be a non-negative number`);
    }
    if ("notes" in item && typeof item.notes !== "string") {
      errors.push(`model_capability_matrix[${i}].notes must be a string`);
    }
  });
  errors.push(...checkUniqueIds(body.filter(isPlainObject), "modelKey"));
  return errors;
}

/** Validate a config body against its kind's shape. Empty array = valid. */
export function validateConfigBody(kind: ConfigKind, body: unknown): string[] {
  switch (kind) {
    case "hooks":
      return validateHooks(body);
    case "styles":
      return validateStyles(body);
    case "camera_settings":
      return validateCameraSettings(body);
    case "global_rules":
      return validateGlobalRules(body);
    case "priority_logic":
      return validatePriorityLogic(body);
    case "model_capability_matrix":
      return validateModelCapabilityMatrix(body);
  }
}
