// Config kinds + JSON body validators for Maszynka config storage (ADR 0001, PRD
// "Config kinds"). Pure, framework-free — no Neon/React import — so it can be shared by
// the API routes, the client editor (client-side pre-check before it even hits the
// network), and the runnable check (config.check.ts). Each kind's body shape follows
// `dump/Maszynka v2.0.md` sections 4-5 (styles/camera settings field structure) and
// CONTEXT.md (hook fields, priority logic as an ordered rank list).
//
// Deliberately hand-rolled instead of a schema library (ajv etc.) — seven small, stable
// shapes don't earn a dependency; see PRD "Testing Decisions" / repo's no-over-
// engineering convention. If the Contract/stage schemas (next slice) grow much more
// complex, revisit.
//
// `stage_prompts` (docs/prd/0002-maszynka-form-configs-and-stage-prompts.md, issue #16)
// is the seventh kind: operator-editable instruction TEXT for the five LLM pipeline
// stages. LLM response schemas/validators stay in code (lib/maszynka/contentSafety.ts
// etc.) — only prompt text moves here.

export type ConfigKind =
  | "hooks"
  | "styles"
  | "camera_settings"
  | "lighting"
  | "global_rules"
  | "priority_logic"
  | "model_capability_matrix"
  | "stage_prompts";

export const CONFIG_KINDS: ConfigKind[] = [
  "hooks",
  "styles",
  "camera_settings",
  "lighting",
  "global_rules",
  "priority_logic",
  "model_capability_matrix",
  "stage_prompts",
];

export const CONFIG_KIND_LABELS: Record<ConfigKind, string> = {
  hooks: "Hooks",
  styles: "Styles",
  camera_settings: "Camera settings",
  lighting: "Lighting",
  global_rules: "Global rules",
  priority_logic: "Priority logic",
  model_capability_matrix: "Model capability matrix",
  stage_prompts: "Stage prompts",
};

export function isConfigKind(v: string): v is ConfigKind {
  return (CONFIG_KINDS as string[]).includes(v);
}

// --- body shapes --------------------------------------------------------------
// Typed views of each kind's JSON body, for callers that need real field access
// (dropdown labels, Contract assembly — see contract.ts) rather than just pass-through
// JSON storage. Kept in sync with the validators below by hand; contract.check.ts and
// config.check.ts both exercise the seed data against the validators, so a drift would
// surface there.

export interface HookConfig {
  id: string;
  text: string;
  placementGuidance?: string;
  toneGuidance?: string;
}

export interface StyleConfig {
  styleId: string;
  styleName: string;
  visualIntent: string;
  lighting: string;
  colorDirection: string;
  compositionBias: string;
  typographyBehavior: string;
  avoid: string[];
  recommendedModels: string[];
  scoringCriteria: string[];
}

export interface CameraSettingConfig {
  cameraSettingId: string;
  cameraSettingName: string;
  cameraIntent: string;
  shotType: string;
  framing: string;
  angle: string;
  cameraDistance: string;
  lensFeel: string;
  motionIntensity: string;
  stability: string;
  imageTranslation: string;
  avoid: string[];
  recommendedModels: string[];
  scoringCriteria: string[];
}

// A standalone Lighting preset library, alongside Hooks/Styles/Camera settings — same
// flat id/name/instruction shape as GlobalRuleConfig below (the simplest existing
// pattern), not the richer avoid/recommendedModels/scoringCriteria shape Styles/Camera
// settings carry, since nothing has asked for that yet (YAGNI — extend later if a real
// need for it shows up).
export interface LightingConfig {
  id: string;
  name: string;
  instruction: string;
}

export interface GlobalRuleConfig {
  id: string;
  name: string;
  description: string;
}

export interface PriorityLogicConfig {
  layers: { id: string; label: string }[];
}

export interface ModelCapabilityEntry {
  modelKey: string;
  modelId: string;
  modelLabel: string;
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  maxInputImages: number;
  supportsMultiImage: boolean;
  notes?: string;
}

// Duplicated from contract.ts's `AssetRole`/`ASSET_ROLES` rather than imported, so this
// module stays a zero-import leaf (see module header) and contract.ts can keep importing
// *from* configSchemas.ts without a cycle. Four fixed roles, unlikely to drift; if a fifth
// role is ever added both lists need updating together (contract.check.ts and
// config.check.ts would both fail if they desynced).
type StagePromptAssetRole = "packshot" | "style_reference" | "brand_reference" | "campaign_reference";
const STAGE_PROMPT_ASSET_ROLES: StagePromptAssetRole[] = [
  "packshot",
  "style_reference",
  "brand_reference",
  "campaign_reference",
];

/** `stage_prompts` config body (PRD "Add `stage_prompts` as a Config kind" / issue #16).
 *  Operator-editable instruction TEXT only for each LLM pipeline stage — response
 *  schemas, JSON Schema response formats and runtime validators stay in code (PRD
 *  "LLM response schemas and validators stay fixed in code"). `assetAnalysis` is shared
 *  base instructions plus one instruction block per Asset role (ADR 0001); `promptBuilder`
 *  carries its main prompt plus the revision-instruction template used for the one
 *  allowed rebuild after Prompt reviewer returns "revise". */
export interface StagePromptsConfig {
  contentSafety: { systemPrompt: string };
  assetAnalysis: {
    baseInstructions: string;
    roleInstructions: Record<StagePromptAssetRole, string>;
  };
  promptImprovement: { systemPrompt: string };
  promptBuilder: { systemPrompt: string; revisionInstructionTemplate: string };
  promptReviewer: { systemPrompt: string };
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
/** Required-but-blankable string fields: the key must be present and a string, but "" is
 *  allowed. Used only by `stage_prompts`, where a blank field means "use the stage
 *  module's code-owned default text" (see stagePromptResolver.ts's `textOrFallback`) —
 *  the only way an operator can hand a stage back to the code after overriding it. */
function checkTextFields(item: Record<string, unknown>, keys: string[], path: string): string[] {
  return keys.filter((k) => typeof item[k] !== "string").map((k) => `${path}.${k} must be a string`);
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

function validateLighting(body: unknown): string[] {
  if (!Array.isArray(body)) return ["body must be an array of lighting presets"];
  const errors: string[] = [];
  body.forEach((item, i) => {
    if (!isPlainObject(item)) {
      errors.push(`lighting[${i}] must be an object`);
      return;
    }
    errors.push(...checkStringFields(item, ["id", "name", "instruction"], `lighting[${i}]`));
  });
  errors.push(...checkUniqueIds(body.filter(isPlainObject), "id"));
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

function checkSystemPromptObject(value: unknown, path: string): string[] {
  if (!isPlainObject(value)) return [`${path} must be an object`];
  return checkTextFields(value, ["systemPrompt"], path);
}

function validateStagePrompts(body: unknown): string[] {
  if (!isPlainObject(body)) return ["body must be an object"];
  const errors: string[] = [];

  errors.push(...checkSystemPromptObject(body.contentSafety, "contentSafety"));
  errors.push(...checkSystemPromptObject(body.promptImprovement, "promptImprovement"));
  errors.push(...checkSystemPromptObject(body.promptReviewer, "promptReviewer"));

  if (!isPlainObject(body.promptBuilder)) {
    errors.push("promptBuilder must be an object");
  } else {
    errors.push(
      ...checkTextFields(body.promptBuilder, ["systemPrompt", "revisionInstructionTemplate"], "promptBuilder"),
    );
  }

  if (!isPlainObject(body.assetAnalysis)) {
    errors.push("assetAnalysis must be an object");
  } else {
    errors.push(...checkTextFields(body.assetAnalysis, ["baseInstructions"], "assetAnalysis"));
    if (!isPlainObject(body.assetAnalysis.roleInstructions)) {
      errors.push("assetAnalysis.roleInstructions must be an object");
    } else {
      errors.push(
        ...checkTextFields(
          body.assetAnalysis.roleInstructions,
          STAGE_PROMPT_ASSET_ROLES,
          "assetAnalysis.roleInstructions",
        ),
      );
    }
  }

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
    case "lighting":
      return validateLighting(body);
    case "global_rules":
      return validateGlobalRules(body);
    case "priority_logic":
      return validatePriorityLogic(body);
    case "model_capability_matrix":
      return validateModelCapabilityMatrix(body);
    case "stage_prompts":
      return validateStagePrompts(body);
  }
}
