// FAL request mapper (PRD section 13 / dump/Maszynka v2.0.md "FAL request mapper";
// CONTEXT.md — sits between the Prompt reviewer gate (issue #5) and the actual FAL call.
// Pure, framework-free (no Neon/React import, no network) — same layering as contract.ts
// / recommend.ts: a plain input -> output function the caller (MaszynkaView) drives with
// the reviewed prompt, the run's uploaded assets, the selected model, and the model
// capability matrix entry snapshot already carried on the Contract
// (`contract.modelCapability.snapshot` — see contract.ts). Never re-derives capability
// from lib/models.ts directly, so an operator's edit to the Model capability matrix
// config (Configs section, ADR 0001) actually changes mapper behavior even if it
// disagrees with what the real endpoint supports — that mismatch is the operator's to
// discover via a run, which is the whole point of the test bench.
//
// Spec section 13's decision table, verbatim:
//   | Model supports negative_prompt     | Send negativePrompt as its own field.               |
//   | Model doesn't support negative_prompt | Fold it into finalPrompt's "Avoid / Constraints".  |
//   | Model supports seed                | Send seed, if the operator provided one.            |
//   | Model doesn't support seed          | Omit seed and record it in mappingNotes.            |
// Issue #6's asset roles extend the same idea to images: multi-image-capable models get
// every uploaded asset (packshot first, then style/brand/campaign reference, capped at
// the capability's maxInputImages); everyone else falls back to packshot-only.
//
// Reuses lib/models.ts's `buildInput` for every field the capability matrix doesn't
// govern (image size/quality/format/aspect ratio, num_images) so this module doesn't
// reimplement per-model payload shape — it only decides the prompt text, the image list
// handed to `buildInput`, and whether `buildInput`'s own seed goes out or gets stripped.
// Relative + explicit extension (not "@/lib/models") so this module stays importable by
// plain `node` in falMapper.check.ts, which has no bundler to resolve the "@/" alias —
// see configSeeds.ts / promptBuilder.ts for the same constraint.
import type { ModelDef, ModelSettings } from "../models.ts";
import { buildInput } from "../models.ts";
import type { AssetRole } from "./contract";
import type { ModelCapabilityEntry } from "./configSchemas";

/** The minimal shape the mapper needs from an uploaded asset — same fields as
 *  lib/maszynka/store.ts's `RunAsset`, restated locally so this module stays free of any
 *  server-only import. */
export interface FalMapperAsset {
  id: string;
  role: AssetRole;
  url: string;
}

export interface FalMapperInput {
  /** The Prompt reviewer-passed builder output's finalPrompt (PRD section 14). */
  finalPrompt: string;
  /** Same output's negativePrompt — empty string means nothing to map either way. */
  negativePrompt: string;
  /** Operator-provided seed text ("" = none given — random/default, regardless of
   *  capability). Digits only, same convention as the Images tab's seed field. */
  seed: string;
  /** Every asset uploaded on this run (any/all of the four roles). */
  assets: FalMapperAsset[];
  model: ModelDef;
  /** The Contract's `modelCapability.snapshot` — never null by the time this stage runs
   *  (Contract validation already guarantees that; see contract.ts). */
  capability: ModelCapabilityEntry;
  /** Every other generation setting `buildInput` needs (aspect ratio, variant count,
   *  quality, etc.) — same object the Run form already assembles. `settings.seed` is
   *  ignored; this module owns seed gating via `seed` above so the capability matrix,
   *  not `lib/models.ts`'s static field list, is what actually decides. */
  settings: ModelSettings;
}

export interface FalMapperResult {
  /** The exact payload to send to FAL — null when `errors` is non-empty. */
  falInput: Record<string, unknown> | null;
  /** One entry per field the mapper made a real decision about (negativePrompt, seed,
   *  images) — sent, skipped, or folded, and why. Always populated, even on failure, so
   *  a failed mapping still explains what it tried. */
  mappingNotes: string[];
  /** Non-empty means the Contract/reviewer output couldn't be mapped to any valid FAL
   *  request for the selected model — the run ends at `fal_request_mapping_failed`
   *  rather than sending a request that can't work (see status.ts). */
  errors: string[];
}

function foldNegativeIntoPrompt(finalPrompt: string, negativePrompt: string): string {
  return `${finalPrompt}\n\nAvoid / Constraints:\n- ${negativePrompt}`;
}

const ROLE_ORDER: AssetRole[] = ["packshot", "style_reference", "brand_reference", "campaign_reference"];

/** Orders assets packshot-first (never dropped ahead of a reference when a cap forces a
 *  choice), then the remaining roles in the spec's field order. */
function orderedAssets(assets: FalMapperAsset[]): FalMapperAsset[] {
  return ROLE_ORDER.flatMap((role) => assets.filter((a) => a.role === role));
}

/** Maps a reviewed Contract + Prompt builder output to the exact FAL payload for the
 *  selected model, driven entirely by `capability` (never by `lib/models.ts` directly
 *  for the three capability-gated fields below). Never throws — a request that can't be
 *  built comes back as `errors` instead. */
export function mapContractToFalRequest(input: FalMapperInput): FalMapperResult {
  const { finalPrompt, negativePrompt, seed, assets, model, capability, settings } = input;
  const mappingNotes: string[] = [];
  const errors: string[] = [];

  if (!finalPrompt.trim()) {
    errors.push("finalPrompt is empty — nothing to send to FAL.");
  }

  // --- negativePrompt: separate field, folded into finalPrompt, or a no-op ----------
  const trimmedNegative = negativePrompt.trim();
  let promptForFal = finalPrompt;
  let sendNegativeAsField = false;
  if (!trimmedNegative) {
    mappingNotes.push("negativePrompt: empty — nothing to send or fold.");
  } else if (capability.supportsNegativePrompt) {
    sendNegativeAsField = true;
    mappingNotes.push(
      `negativePrompt: sent as a separate \`negative_prompt\` field (model capability "${capability.modelKey}" declares supportsNegativePrompt=true).`,
    );
  } else {
    promptForFal = foldNegativeIntoPrompt(finalPrompt, trimmedNegative);
    mappingNotes.push(
      `negativePrompt: model capability "${capability.modelKey}" declares supportsNegativePrompt=false — folded into finalPrompt's "Avoid / Constraints" section instead of a separate field.`,
    );
  }

  // --- images: multi-image (capped) or packshot-only fallback, edit models only -----
  let imageUrls: string[] = [];
  if (model.mode !== "edit") {
    if (assets.length) {
      mappingNotes.push(
        `images: "${model.label}" is a generate-mode model (no image input field) — ${assets.length} uploaded asset(s) not sent to FAL; their Asset analysis output already informed finalPrompt.`,
      );
    }
  } else {
    const ordered = orderedAssets(assets);
    if (!ordered.length) {
      errors.push(`"${model.label}" is an edit model and requires at least one reference image, but no assets were uploaded on this run.`);
    } else if (capability.supportsMultiImage && capability.maxInputImages > 1) {
      const selected = ordered.slice(0, capability.maxInputImages);
      const dropped = ordered.slice(capability.maxInputImages);
      imageUrls = selected.map((a) => a.url);
      mappingNotes.push(
        `images: sent ${selected.length} image(s) as multi-image input (${selected.map((a) => a.role).join(", ")}) — ` +
          `model capability declares supportsMultiImage=true, maxInputImages=${capability.maxInputImages}.` +
          (dropped.length ? ` Dropped ${dropped.length} asset(s) over the cap: ${dropped.map((a) => a.role).join(", ")}.` : ""),
      );
    } else {
      const packshot = ordered.find((a) => a.role === "packshot");
      const chosen = packshot ?? ordered[0];
      const rest = ordered.filter((a) => a.id !== chosen.id);
      imageUrls = [chosen.url];
      mappingNotes.push(
        `images: model capability declares supportsMultiImage=${capability.supportsMultiImage}, maxInputImages=${capability.maxInputImages} — ` +
          `falling back to a single image (${chosen.role})` +
          (rest.length ? `; dropped ${rest.length} asset(s): ${rest.map((a) => a.role).join(", ")}.` : "."),
      );
    }
  }

  if (errors.length) {
    return { falInput: null, mappingNotes, errors };
  }

  const falInput = buildInput(model, promptForFal, imageUrls, settings);

  // --- seed: gated on capability.supportsSeed, never on lib/models.ts's static field
  // list — buildInput's own seed handling is authoritative for every *other* model
  // setting, but seed is the one field this stage must be able to override either way
  // (add it even if buildInput's static field list wouldn't, strip it even if buildInput
  // added it), so the capability matrix — not the hardcoded catalog — is what an
  // operator's config edit actually controls.
  delete falInput.seed;
  const seedTrimmed = seed.trim();
  const seedNumber = Number.parseInt(seedTrimmed, 10);
  const seedProvided = seedTrimmed !== "" && Number.isFinite(seedNumber);
  if (!seedProvided) {
    mappingNotes.push("seed: none provided by the operator — omitted (FAL will use its own default/random seed).");
  } else if (capability.supportsSeed) {
    falInput.seed = seedNumber;
    mappingNotes.push(`seed: sent (${seedNumber}) — model capability declares supportsSeed=true.`);
  } else {
    mappingNotes.push(
      `seed: operator provided ${seedNumber}, but model capability "${capability.modelKey}" declares supportsSeed=false — omitted.`,
    );
  }
  if (sendNegativeAsField) falInput.negative_prompt = trimmedNegative;

  return { falInput, mappingNotes, errors: [] };
}
