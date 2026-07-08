// Prompt builder Contract — the single validated JSON object assembled before the
// Prompt builder LLM stage (PRD section 9 / dump/Maszynka v2.0.md "Prompt builder
// contract"; term defined in CONTEXT.md). Pure, framework-free (no Neon/React import),
// same layering as configSchemas.ts — the caller (MaszynkaView) fetches config versions
// via configApi and passes them in already-typed.
//
// This module only assembles the Contract and validates it as JSON. A Contract that
// fails validation must end the run with `prompt_builder_contract_validation_failed` and
// never reach a builder call; see docs/prd/0001-maszynka-test-bench.md section 9.
//
// Asset analysis (issue #6, see lib/maszynka/assetAnalysis.ts) runs before the Contract
// is assembled — status.ts's ALLOWED_NEXT puts `asset_analysis_completed` between
// `run_started` and `prompt_builder_contract_created` — so every asset here always
// carries its analysis output already; `assembleContract` never calls an LLM itself.
import type {
  CameraSettingConfig,
  GlobalRuleConfig,
  HookConfig,
  ModelCapabilityEntry,
  PriorityLogicConfig,
  StyleConfig,
} from "./configSchemas";
import type { AssetAnalysisOutput } from "./assetAnalysis";

export type AssetRole = "packshot" | "style_reference" | "brand_reference" | "campaign_reference";
export const ASSET_ROLES: AssetRole[] = ["packshot", "style_reference", "brand_reference", "campaign_reference"];

export interface ContractAsset {
  id: string;
  role: AssetRole;
  url: string;
  /** The Asset analysis stage's structured output for this asset (issue #6). `null`
   *  would mean the analysis stage never ran on this asset — `validateContract` treats
   *  that as a hard failure, since by the time a Contract is assembled every asset on
   *  the run must already have passed analysis (see module header). */
  analysis: AssetAnalysisOutput | null;
}

/** A selected config reference, carrying the exact version used and a snapshot of its
 *  content — `snapshot` is `null` when `id` couldn't be resolved in that version's body,
 *  which `validateContract` treats as a hard failure. */
export interface ContractConfigRef<T> {
  id: string;
  version: number;
  snapshot: T | null;
}

export interface Contract {
  userInput: { userPromptRaw: string };
  assets: ContractAsset[];
  hook: ContractConfigRef<HookConfig>;
  style: ContractConfigRef<StyleConfig>;
  cameraSetting: ContractConfigRef<CameraSettingConfig>;
  globalRules: { version: number; snapshot: GlobalRuleConfig[] };
  priorityLogic: { version: number; snapshot: PriorityLogicConfig | null };
  modelCapability: { modelKey: string; version: number; snapshot: ModelCapabilityEntry | null };
  generationSettings: {
    targetLanguage: string;
    aspectRatio: string;
    variantsCount: number;
  };
}

export interface AssembleContractInput {
  userPromptRaw: string;
  /** Every uploaded asset (any/all of the four roles, all optional per spec section 3),
   *  already analyzed by the Asset analysis stage (issue #6) before this is called. */
  assets: ContractAsset[];
  hooks: { version: number; body: HookConfig[] };
  selectedHookId: string;
  styles: { version: number; body: StyleConfig[] };
  selectedStyleId: string;
  cameraSettings: { version: number; body: CameraSettingConfig[] };
  selectedCameraSettingId: string;
  globalRules: { version: number; body: GlobalRuleConfig[] };
  priorityLogic: { version: number; body: PriorityLogicConfig };
  modelCapabilityMatrix: { version: number; body: ModelCapabilityEntry[] };
  modelKey: string;
  targetLanguage: string;
  aspectRatio: string;
  variantsCount: number;
}

/** Assembles a Contract from operator selections + already-fetched config versions.
 *  Always returns an object (never throws) — an unresolved selection becomes a `null`
 *  snapshot; `validateContract` below is the single gate that decides pass/fail, so
 *  assembly and validation stay separately testable. */
export function assembleContract(input: AssembleContractInput): Contract {
  const hook = input.hooks.body.find((h) => h.id === input.selectedHookId) ?? null;
  const style = input.styles.body.find((s) => s.styleId === input.selectedStyleId) ?? null;
  const cameraSetting =
    input.cameraSettings.body.find((c) => c.cameraSettingId === input.selectedCameraSettingId) ?? null;
  const modelCapability = input.modelCapabilityMatrix.body.find((m) => m.modelKey === input.modelKey) ?? null;

  return {
    userInput: { userPromptRaw: input.userPromptRaw },
    assets: input.assets,
    hook: { id: input.selectedHookId, version: input.hooks.version, snapshot: hook },
    style: { id: input.selectedStyleId, version: input.styles.version, snapshot: style },
    cameraSetting: {
      id: input.selectedCameraSettingId,
      version: input.cameraSettings.version,
      snapshot: cameraSetting,
    },
    globalRules: { version: input.globalRules.version, snapshot: input.globalRules.body },
    priorityLogic: { version: input.priorityLogic.version, snapshot: input.priorityLogic.body },
    modelCapability: { modelKey: input.modelKey, version: input.modelCapabilityMatrix.version, snapshot: modelCapability },
    generationSettings: {
      targetLanguage: input.targetLanguage,
      aspectRatio: input.aspectRatio,
      variantsCount: input.variantsCount,
    },
  };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Validates an assembled Contract before it may be sent to the Prompt builder (PRD
 *  section 9: "Contract musi przejść walidację JSON przed wysłaniem do Prompt buildera").
 *  Empty array = valid. Hand-rolled, same style as configSchemas.validateConfigBody — no
 *  schema library for a handful of small, stable shapes; see that file's header. */
export function validateContract(contract: Contract): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(contract.userInput?.userPromptRaw)) {
    errors.push("userInput.userPromptRaw must be a non-empty string");
  }
  if (!Array.isArray(contract.assets)) {
    errors.push("assets must be an array");
  } else {
    contract.assets.forEach((asset, i) => {
      if (!isNonEmptyString(asset?.id) || !isNonEmptyString(asset?.url)) {
        errors.push(`assets[${i}] must have an id and a url`);
      }
      if (!ASSET_ROLES.includes(asset?.role)) {
        errors.push(`assets[${i}].role must be one of: ${ASSET_ROLES.join(", ")}`);
      }
      if (asset?.analysis == null) {
        errors.push(`assets[${i}] (role "${asset?.role}") is missing its Asset analysis output`);
      }
    });
  }

  const namedRefs: [string, ContractConfigRef<unknown> | undefined][] = [
    ["hook", contract.hook],
    ["style", contract.style],
    ["cameraSetting", contract.cameraSetting],
  ];
  for (const [name, ref] of namedRefs) {
    if (!ref || !isNonEmptyString(ref.id) || !isFiniteNumber(ref.version)) {
      errors.push(`${name} must have an id and a version`);
    } else if (ref.snapshot == null) {
      errors.push(`${name} "${ref.id}" was not found in config version ${ref.version}`);
    }
  }

  if (
    !contract.globalRules ||
    !isFiniteNumber(contract.globalRules.version) ||
    !Array.isArray(contract.globalRules.snapshot) ||
    contract.globalRules.snapshot.length === 0
  ) {
    errors.push("globalRules must have a version and a non-empty snapshot");
  }
  if (
    !contract.priorityLogic ||
    !isFiniteNumber(contract.priorityLogic.version) ||
    contract.priorityLogic.snapshot == null
  ) {
    errors.push("priorityLogic must have a version and a snapshot");
  }
  if (!contract.modelCapability || !isNonEmptyString(contract.modelCapability.modelKey) || !isFiniteNumber(contract.modelCapability.version)) {
    errors.push("modelCapability must have a modelKey and a version");
  } else if (contract.modelCapability.snapshot == null) {
    errors.push(
      `modelCapability: model "${contract.modelCapability.modelKey}" was not found in the model capability matrix version ${contract.modelCapability.version}`,
    );
  }

  const gs = contract.generationSettings;
  if (
    !gs ||
    !isNonEmptyString(gs.targetLanguage) ||
    !isNonEmptyString(gs.aspectRatio) ||
    !isFiniteNumber(gs.variantsCount) ||
    gs.variantsCount < 1
  ) {
    errors.push("generationSettings must have a targetLanguage, an aspectRatio and a variantsCount >= 1");
  }

  return errors;
}
