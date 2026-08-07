"use client";

// Maszynka Video — video pipeline test bench (PRD 0003, CONTEXT.md "Maszynka Video").
// A separate fifth tab from the existing Maszynka: the two pipelines share no stage,
// so this view has its own lib/maszynka-video/* module set and its own Neon table.
// Slice 1 (issue #24) was the walking skeleton: common fields + shared run history.
// Slice 2 (issue #25) adds the Planner stage: an operator-editable configuration that
// sends ONE non-streaming OpenRouter request through the /api/chat BYOK proxy and
// renders raw response / parsed JSON / contract fields, all editable before later
// stages consume them.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CHAT_MODELS, CHAT_MODEL_GROUPS } from "@/lib/chat/models";
import { configureFal, runModel, uploadReference } from "@/lib/fal";
import { DEFAULT_SETTINGS, MODELS, MODEL_BY_KEY, MODEL_GROUPS, buildInput } from "@/lib/models";
import {
  createVideoRun,
  getVideoRun,
  listVideoRuns,
  patchVideoRun,
  type VideoGridRecord,
  type VideoReferenceFile,
  type VideoRun,
} from "@/lib/maszynka-video/api";
import {
  DEFAULT_PLANNER_CONFIG,
  buildPlannerRequestBody,
  callPlanner,
  type PlannerConfig,
  type PlannerReasoningEffort,
} from "@/lib/maszynka-video/planner";
import {
  derivePlannerContract,
  parsePlannerContent,
  withUpdatedGridPayload,
  type PlannerGridBatch,
} from "@/lib/maszynka-video/plannerContract";
import {
  canvasSizeLabel,
  gridPromptFromPayload,
  mergeGridInput,
  parseRawParams,
} from "@/lib/maszynka-video/gridRequest";

const INPUT_CLS =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100";
const MONO_AREA_CLS =
  "w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100";
const LABEL_CLS = "mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400";
const PRIMARY_BTN_CLS =
  "rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400";
const GHOST_BTN_CLS =
  "rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50";

function JsonPre({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-neutral-50 p-3 text-[11px] leading-snug text-neutral-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Raw request/response debug block — native <details>, closed by default. */
function DebugDetails({ label, value }: { label: string; value: unknown }) {
  if (value == null) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-neutral-500 hover:text-amber-700">{label}</summary>
      <JsonPre value={value} />
    </details>
  );
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One Grid batch section (issue #27) — independently runnable; its payload edits
 *  write back into the planner output (single source of truth for grids AND crops).
 *  Keyed by run+batch in the parent so reopening another run remounts fresh state. */
function GridSection({
  batch,
  batchIndex,
  stored,
  referenceFiles,
  canGenerate,
  onApplyPayload,
  onGenerate,
}: {
  batch: PlannerGridBatch;
  batchIndex: number;
  stored: VideoGridRecord | undefined;
  referenceFiles: VideoReferenceFile[];
  canGenerate: boolean;
  onApplyPayload: (batchIndex: number, payload: Record<string, unknown>) => Promise<void>;
  onGenerate: (batch: PlannerGridBatch, modelKey: string, rawParamsText: string) => Promise<void>;
}) {
  const [modelKey, setModelKey] = useState(stored?.modelKey ?? MODELS[0].key);
  const [rawParams, setRawParams] = useState(stored?.rawParams ?? "");
  const pretty = useMemo(() => JSON.stringify(batch.gridGenerationPayload, null, 2), [batch.gridGenerationPayload]);
  const [payloadDraft, setPayloadDraft] = useState(pretty);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-sync the editor when the stored payload text actually changes (planner rerun /
  // applied edit) — string-keyed so a mere refetch never clobbers in-progress edits.
  useEffect(() => {
    setPayloadDraft(pretty);
    setPayloadError(null);
  }, [pretty]);

  const rawParamsError = parseRawParams(rawParams).error;
  const canvas = canvasSizeLabel(batch.gridGenerationPayload);

  const handleApplyPayload = async () => {
    setPayloadError(null);
    try {
      const parsed: unknown = JSON.parse(payloadDraft);
      if (!isPlainRecord(parsed)) throw new Error("payload must be a JSON object");
      await onApplyPayload(batchIndex, parsed);
    } catch (e) {
      setPayloadError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleGenerate = async () => {
    setGenError(null);
    setBusy(true);
    try {
      await onGenerate(batch, modelKey, rawParams);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-neutral-200 p-4 last:mb-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-mono text-sm font-semibold text-neutral-700">{batch.batchId}</h3>
        <span className="text-xs text-neutral-400">
          {batch.sceneIds.join(", ") || "no sceneIds"}
          {canvas ? ` · canvasSize ${canvas}` : ""}
        </span>
      </div>

      <label className={LABEL_CLS}>gridGenerationPayload (editable — also drives the Crops layout)</label>
      <textarea
        value={payloadDraft}
        onChange={(e) => setPayloadDraft(e.target.value)}
        rows={6}
        className={MONO_AREA_CLS}
      />
      <div className="mb-3 mt-1 flex items-center gap-3">
        <button type="button" onClick={() => void handleApplyPayload()} className={GHOST_BTN_CLS}>
          Apply payload edits
        </button>
        {payloadError && <span className="text-sm text-red-600">{payloadError}</span>}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLS}>Image model</label>
          <select value={modelKey} onChange={(e) => setModelKey(e.target.value)} className={INPUT_CLS}>
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
        </div>
        <div>
          <label className={LABEL_CLS}>Raw model parameters (JSON pass-through)</label>
          <input
            value={rawParams}
            onChange={(e) => setRawParams(e.target.value)}
            placeholder='e.g. {"image_size": {"width": 1920, "height": 960}}'
            className={`${INPUT_CLS} font-mono`}
          />
        </div>
      </div>
      {rawParamsError && <p className="mb-2 text-sm text-red-600">{rawParamsError}</p>}

      {referenceFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {referenceFiles.map((f) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={f.id} src={f.url} alt={f.name} title={f.name} className="h-10 w-10 rounded object-cover" />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleGenerate()}
        disabled={!canGenerate || Boolean(rawParamsError) || busy}
        className={PRIMARY_BTN_CLS}
      >
        {busy ? "Generating…" : "Generate grid"}
      </button>
      {genError && <p className="mt-2 text-sm text-red-600">{genError}</p>}
      {stored?.error && !genError && <p className="mt-2 text-sm text-red-600">{stored.error}</p>}

      {stored?.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={stored.imageUrl} alt={`Grid ${batch.batchId}`} className="mt-3 w-full rounded-lg border border-neutral-200" />
      )}
      <DebugDetails label="Raw request" value={stored?.request} />
      <DebugDetails label="Raw response" value={stored?.response} />
    </div>
  );
}

interface Props {
  apiKey: string;
  setApiKey: (key: string) => void;
  orKey: string;
  setOrKey: (key: string) => void;
}

export default function MaszynkaVideoView({ apiKey, setApiKey, orKey, setOrKey }: Props) {
  const [showOrKey, setShowOrKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // --- common fields (PRD 0003 "common fields") -----------------------------------
  const [name, setName] = useState("");
  const [globalRules, setGlobalRules] = useState("");
  const [priorityLogic, setPriorityLogic] = useState("");

  // --- current run + shared history -------------------------------------------------
  const [run, setRun] = useState<VideoRun | null>(null);
  const [runs, setRuns] = useState<VideoRun[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // --- Planner stage (issue #25) -----------------------------------------------------
  const [plannerCfg, setPlannerCfg] = useState<PlannerConfig>(DEFAULT_PLANNER_CONFIG);
  const [plannerRunning, setPlannerRunning] = useState(false);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  // The editable parsed-JSON text (PRD story 8) — synced from the stored output.
  const [outputDraft, setOutputDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  // --- Reference files (issue #26) ---------------------------------------------------
  const [uploadingRefs, setUploadingRefs] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);

  const setCfg = useCallback(<K extends keyof PlannerConfig>(key: K, value: PlannerConfig[K]) => {
    setPlannerCfg((prev) => ({ ...prev, [key]: value }));
  }, []);

  const contract = useMemo(
    () => (run && run.plannerOutput != null ? derivePlannerContract(run.plannerOutput) : null),
    [run],
  );

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await listVideoRuns());
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Failed to list Video runs");
    }
  }, []);

  useEffect(() => {
    void refreshRuns();
  }, [refreshRuns]);

  /** Adopts a server run record: common fields, planner config and output draft. */
  const applyRun = useCallback((r: VideoRun) => {
    setRun(r);
    setName(r.name);
    setGlobalRules(r.globalRules);
    setPriorityLogic(r.priorityLogic);
    const cfg = r.plannerConfig as Partial<PlannerConfig> | null;
    setPlannerCfg({ ...DEFAULT_PLANNER_CONFIG, ...(cfg ?? {}) });
    setOutputDraft(r.plannerOutput != null ? JSON.stringify(r.plannerOutput, null, 2) : "");
    setDraftError(null);
    setPlannerError(null);
  }, []);

  /** Adopts a PATCH result without clobbering the operator's in-progress form edits. */
  const adoptPatched = useCallback((r: VideoRun) => {
    setRun(r);
    setOutputDraft(r.plannerOutput != null ? JSON.stringify(r.plannerOutput, null, 2) : "");
  }, []);

  const handleCreateOrSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = run
        ? await patchVideoRun(run.id, { name, globalRules, priorityLogic })
        : await createVideoRun({ name, globalRules, priorityLogic });
      setRun(saved);
      void refreshRuns();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save Video run");
    } finally {
      setSaving(false);
    }
  }, [run, name, globalRules, priorityLogic, refreshRuns]);

  const handleOpenRun = useCallback(
    async (id: string) => {
      setSaveError(null);
      try {
        applyRun(await getVideoRun(id));
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Failed to load Video run");
      }
    },
    [applyRun],
  );

  const handleNewRun = useCallback(() => {
    setRun(null);
    setName("");
    setGlobalRules("");
    setPriorityLogic("");
    setSaveError(null);
    setPlannerCfg(DEFAULT_PLANNER_CONFIG);
    setOutputDraft("");
    setDraftError(null);
    setPlannerError(null);
  }, []);

  const handleUploadReferences = useCallback(
    async (files: FileList | null) => {
      if (!run || !files || files.length === 0) return;
      setUploadingRefs(true);
      setRefError(null);
      try {
        configureFal(apiKey);
        const uploaded: VideoReferenceFile[] = [];
        for (const file of Array.from(files)) {
          uploaded.push({ id: crypto.randomUUID(), url: await uploadReference(file), name: file.name });
        }
        adoptPatched(await patchVideoRun(run.id, { referenceFiles: [...run.referenceFiles, ...uploaded] }));
      } catch (e) {
        setRefError(e instanceof Error ? e.message : "Reference upload failed");
      } finally {
        setUploadingRefs(false);
      }
    },
    [run, apiKey, adoptPatched],
  );

  const handleRemoveReference = useCallback(
    async (refId: string) => {
      if (!run) return;
      setRefError(null);
      try {
        adoptPatched(
          await patchVideoRun(run.id, { referenceFiles: run.referenceFiles.filter((f) => f.id !== refId) }),
        );
      } catch (e) {
        setRefError(e instanceof Error ? e.message : "Failed to remove reference");
      }
    },
    [run, adoptPatched],
  );

  const handleRunPlanner = useCallback(async () => {
    if (!run) return;
    setPlannerRunning(true);
    setPlannerError(null);
    // Every currently stored reference rides along as an image part — removing one
    // before this call excludes it (issue #26).
    const body = buildPlannerRequestBody(
      plannerCfg,
      { globalRules, priorityLogic },
      run.referenceFiles.map((f) => f.url),
    );
    try {
      const { raw, content } = await callPlanner(orKey, body);
      const parsed = parsePlannerContent(content);
      const patched = await patchVideoRun(run.id, {
        plannerConfig: plannerCfg,
        plannerRequest: body,
        plannerResponse: raw,
        // A non-JSON response persists as validationError and BLOCKS later stages
        // (issue #25); a valid one stores the parsed JSON and clears any old error.
        ...(parsed.validationError
          ? { plannerValidationError: parsed.validationError }
          : { plannerOutput: parsed.parsed, plannerValidationError: "" }),
      });
      adoptPatched(patched);
    } catch (e) {
      // Network/proxy failure: keep it as a local error, but persist the config and
      // the exact request body so the debug view shows what would have been sent.
      setPlannerError(e instanceof Error ? e.message : "Planner request failed");
      try {
        adoptPatched(await patchVideoRun(run.id, { plannerConfig: plannerCfg, plannerRequest: body }));
      } catch {
        /* keep the primary error */
      }
    } finally {
      setPlannerRunning(false);
    }
  }, [run, plannerCfg, globalRules, priorityLogic, orKey, adoptPatched]);

  /** Grid-section payload edits write back into the planner output (issue #27) —
   *  the SAME JSON the crop stage later reads its layout from. */
  const handleApplyGridPayload = useCallback(
    async (batchIndex: number, payload: Record<string, unknown>) => {
      if (!run || !isPlainRecord(run.plannerOutput)) return;
      const updated = withUpdatedGridPayload(run.plannerOutput, batchIndex, payload);
      adoptPatched(await patchVideoRun(run.id, { plannerOutput: updated }));
    },
    [run, adoptPatched],
  );

  /** Runs ONE grid client-side against FAL and upserts its record — other grids'
   *  results stay untouched (issue #27). */
  const handleGenerateGrid = useCallback(
    async (batch: PlannerGridBatch, modelKey: string, rawParamsText: string) => {
      if (!run) return;
      const model = MODEL_BY_KEY[modelKey];
      if (!model) throw new Error(`Unknown image model: ${modelKey}`);
      const { params, error } = parseRawParams(rawParamsText);
      if (error) throw new Error(error);
      configureFal(apiKey);
      const referenceUrls = run.referenceFiles.map((f) => f.url);
      const input = mergeGridInput(
        buildInput(
          model,
          gridPromptFromPayload(batch.gridGenerationPayload),
          model.mode === "edit" ? referenceUrls : [],
          DEFAULT_SETTINGS,
        ),
        params,
      );
      const record: VideoGridRecord = {
        batchId: batch.batchId,
        modelKey,
        rawParams: rawParamsText,
        request: { endpoint: model.id, input },
        response: null,
        imageUrl: null,
        error: null,
      };
      try {
        const result = await runModel(model, input);
        record.response = result.raw;
        record.imageUrl = result.images[0]?.url ?? null;
        if (!record.imageUrl) record.error = "FAL returned no image.";
      } catch (e) {
        record.error = e instanceof Error ? e.message : String(e);
      }
      adoptPatched(await patchVideoRun(run.id, { gridRecord: record }));
      if (record.error) throw new Error(record.error);
    },
    [run, apiKey, adoptPatched],
  );

  const handleApplyOutputEdits = useCallback(async () => {
    if (!run) return;
    setDraftError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(outputDraft);
    } catch (e) {
      setDraftError(`Edited output is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const derived = derivePlannerContract(parsed);
    try {
      adoptPatched(
        await patchVideoRun(run.id, {
          plannerOutput: parsed,
          plannerValidationError: derived.validationError ?? "",
        }),
      );
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : "Failed to save edited output");
    }
  }, [run, outputDraft, adoptPatched]);

  const plannerBlockers = [
    !run && "create the Video run first",
    !orKey && "OpenRouter key missing",
    !plannerCfg.systemPrompt.trim() && "paste the planner system prompt",
    !plannerCfg.inputJson.trim() && "paste the input JSON",
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-8">
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
          <button type="button" onClick={() => setShowOrKey((s) => !s)} className={GHOST_BTN_CLS}>
            {showOrKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Shared with the Chat tab (stored in your browser). Used by the Planner stage to call OpenRouter.
        </p>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Fal.ai key</h2>
        <div className="flex gap-2">
          <input
            type={showApiKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="e.g. 4a1b2c3d-...:e5f6..."
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
          <button type="button" onClick={() => setShowApiKey((s) => !s)} className={GHOST_BTN_CLS}>
            {showApiKey ? "Hide" : "Show"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          Shared with the other tabs (stored in your browser). Used for reference uploads and FAL generation.
        </p>
      </section>

      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Video run</h2>
          {run && (
            <button type="button" onClick={handleNewRun} className={GHOST_BTN_CLS}>
              New run
            </button>
          )}
        </div>

        <label className={LABEL_CLS}>Run name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Summer spot 30s — test 1"
          className={`${INPUT_CLS} mb-3`}
        />

        {/* Paste-only fields: the app never authors global rules / priority logic
           content (PRD 0003 "Out of Scope") — no seeds, no defaults. */}
        <label className={LABEL_CLS}>Global rules (pasted)</label>
        <textarea
          value={globalRules}
          onChange={(e) => setGlobalRules(e.target.value)}
          rows={4}
          placeholder="Paste the global rules text…"
          className={`${MONO_AREA_CLS} mb-3`}
        />

        <label className={LABEL_CLS}>Priority logic (pasted)</label>
        <textarea
          value={priorityLogic}
          onChange={(e) => setPriorityLogic(e.target.value)}
          rows={4}
          placeholder="Paste the priority logic text…"
          className={`${MONO_AREA_CLS} mb-3`}
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCreateOrSave()}
            disabled={!name.trim() || saving}
            className={PRIMARY_BTN_CLS}
          >
            {saving ? "Saving…" : run ? "Save changes" : "Create run"}
          </button>
          {run && <span className="font-mono text-xs text-neutral-400">run {run.id.slice(0, 8)}</span>}
        </div>
        {saveError && <p className="mt-2 text-sm text-red-600">{saveError}</p>}
      </section>

      {/* REFERENCE FILES (issue #26) — uploaded once via FAL storage, sent to the
         Planner as multimodal image parts and reused by the grid sections. */}
      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Reference files</h2>
        <p className="mb-3 text-xs text-neutral-400">
          Uploaded once via FAL storage; the Planner receives them as image parts and every grid section reuses them.
        </p>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={!run || !apiKey || uploadingRefs}
          onChange={(e) => {
            void handleUploadReferences(e.target.files);
            e.target.value = "";
          }}
          className="mb-2 block w-full text-sm text-neutral-500 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-400 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-amber-950 hover:file:bg-amber-300 disabled:opacity-50"
        />
        {!run && <p className="text-xs text-neutral-400">Create the Video run first.</p>}
        {run && !apiKey && <p className="text-xs text-neutral-400">Fal.ai key missing.</p>}
        {uploadingRefs && <p className="text-sm text-neutral-500">Uploading…</p>}
        {refError && <p className="mt-1 text-sm text-red-600">{refError}</p>}
        {run && run.referenceFiles.length > 0 && (
          <ul className="mt-2 grid grid-cols-3 gap-3">
            {run.referenceFiles.map((f) => (
              <li key={f.id} className="rounded-lg border border-neutral-200 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={f.name} className="mb-1 h-24 w-full rounded object-cover" />
                <p className="truncate text-[11px] text-neutral-500" title={f.name}>
                  {f.name}
                </p>
                <button
                  type="button"
                  onClick={() => void handleRemoveReference(f.id)}
                  className="mt-1 text-xs text-red-500 hover:text-red-700"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* PLANNER (issue #25) — one non-streaming OpenRouter call; every output is
         editable before later stages consume it. */}
      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Planner</h2>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className={LABEL_CLS}>Model</label>
            <select value={plannerCfg.model} onChange={(e) => setCfg("model", e.target.value)} className={INPUT_CLS}>
              {CHAT_MODEL_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {CHAT_MODELS.filter((m) => m.group === group).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Reasoning effort</label>
            <select
              value={plannerCfg.reasoningEffort}
              onChange={(e) => setCfg("reasoningEffort", e.target.value as PlannerReasoningEffort)}
              className={INPUT_CLS}
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-3">
          {(
            [
              ["maxTokens", "Max tokens"],
              ["temperature", "Temperature"],
              ["topP", "Top-p"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label className={LABEL_CLS}>{label}</label>
              <input
                value={plannerCfg[key]}
                onChange={(e) => setCfg(key, e.target.value)}
                placeholder="empty = omit"
                className={INPUT_CLS}
              />
            </div>
          ))}
        </div>

        <label className={LABEL_CLS}>System prompt (pasted)</label>
        <textarea
          value={plannerCfg.systemPrompt}
          onChange={(e) => setCfg("systemPrompt", e.target.value)}
          rows={6}
          placeholder="Paste the full planner system prompt — scene splitting and grid layout live here, not in app code…"
          className={`${MONO_AREA_CLS} mb-3`}
        />

        <label className={LABEL_CLS}>Input JSON</label>
        <textarea
          value={plannerCfg.inputJson}
          onChange={(e) => setCfg("inputJson", e.target.value)}
          rows={6}
          placeholder='e.g. {"brief": "...", "targetFinalDurationSeconds": 30}'
          className={`${MONO_AREA_CLS} mb-3`}
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleRunPlanner()}
            disabled={plannerBlockers.length > 0 || plannerRunning}
            className={PRIMARY_BTN_CLS}
          >
            {plannerRunning ? "Planning…" : "Run planner"}
          </button>
          {plannerBlockers.length > 0 && <span className="text-xs text-neutral-400">{plannerBlockers.join(" · ")}</span>}
        </div>
        {plannerError && <p className="mt-2 text-sm text-red-600">{plannerError}</p>}

        {run?.plannerValidationError && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <span className="font-semibold">validationError:</span> {run.plannerValidationError} — later stages are
            blocked until the planner returns (or the operator saves) valid JSON.
          </p>
        )}

        <DebugDetails label="Raw request" value={run?.plannerRequest} />
        <DebugDetails label="Raw response" value={run?.plannerResponse} />

        {run && run.plannerOutput != null && (
          <div className="mt-4">
            <label className={LABEL_CLS}>Parsed output (editable JSON — later stages consume this)</label>
            <textarea
              value={outputDraft}
              onChange={(e) => setOutputDraft(e.target.value)}
              rows={10}
              className={MONO_AREA_CLS}
            />
            <div className="mt-2 flex items-center gap-3">
              <button type="button" onClick={() => void handleApplyOutputEdits()} className={GHOST_BTN_CLS}>
                Apply edits
              </button>
              {draftError && <span className="text-sm text-red-600">{draftError}</span>}
            </div>
          </div>
        )}

        {contract && !contract.validationError && (
          <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Contract — {contract.masterScenePlan ? "master scene plan (long video)" : "scene plan (short video)"} ·{" "}
              {contract.scenes.length} scene{contract.scenes.length === 1 ? "" : "s"} · {contract.batches.length} grid
              {contract.batches.length === 1 ? "" : "s"}
            </p>
            {contract.scenes.length > 0 && (
              <table className="w-full text-left text-xs text-neutral-600">
                <thead>
                  <tr className="text-neutral-400">
                    <th className="py-1 pr-2 font-medium">order</th>
                    <th className="py-1 pr-2 font-medium">sceneId</th>
                    <th className="py-1 pr-2 font-medium">gridSlot</th>
                    <th className="py-1 font-medium">duration (s)</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.scenes.map((s) => (
                    <tr key={`${s.sceneId}-${s.order}`} className="border-t border-neutral-200">
                      <td className="py-1 pr-2">{s.order}</td>
                      <td className="py-1 pr-2 font-mono">{s.sceneId || "—"}</td>
                      <td className="py-1 pr-2">{s.gridSlot == null ? "—" : String(s.gridSlot)}</td>
                      <td className="py-1">{s.targetClipDurationSeconds ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* GRIDS (issue #27) — one independent section per Grid batch (a short video
         has exactly one); blocked while the planner has a validationError. */}
      {run && contract && !contract.validationError && contract.batches.length > 0 && (
        <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">Grids</h2>
          {!apiKey && <p className="mb-3 text-xs text-neutral-400">Fal.ai key missing — generation disabled.</p>}
          {contract.batches.map((batch, i) => (
            <GridSection
              key={`${run.id}:${batch.batchId}`}
              batch={batch}
              batchIndex={i}
              stored={run.grids[batch.batchId]}
              referenceFiles={run.referenceFiles}
              canGenerate={Boolean(apiKey)}
              onApplyPayload={handleApplyGridPayload}
              onGenerate={handleGenerateGrid}
            />
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-semibold">Run history</h2>
        <p className="mb-3 text-xs text-neutral-400">
          Video runs are recorded server-side and shared across operators (newest first).
        </p>
        {historyError && <p className="mb-2 text-sm text-red-600">{historyError}</p>}
        {runs.length === 0 && !historyError && <p className="text-sm text-neutral-400">No Video runs yet.</p>}
        <ul className="divide-y divide-neutral-100">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => void handleOpenRun(r.id)}
                className={`flex w-full items-center justify-between gap-3 px-1 py-2 text-left text-sm hover:bg-amber-50 ${
                  run?.id === r.id ? "bg-amber-50" : ""
                }`}
              >
                <span className="truncate font-medium text-neutral-700">{r.name}</span>
                <span className="shrink-0 text-xs text-neutral-400">{new Date(r.createdAt).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
