// Deterministic prompt assembly for the OpenRouter bypass path (Prompt improvement
// model = "— none —"). Merges the operator's raw prompt with selected Hook / Style /
// Camera setting / Lighting presets from the RUN form — the same creative layers the
// Prompt builder LLM would fold in on the full pipeline path, without any LLM call.
import type {
  CameraSettingConfig,
  HookConfig,
  LightingConfig,
  StyleConfig,
} from "./configSchemas.ts";

export interface DirectPromptInput {
  userPromptRaw: string;
  hook: HookConfig | null;
  style: StyleConfig | null;
  cameraSetting: CameraSettingConfig | null;
  lighting: LightingConfig | null;
}

export interface DirectPromptOutput {
  finalPrompt: string;
  negativePrompt: string;
  appliedLayers: string[];
  promptSummary: string;
}

export interface ResolveRunPresetSelectionsInput {
  selectedHookId: string;
  selectedStyleId: string;
  selectedCameraSettingId: string;
  selectedLightingId: string;
  hooks: HookConfig[];
  styles: StyleConfig[];
  cameraSettings: CameraSettingConfig[];
  lightings: LightingConfig[];
}

function appendSection(lines: string[], title: string, bodyLines: string[]): void {
  const body = bodyLines.filter((line) => line.trim().length > 0);
  if (!body.length) return;
  lines.push("");
  lines.push(title);
  for (const line of body) lines.push(line);
}

function uniqueNonEmpty(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Resolves RUN-form dropdown selections to config snapshots. Empty id = none. */
export function resolveRunPresetSelections(input: ResolveRunPresetSelectionsInput): {
  hook: HookConfig | null;
  style: StyleConfig | null;
  cameraSetting: CameraSettingConfig | null;
  lighting: LightingConfig | null;
} {
  return {
    hook: input.selectedHookId
      ? (input.hooks.find((hook) => hook.id === input.selectedHookId) ?? null)
      : null,
    style: input.selectedStyleId
      ? (input.styles.find((style) => style.styleId === input.selectedStyleId) ?? null)
      : null,
    cameraSetting: input.selectedCameraSettingId
      ? (input.cameraSettings.find((camera) => camera.cameraSettingId === input.selectedCameraSettingId) ?? null)
      : null,
    lighting: input.selectedLightingId
      ? (input.lightings.find((light) => light.id === input.selectedLightingId) ?? null)
      : null,
  };
}

/** Builds finalPrompt + negativePrompt from the operator prompt and selected RUN presets. */
export function buildDirectFalPrompt(input: DirectPromptInput): DirectPromptOutput {
  const appliedLayers: string[] = [];
  const sections: string[] = [input.userPromptRaw.trim()];

  if (input.hook) {
    appliedLayers.push(`hook:${input.hook.id}`);
    const hookLines = [`Render this marketing hook on the asset (exact text): "${input.hook.text}"`];
    if (input.hook.placementGuidance?.trim()) {
      hookLines.push(`Placement: ${input.hook.placementGuidance.trim()}`);
    }
    if (input.hook.toneGuidance?.trim()) {
      hookLines.push(`Tone: ${input.hook.toneGuidance.trim()}`);
    }
    appendSection(sections, "Hook:", hookLines);
  }

  if (input.style) {
    appliedLayers.push(`style:${input.style.styleId}`);
    appendSection(sections, `Style (${input.style.styleName}):`, [
      input.style.visualIntent,
      `Lighting direction: ${input.style.lighting}`,
      `Color direction: ${input.style.colorDirection}`,
      `Composition: ${input.style.compositionBias}`,
      `Typography: ${input.style.typographyBehavior}`,
    ]);
  }

  if (input.cameraSetting) {
    appliedLayers.push(`camera:${input.cameraSetting.cameraSettingId}`);
    appendSection(sections, `Camera (${input.cameraSetting.cameraSettingName}):`, [
      input.cameraSetting.cameraIntent,
      `Shot type: ${input.cameraSetting.shotType}`,
      `Framing: ${input.cameraSetting.framing}`,
      `Angle: ${input.cameraSetting.angle}`,
      `Distance: ${input.cameraSetting.cameraDistance}`,
      `Lens feel: ${input.cameraSetting.lensFeel}`,
      input.cameraSetting.imageTranslation,
    ]);
  }

  if (input.lighting) {
    appliedLayers.push(`lighting:${input.lighting.id}`);
    appendSection(sections, `Lighting preset (${input.lighting.name}):`, [input.lighting.instruction]);
  }

  const negativeItems = uniqueNonEmpty([
    ...(input.style?.avoid ?? []),
    ...(input.cameraSetting?.avoid ?? []),
  ]);
  const negativePrompt = negativeItems.join("; ");

  const layerNote = appliedLayers.length
    ? `Merged operator prompt with RUN presets: ${appliedLayers.join(", ")}.`
    : "No RUN presets selected — using operator prompt only.";

  return {
    finalPrompt: sections.join("\n").trim(),
    negativePrompt,
    appliedLayers,
    promptSummary: `Direct assembly (OpenRouter bypass). ${layerNote}`,
  };
}
