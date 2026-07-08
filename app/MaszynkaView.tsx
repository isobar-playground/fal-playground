"use client";

// Maszynka — Content Factory test bench. Slice 1: the walking skeleton. A raw prompt +
// one packshot upload go straight to a FAL model (no LLM stages yet); every run is
// created and updated server-side in Neon (ADR 0001) so run history is shared across
// browsers/operators. Later slices add hooks/presets/safety/prompt-builder/reviewer on
// top of this same run — see docs/prd/0001-maszynka-test-bench.md.
import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_SETTINGS, MODELS, MODEL_BY_KEY, MODEL_GROUPS, buildInput, type ModelSettings } from "@/lib/models";
import { configureFal, runModel, uploadReference } from "@/lib/fal";
import { createRun, getRun, listRuns, patchRun, type MaszynkaRun } from "@/lib/maszynka/api";
import { classifyFalError } from "@/lib/maszynka/status";
import { assembleContract, validateContract } from "@/lib/maszynka/contract";
import {
  DEFAULT_PROMPT_BUILDER_MODEL,
  PROMPT_BUILDER_MODELS,
  PROMPT_BUILDER_MODEL_GROUPS,
  buildPromptBuilderRequestBody,
  callPromptBuilder,
  parsePromptBuilderContent,
  type PromptBuilderOutput,
} from "@/lib/maszynka/promptBuilder";
import { listLatestConfigs, type MaszynkaConfigVersion } from "@/lib/maszynka/configApi";
import type {
  CameraSettingConfig,
  ConfigKind,
  GlobalRuleConfig,
  HookConfig,
  ModelCapabilityEntry,
  PriorityLogicConfig,
  StyleConfig,
} from "@/lib/maszynka/configSchemas";
import { useImageLightbox } from "./ImageLightbox";
import MaszynkaConfigs from "./MaszynkaConfigs";

const ASPECT_RATIO_OPTIONS = ["1:1", "4:5", "9:16", "16:9", "3:4"];

// fal.ai's ApiError sets `message` from the response body's `.message` field, which
// validation errors (422, `{ detail: [...] }`) don't have — so `e.message` is often
// empty for exactly the failures an operator most needs explained. Fall back to the
// structured `.detail`/`.body` fal actually sent so `fal_generation_failed` runs carry
// a readable reason instead of a blank error field.
function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  const body = (e as { body?: unknown } | null)?.body;
  if (body && typeof body === "object") {
    const detail = (body as { detail?: unknown }).detail;
    if (Array.isArray(detail)) {
      const parts = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : null))
        .filter((s): s is string => Boolean(s));
      if (parts.length) return parts.join("; ");
    }
    try {
      return JSON.stringify(body);
    } catch {
      /* fall through */
    }
  }
  if (e instanceof Error) return e.name || "Unknown error";
  return typeof e === "string" ? e : "Unknown error";
}

interface Packshot {
  file: File;
  previewUrl: string;
  uploadedUrl?: string;
  uploading?: boolean;
  error?: string;
}

const STATUS_TONE: Record<string, string> = {
  run_started: "bg-neutral-100 text-neutral-600",
  prompt_builder_contract_created: "bg-amber-100 text-amber-800",
  prompt_builder_contract_validation_failed: "bg-red-100 text-red-700",
  prompt_builder_completed: "bg-amber-100 text-amber-800",
  prompt_builder_output_validation_failed: "bg-red-100 text-red-700",
  fal_generation_started: "bg-amber-100 text-amber-800",
  generation_completed: "bg-green-100 text-green-700",
  fal_generation_failed: "bg-red-100 text-red-700",
  provider_policy_blocked: "bg-red-100 text-red-700",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[status] ?? "bg-neutral-100 text-neutral-600"}`}>
      {status}
    </span>
  );
}

export default function MaszynkaView({
  apiKey,
  setApiKey,
  orKey,
  setOrKey,
  prompt,
  setPrompt,
}: {
  apiKey: string;
  setApiKey: Dispatch<SetStateAction<string>>;
  /** OpenRouter BYOK key (same one Chat tab uses, "chat:orKey" in localStorage) — the
   *  Prompt builder LLM stage (slice 4) calls OpenRouter through it. */
  orKey: string;
  setOrKey: Dispatch<SetStateAction<string>>;
  prompt: string;
  setPrompt: (next: string | ((p: string) => string)) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [showOrKey, setShowOrKey] = useState(false);
  const [packshot, setPackshot] = useState<Packshot | null>(null);
  const [modelKey, setModelKey] = useState<string>("nano-banana");
  const model = MODEL_BY_KEY[modelKey] ?? MODELS[0];
  // Prompt builder stage (slice 4): the operator's OpenRouter model for that stage,
  // recorded on the run at creation — see lib/maszynka/promptBuilder.ts.
  const [promptBuilderModel, setPromptBuilderModel] = useState<string>(DEFAULT_PROMPT_BUILDER_MODEL);

  const [running, setRunning] = useState(false);
  const [logLine, setLogLine] = useState<string>("");
  const [currentRun, setCurrentRun] = useState<MaszynkaRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const [history, setHistory] = useState<MaszynkaRun[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const lightbox = useImageLightbox();

  const refreshHistory = useCallback(() => {
    setHistoryState("loading");
    listRuns(50)
      .then((runs) => {
        setHistory(runs);
        setHistoryState("idle");
      })
      .catch(() => setHistoryState("error"));
  }, []);
  useEffect(() => refreshHistory(), [refreshHistory]);

  // --- Creative config (slice 3): hook/style/camera setting/language/aspect/variants,
  // fed from Neon config storage (never hardcoded) — see lib/maszynka/contract.ts.
  const [configs, setConfigs] = useState<Partial<Record<ConfigKind, MaszynkaConfigVersion>>>({});
  const [configsState, setConfigsState] = useState<"idle" | "loading" | "error">("loading");
  const [configsError, setConfigsError] = useState<string | null>(null);

  useEffect(() => {
    setConfigsState("loading");
    listLatestConfigs()
      .then((list) => {
        setConfigs(Object.fromEntries(list.map((c) => [c.kind, c])));
        setConfigsState("idle");
      })
      .catch((e) => {
        setConfigsState("error");
        setConfigsError(errMsg(e));
      });
  }, []);

  const hooks = (configs.hooks?.body as HookConfig[] | undefined) ?? [];
  const styles = (configs.styles?.body as StyleConfig[] | undefined) ?? [];
  const cameraSettings = (configs.camera_settings?.body as CameraSettingConfig[] | undefined) ?? [];

  const [selectedHookId, setSelectedHookId] = useState("");
  const [selectedStyleId, setSelectedStyleId] = useState("");
  const [selectedCameraSettingId, setSelectedCameraSettingId] = useState("");
  const [targetLanguage, setTargetLanguage] = useState("Polish");
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIO_OPTIONS[0]);
  const [variantsCount, setVariantsCount] = useState(1);

  // Default each dropdown to the first available option once its config loads, so a
  // fresh Run is usable without the operator having to touch every field.
  useEffect(() => {
    if (!selectedHookId && hooks.length) setSelectedHookId(hooks[0].id);
  }, [hooks, selectedHookId]);
  useEffect(() => {
    if (!selectedStyleId && styles.length) setSelectedStyleId(styles[0].styleId);
  }, [styles, selectedStyleId]);
  useEffect(() => {
    if (!selectedCameraSettingId && cameraSettings.length) setSelectedCameraSettingId(cameraSettings[0].cameraSettingId);
  }, [cameraSettings, selectedCameraSettingId]);

  // Eager-upload the packshot as soon as it's picked, mirroring the Images-tab reference
  // pattern (upload cost is paid once, not on every Run click).
  useEffect(() => {
    if (!apiKey || !packshot || packshot.uploadedUrl || packshot.uploading || packshot.error) return;
    configureFal(apiKey);
    setPackshot((p) => (p ? { ...p, uploading: true } : p));
    uploadReference(packshot.file)
      .then((url) => setPackshot((p) => (p && p.file === packshot.file ? { ...p, uploadedUrl: url, uploading: false } : p)))
      .catch((e) => setPackshot((p) => (p && p.file === packshot.file ? { ...p, uploading: false, error: errMsg(e) } : p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, packshot?.file]);

  const setPackshotFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    setPackshot((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
  }, []);
  const clearPackshot = useCallback(() => {
    setPackshot((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }, []);

  const packshotUploading = Boolean(packshot?.uploading);
  const canRun =
    Boolean(apiKey) &&
    Boolean(orKey) &&
    prompt.trim().length > 0 &&
    !running &&
    !packshotUploading &&
    configsState === "idle" &&
    Boolean(selectedHookId) &&
    Boolean(selectedStyleId) &&
    Boolean(selectedCameraSettingId) &&
    Boolean(targetLanguage.trim()) &&
    Boolean(aspectRatio);

  const handleRun = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setRunError(null);
    setLogLine("");
    const promptText = prompt.trim();

    try {
      configureFal(apiKey);
      let packshotUrl = packshot?.uploadedUrl;
      if (packshot && !packshotUrl) packshotUrl = await uploadReference(packshot.file);

      const run = await createRun({
        assetType: "image",
        userPromptRaw: promptText,
        modelKey: model.key,
        modelId: model.id,
        modelLabel: model.label,
        packshotUrl,
        promptBuilderModel,
      });
      setCurrentRun(run);
      refreshHistory();

      // --- Prompt builder contract (slice 3): assemble + validate before any builder or
      // FAL call. A contract that fails validation ends the run right here — see PRD
      // section 9 and lib/maszynka/contract.ts.
      const contract = assembleContract({
        userPromptRaw: promptText,
        packshotUrl,
        hooks: { version: configs.hooks?.version ?? 0, body: hooks },
        selectedHookId,
        styles: { version: configs.styles?.version ?? 0, body: styles },
        selectedStyleId,
        cameraSettings: { version: configs.camera_settings?.version ?? 0, body: cameraSettings },
        selectedCameraSettingId,
        globalRules: {
          version: configs.global_rules?.version ?? 0,
          body: (configs.global_rules?.body as GlobalRuleConfig[] | undefined) ?? [],
        },
        priorityLogic: {
          version: configs.priority_logic?.version ?? 0,
          body: (configs.priority_logic?.body as PriorityLogicConfig | undefined) ?? { layers: [] },
        },
        modelCapabilityMatrix: {
          version: configs.model_capability_matrix?.version ?? 0,
          body: (configs.model_capability_matrix?.body as ModelCapabilityEntry[] | undefined) ?? [],
        },
        modelKey: model.key,
        targetLanguage: targetLanguage.trim(),
        aspectRatio,
        variantsCount,
      });
      const contractErrors = validateContract(contract);

      if (contractErrors.length) {
        const failed = await patchRun(run.id, {
          status: "prompt_builder_contract_validation_failed",
          contract,
          detail: contractErrors.join("; "),
          error: contractErrors.join("; "),
        });
        setCurrentRun(failed);
        return; // an invalid contract must never reach a builder or FAL call
      }

      const withContract = await patchRun(run.id, { status: "prompt_builder_contract_created", contract });
      setCurrentRun(withContract);

      // --- Prompt builder LLM stage (slice 4): OpenRouter, structured output. A Contract
      // that fails the builder call or comes back schema-invalid ends the run here — see
      // lib/maszynka/promptBuilder.ts and PRD section 9/14.
      let builderOutput: PromptBuilderOutput;
      try {
        const builderRequest = buildPromptBuilderRequestBody(contract, promptBuilderModel);
        const { raw: builderResponse, content } = await callPromptBuilder(orKey, builderRequest);
        const { output, errors: builderErrors } = parsePromptBuilderContent(content);
        if (!output) {
          const failed = await patchRun(run.id, {
            status: "prompt_builder_output_validation_failed",
            promptBuilderRequest: builderRequest,
            promptBuilderResponse: builderResponse,
            detail: builderErrors.join("; "),
            error: builderErrors.join("; "),
          });
          setCurrentRun(failed);
          return; // invalid builder output must never reach FAL
        }
        builderOutput = output;
        const withBuilder = await patchRun(run.id, {
          status: "prompt_builder_completed",
          promptBuilderRequest: builderRequest,
          promptBuilderResponse: builderResponse,
          promptBuilderOutput: output,
        });
        setCurrentRun(withBuilder);
      } catch (e) {
        const failed = await patchRun(run.id, {
          status: "prompt_builder_output_validation_failed",
          error: errMsg(e),
          detail: errMsg(e),
        });
        setCurrentRun(failed);
        return; // the builder call itself failed (network/auth/etc.) — never reach FAL
      }

      // finalPrompt (not the raw operator prompt) drives FAL generation from here on —
      // see PRD section 14 and the "Generation now sends finalPrompt" acceptance criterion.
      const imageUrls = packshotUrl ? [packshotUrl] : [];
      const settings: ModelSettings = { ...DEFAULT_SETTINGS, numImages: variantsCount, aspectRatio };
      const input = buildInput(model, builderOutput.finalPrompt, imageUrls, settings);

      const started = await patchRun(run.id, { status: "fal_generation_started", falRequest: input });
      setCurrentRun(started);

      try {
        const { images, raw } = await runModel(model, input, (line) => setLogLine(line));
        const done = await patchRun(run.id, {
          status: "generation_completed",
          falResponse: raw,
          outputs: images,
        });
        setCurrentRun(done);
      } catch (e) {
        const status = classifyFalError(e);
        const failed = await patchRun(run.id, { status, error: errMsg(e) });
        setCurrentRun(failed);
      }
    } catch (e) {
      setRunError(errMsg(e));
    } finally {
      setRunning(false);
      setLogLine("");
      refreshHistory();
    }
  }, [
    canRun,
    apiKey,
    orKey,
    packshot,
    model,
    prompt,
    refreshHistory,
    configs,
    hooks,
    styles,
    cameraSettings,
    selectedHookId,
    selectedStyleId,
    selectedCameraSettingId,
    targetLanguage,
    aspectRatio,
    variantsCount,
    promptBuilderModel,
  ]);

  const openRun = useCallback(async (id: string) => {
    try {
      const run = await getRun(id);
      setCurrentRun(run);
      setRunError(null);
    } catch (e) {
      alert("Failed to load run:\n" + errMsg(e));
    }
  }, []);

  const packshotNote =
    packshot && model.mode !== "edit"
      ? `“${model.label}” is a generate model — it won't use the packshot. Pick an edit model to preserve it.`
      : undefined;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-8">
      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Fal.ai key</h2>
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="e.g. 4a1b2c3d-...:e5f6..."
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            {showKey ? "Hide" : "Show"}
          </button>
        </div>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">OpenRouter key</h2>
        <div className="flex gap-2">
          <input
            type={showOrKey ? "text" : "password"}
            value={orKey}
            onChange={(e) => setOrKey(e.target.value)}
            placeholder="sk-or-v1-…"
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
          <button
            type="button"
            onClick={() => setShowOrKey((s) => !s)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            {showOrKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Shared with the Chat tab (stored in your browser). Used by the Prompt builder stage to call OpenRouter.
        </p>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Run</h2>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          User prompt (raw)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Describe the creative intent for this test…"
          className="mb-4 w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Packshot (optional in this slice — the product image to preserve)
        </label>
        {packshot ? (
          <div className="mb-4 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={packshot.previewUrl} alt="packshot" className="size-16 rounded-lg border border-neutral-200 object-cover" />
            <div className="text-xs text-neutral-500">
              {packshot.uploading && <span className="text-amber-600">Uploading…</span>}
              {packshot.uploadedUrl && <span className="text-green-600">Uploaded</span>}
              {packshot.error && <span className="text-red-500">Upload failed: {packshot.error}</span>}
            </div>
            <button type="button" onClick={clearPackshot} className="ml-auto text-sm text-neutral-400 hover:text-red-500">
              Remove
            </button>
          </div>
        ) : (
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setPackshotFile(f);
              e.target.value = "";
            }}
            className="mb-4 block w-full text-sm text-neutral-600 file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-neutral-700"
          />
        )}

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Hook
        </label>
        <select
          value={selectedHookId}
          onChange={(e) => setSelectedHookId(e.target.value)}
          disabled={configsState !== "idle"}
          className="mb-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 disabled:bg-neutral-50 disabled:text-neutral-400"
        >
          {hooks.length === 0 && <option value="">— none available —</option>}
          {hooks.map((h) => (
            <option key={h.id} value={h.id}>
              {h.text}
            </option>
          ))}
        </select>

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Style
            </label>
            <select
              value={selectedStyleId}
              onChange={(e) => setSelectedStyleId(e.target.value)}
              disabled={configsState !== "idle"}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              {styles.length === 0 && <option value="">— none available —</option>}
              {styles.map((s) => (
                <option key={s.styleId} value={s.styleId}>
                  {s.styleName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Camera setting
            </label>
            <select
              value={selectedCameraSettingId}
              onChange={(e) => setSelectedCameraSettingId(e.target.value)}
              disabled={configsState !== "idle"}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              {cameraSettings.length === 0 && <option value="">— none available —</option>}
              {cameraSettings.map((c) => (
                <option key={c.cameraSettingId} value={c.cameraSettingId}>
                  {c.cameraSettingName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Target language
            </label>
            <input
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              placeholder="e.g. Polish"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Aspect ratio
            </label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
            >
              {ASPECT_RATIO_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Variants
            </label>
            <input
              type="number"
              min={1}
              max={4}
              value={variantsCount}
              onChange={(e) => setVariantsCount(Math.min(4, Math.max(1, Number.parseInt(e.target.value, 10) || 1)))}
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>
        </div>
        {configsState === "error" && (
          <p className="mb-4 text-xs text-red-600">Couldn't load configs: {configsError}</p>
        )}

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Prompt builder model (OpenRouter)
        </label>
        <select
          value={promptBuilderModel}
          onChange={(e) => setPromptBuilderModel(e.target.value)}
          className="mb-4 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
        >
          {PROMPT_BUILDER_MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {PROMPT_BUILDER_MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          FAL model
        </label>
        <select
          value={modelKey}
          onChange={(e) => setModelKey(e.target.value)}
          className="mb-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
        >
          {MODEL_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {MODELS.filter((m) => m.group === group).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {packshotNote && <p className="mb-4 text-xs text-amber-700">{packshotNote}</p>}
        {!packshotNote && <div className="mb-4" />}

        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={!canRun}
          className="rounded-xl bg-amber-400 px-6 py-2.5 font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
        >
          {running ? `Running… ${logLine ? `(${logLine})` : ""}` : "Run"}
        </button>
        {runError && <p className="mt-2 text-sm text-red-600">{runError}</p>}
      </section>

      {currentRun && (
        <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Run {currentRun.id.slice(0, 8)}</h2>
            <StatusBadge status={currentRun.status} />
            <span className="text-xs text-neutral-400">{new Date(currentRun.createdAt).toLocaleString()}</span>
          </div>
          <p className="mb-3 whitespace-pre-wrap text-sm text-neutral-700">{currentRun.userPromptRaw}</p>
          <p className="mb-3 text-xs text-neutral-500">
            Model: <b>{currentRun.modelLabel}</b>
            {currentRun.packshotUrl && " · packshot attached"}
          </p>
          {currentRun.error && (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{currentRun.error}</p>
          )}
          {currentRun.outputs.length > 0 && (
            <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {currentRun.outputs.map((img, i) => (
                <button
                  key={img.url}
                  type="button"
                  onClick={() => lightbox.open(currentRun.outputs.map((o) => o.url), i)}
                  className="overflow-hidden rounded-lg border border-neutral-200"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="generated" className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          )}
          <StatusHistory events={currentRun.statusHistory} />
          <PromptBuilderPanel
            model={currentRun.promptBuilderModel}
            output={currentRun.promptBuilderOutput as PromptBuilderOutput | null}
          />
          <DebugJson label="Contract" value={currentRun.contract} />
          <DebugJson label="Prompt builder request" value={currentRun.promptBuilderRequest} />
          <DebugJson label="Prompt builder response" value={currentRun.promptBuilderResponse} />
          <DebugJson label="FAL request" value={currentRun.falRequest} />
          <DebugJson label="FAL response" value={currentRun.falResponse} />
        </section>
      )}

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Run history</h2>
          <button type="button" onClick={refreshHistory} className="text-sm text-neutral-500 hover:text-amber-700">
            Refresh
          </button>
        </div>
        {historyState === "error" && (
          <p className="text-sm text-red-600">Couldn't load run history — check DATABASE_URL is configured.</p>
        )}
        {historyState !== "error" && history.length === 0 && (
          <p className="text-sm text-neutral-400">No runs yet. Runs are shared — anyone using this app sees them here.</p>
        )}
        <ul className="space-y-1">
          {history.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void openRun(r.id)}
                className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm hover:border-amber-300 hover:bg-amber-50 ${
                  currentRun?.id === r.id ? "border-amber-300 bg-amber-50" : "border-neutral-200"
                }`}
              >
                <StatusBadge status={r.status} />
                <span className="min-w-0 flex-1 truncate text-neutral-700">{r.userPromptRaw}</span>
                <span className="shrink-0 text-xs text-neutral-400">{r.modelLabel}</span>
                <span className="shrink-0 text-xs text-neutral-400">{new Date(r.createdAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <MaszynkaConfigs />

      {lightbox.node}
    </div>
  );
}

/** Human-readable view of the Prompt builder stage output — finalPrompt, negativePrompt,
 *  appliedRules, riskNotes (PRD section 14 / issue #4 acceptance criteria). Raw
 *  request/response stay in the collapsible DebugJson panels next to this. */
function PromptBuilderPanel({ model, output }: { model: string | null; output: PromptBuilderOutput | null }) {
  if (!output) return null;
  return (
    <div className="mb-3 rounded-lg bg-neutral-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Prompt builder output{model && <span className="ml-1 font-normal normal-case text-neutral-400">· {model}</span>}
      </p>
      <p className="mb-2 whitespace-pre-wrap text-sm text-neutral-800">
        <b>Final prompt:</b> {output.finalPrompt}
      </p>
      {output.negativePrompt && (
        <p className="mb-2 whitespace-pre-wrap text-sm text-neutral-600">
          <b>Negative prompt:</b> {output.negativePrompt}
        </p>
      )}
      {output.promptSummary && (
        <p className="mb-2 whitespace-pre-wrap text-xs text-neutral-500">
          <b>Summary:</b> {output.promptSummary}
        </p>
      )}
      {output.appliedRules.length > 0 && (
        <p className="mb-2 text-xs text-neutral-600">
          <b>Applied rules:</b> {output.appliedRules.join(", ")}
        </p>
      )}
      {output.riskNotes.length > 0 && (
        <p className="text-xs text-amber-700">
          <b>Risk notes:</b> {output.riskNotes.join(", ")}
        </p>
      )}
    </div>
  );
}

function StatusHistory({ events }: { events: MaszynkaRun["statusHistory"] }) {
  if (!events.length) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Status history</p>
      <ol className="space-y-1">
        {events.map((e, i) => (
          <li key={i} className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-mono text-neutral-400">{new Date(e.at).toLocaleTimeString()}</span>
            <StatusBadge status={e.status} />
            {e.detail && <span className="text-neutral-400">{e.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function DebugJson({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const text = useMemo(() => (value == null ? "" : JSON.stringify(value, null, 2)), [value]);
  if (value == null) return null;
  return (
    <div className="mb-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-neutral-500 hover:text-amber-700">
        {open ? "▾" : "▸"} {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-72 overflow-auto rounded-lg bg-neutral-50 px-3 py-2 font-mono text-[11px] text-neutral-700">
          {text}
        </pre>
      )}
    </div>
  );
}
