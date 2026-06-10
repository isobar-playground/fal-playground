"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  MODELS,
  MODEL_BY_KEY,
  MODEL_GROUPS,
  QUALITY_LABELS,
  QUALITY_OPTIONS,
  RESOLUTION_LABELS,
  effectiveResolution,
  effectiveSize,
  estimateCost,
  liveBaseFromPrice,
  unitCost,
  type GptQuality,
  type LivePrice,
  type ModelDef,
  type ModelSettings,
} from "@/lib/models";
import { configureFal, runModel, uploadReference } from "@/lib/fal";
import { fetchLivePrices } from "@/lib/pricing";
import { useLocalStorage, useSessionStorage } from "@/lib/hooks";
import type { GenerationRun, Reference } from "@/lib/types";

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

interface SavedPrompt {
  text: string;
  ts: number;
}

interface GalleryImage {
  url: string;
  modelLabel: string;
  prompt: string;
  key: string;
}

export default function Page() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Step 1 — API key
  const [apiKey, setApiKey] = useLocalStorage<string>("fal:key", "");
  const [showKey, setShowKey] = useState(false);
  useEffect(() => {
    if (apiKey) configureFal(apiKey);
  }, [apiKey]);

  // Step 2 — references
  const [references, setReferences] = useState<Reference[]>([]);
  const hasReferences = references.length > 0;

  const addFiles = useCallback((files: FileList | File[]) => {
    const next: Reference[] = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({ kind: "file" as const, id: uid(), file, previewUrl: URL.createObjectURL(file) }));
    if (next.length) setReferences((prev) => [...prev, ...next]);
  }, []);

  const addUrlReference = useCallback((url: string) => {
    setReferences((prev) =>
      prev.some((r) => r.kind === "url" && r.url === url)
        ? prev
        : [...prev, { kind: "url", id: uid(), url, origin: "generated" }],
    );
  }, []);

  const removeReference = useCallback((id: string) => {
    setReferences((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.kind === "file") URL.revokeObjectURL(target.previewUrl);
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  // Step 3 — prompt + history
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useSessionStorage<SavedPrompt[]>("fal:prompts", []);
  const savePrompt = useCallback(() => {
    const text = prompt.trim();
    if (!text) return;
    setHistory((prev) => [{ text, ts: Date.now() }, ...prev.filter((p) => p.text !== text)].slice(0, 30));
  }, [prompt, setHistory]);

  // Step 4 — models + settings
  const [selectedKeys, setSelectedKeys] = useState<string[]>(["nano-banana"]);
  const [settings, setSettings] = useState<Record<string, ModelSettings>>({});
  const settingsFor = useCallback((key: string) => settings[key] ?? DEFAULT_SETTINGS, [settings]);
  const patchSettings = useCallback((key: string, patch: Partial<ModelSettings>) => {
    setSettings((prev) => ({ ...prev, [key]: { ...(prev[key] ?? DEFAULT_SETTINGS), ...patch } }));
  }, []);
  const toggleModel = useCallback((key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const activeModels = useMemo(
    () => selectedKeys.map((k) => MODEL_BY_KEY[k]).filter((m) => m && (!m.needsReferences || hasReferences)),
    [selectedKeys, hasReferences],
  );
  // Live Fal pricing for the currently selected endpoints.
  const [livePrices, setLivePrices] = useState<Record<string, LivePrice>>({});
  const [pricing, setPricing] = useState<{ status: "idle" | "loading" | "live" | "error"; at?: number; error?: string }>({
    status: "idle",
  });
  const liveBaseFor = useCallback((m: ModelDef) => liveBaseFromPrice(livePrices[m.id]), [livePrices]);

  const activeIds = useMemo(() => [...new Set(activeModels.map((m) => m.id))], [activeModels]);
  const activeIdsKey = activeIds.join(",");

  const refreshPrices = useCallback(
    async (ids: string[]): Promise<Record<string, LivePrice> | null> => {
      if (!apiKey || ids.length === 0) return null;
      setPricing({ status: "loading" });
      try {
        const map = await fetchLivePrices(apiKey, ids);
        setLivePrices((prev) => ({ ...prev, ...map }));
        setPricing({ status: "live", at: Date.now() });
        return map;
      } catch (e) {
        setPricing({ status: "error", error: errMsg(e) });
        return null;
      }
    },
    [apiKey],
  );

  // Refresh whenever the set of selected endpoints (or the key) changes.
  useEffect(() => {
    if (!apiKey || activeIds.length === 0) return;
    const t = setTimeout(() => void refreshPrices(activeIds), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, activeIdsKey, refreshPrices]);

  const costRows = useMemo(
    () => activeModels.map((m) => ({ model: m, cost: estimateCost(m, settingsFor(m.key), liveBaseFor(m)) })),
    [activeModels, settingsFor, liveBaseFor],
  );
  const totalEstimate = costRows.reduce((sum, r) => sum + r.cost, 0);

  // Generation + results
  const [runs, setRuns] = useLocalStorage<GenerationRun[]>("fal:runs", []);
  const [generating, setGenerating] = useState(false);
  const [logLines, setLogLines] = useState<Record<string, string>>({});
  const resultsRef = useRef<HTMLDivElement>(null);

  const updateItem = useCallback(
    (runId: string, modelKey: string, patch: Partial<GenerationRun["items"][number]>) => {
      setRuns((prev) =>
        prev.map((run) =>
          run.id !== runId
            ? run
            : { ...run, items: run.items.map((it) => (it.modelKey === modelKey ? { ...it, ...patch } : it)) },
        ),
      );
    },
    [setRuns],
  );

  // Spend across every stored run.
  const spend = useMemo(() => {
    let total = 0;
    let images = 0;
    for (const run of runs)
      for (const item of run.items) {
        total += item.actualCost ?? 0;
        images += item.actualCost != null ? item.images.length : 0;
      }
    return { total, images };
  }, [runs]);

  // Flat gallery of every generated image, for the lightbox.
  const gallery = useMemo<GalleryImage[]>(() => {
    const arr: GalleryImage[] = [];
    for (const run of runs)
      for (const item of run.items)
        item.images.forEach((img, i) =>
          arr.push({ url: img.url, modelLabel: item.modelLabel, prompt: run.prompt, key: `${run.id}:${item.modelKey}:${i}` }),
        );
    return arr;
  }, [runs]);
  const indexByKey = useMemo(() => {
    const m = new Map<string, number>();
    gallery.forEach((g, i) => m.set(g.key, i));
    return m;
  }, [gallery]);

  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const openImage = useCallback(
    (runId: string, modelKey: string, imgIdx: number) => {
      const idx = indexByKey.get(`${runId}:${modelKey}:${imgIdx}`);
      if (idx != null) setLightboxIndex(idx);
    },
    [indexByKey],
  );

  const canGenerate = Boolean(apiKey) && prompt.trim().length > 0 && activeModels.length > 0 && !generating;

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setLogLines({});

    let imageUrls: string[] = [];
    try {
      configureFal(apiKey);
      imageUrls = await Promise.all(
        references.map((ref) => (ref.kind === "file" ? uploadReference(ref.file) : Promise.resolve(ref.url))),
      );
    } catch (e) {
      alert("Failed to upload reference images:\n" + errMsg(e));
      setGenerating(false);
      return;
    }

    const models = activeModels;

    // Always price against fresh Fal numbers right before generating.
    const fresh = await refreshPrices(models.map((m) => m.id));
    const priceMap = fresh ? { ...livePrices, ...fresh } : livePrices;
    const baseFor = (m: ModelDef) => liveBaseFromPrice(priceMap[m.id]);

    const runId = uid();
    const promptText = prompt.trim();
    const run: GenerationRun = {
      id: runId,
      createdAt: Date.now(),
      prompt: promptText,
      referenceUrls: imageUrls,
      items: models.map((m) => {
        const s = settingsFor(m.key);
        return {
          modelKey: m.key,
          modelLabel: m.label,
          status: "running" as const,
          images: [],
          unitCost: unitCost(m, s, baseFor(m)),
          estimatedCost: estimateCost(m, s, baseFor(m)),
          settings: s,
        };
      }),
    };
    setRuns((prev) => [run, ...prev]);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    await Promise.all(
      models.map(async (m) => {
        const s = settingsFor(m.key);
        try {
          const images = await runModel(m, promptText, imageUrls, s, (line) =>
            setLogLines((prev) => ({ ...prev, [m.key]: line })),
          );
          updateItem(runId, m.key, { status: "done", images, actualCost: unitCost(m, s, baseFor(m)) * images.length });
        } catch (e) {
          updateItem(runId, m.key, { status: "error", error: errMsg(e) });
        }
      }),
    );

    setGenerating(false);
  }, [canGenerate, apiKey, references, activeModels, prompt, settingsFor, setRuns, updateItem, refreshPrices, livePrices]);

  const resetAll = useCallback(() => {
    if (!confirm("Reset everything? This clears your key, prompt history, results and references.")) return;
    references.forEach((r) => r.kind === "file" && URL.revokeObjectURL(r.previewUrl));
    setApiKey("");
    setHistory([]);
    setRuns([]);
    setReferences([]);
    setPrompt("");
    setSelectedKeys(["nano-banana"]);
    setSettings({});
    setLightboxIndex(null);
  }, [references, setApiKey, setHistory, setRuns]);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">Loading…</div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-44 pt-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="mr-1">🍌</span> Fal Prompt Playground
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Test prompts on Fal.ai image models — no code. Everything stays in your browser.
          </p>
        </div>
        <button
          type="button"
          onClick={resetAll}
          className="shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-red-300 hover:text-red-600"
        >
          Reset all
        </button>
      </header>

      {/* STEP 1 — API KEY */}
      <Section step={1} title="Fal.ai key" done={Boolean(apiKey)}>
        <p className="mb-3 text-sm text-neutral-500">
          Stored in your browser, sent only to fal.ai. Get it from the{" "}
          <a className="text-amber-600 underline" href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">
            fal.ai dashboard → Keys
          </a>
          .
        </p>
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
      </Section>

      {/* STEP 2 — REFERENCES */}
      <Section step={2} title="Reference images (optional)" done={hasReferences}>
        <p className="mb-3 text-sm text-neutral-500">
          Upload any number of images. Used by <b>edit</b> models; <b>generate</b> models ignore them.
        </p>
        <Dropzone onFiles={addFiles} />
        {hasReferences && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {references.map((ref) => (
              <figure key={ref.id} className="group relative overflow-hidden rounded-lg border border-neutral-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ref.kind === "file" ? ref.previewUrl : ref.url}
                  alt="reference"
                  className="aspect-square w-full object-cover"
                />
                {ref.kind === "url" && ref.origin === "generated" && (
                  <span className="absolute left-1 top-1 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">
                    result
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeReference(ref.id)}
                  className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white opacity-0 transition group-hover:opacity-100"
                >
                  Remove
                </button>
              </figure>
            ))}
          </div>
        )}
      </Section>

      {/* STEP 3 — PROMPT */}
      <Section step={3} title="Prompt" done={prompt.trim().length > 0}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Describe what to generate, or how to change the references…"
          className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={savePrompt}
            disabled={!prompt.trim()}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            Save to history
          </button>
          {prompt && (
            <button type="button" onClick={() => setPrompt("")} className="text-sm text-neutral-500 hover:text-neutral-800">
              Clear
            </button>
          )}
        </div>

        {history.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">History (session)</p>
            <ul className="max-h-44 space-y-1 overflow-auto pr-1">
              {history.map((h) => (
                <li key={h.ts} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setPrompt(h.text)}
                    className="flex-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-left text-sm hover:border-amber-300 hover:bg-amber-50"
                    title="Load prompt"
                  >
                    {h.text}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistory((prev) => prev.filter((p) => p.ts !== h.ts))}
                    className="mt-1 text-neutral-400 hover:text-red-500"
                    aria-label="Remove from history"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* STEP 4 — MODELS */}
      <Section step={4} title="Models" done={activeModels.length > 0}>
        <div className="space-y-5">
          {MODEL_GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{group}</p>
              <div className="space-y-2">
                {MODELS.filter((m) => m.group === group).map((m) => (
                  <ModelRow
                    key={m.key}
                    model={m}
                    selected={selectedKeys.includes(m.key)}
                    blocked={m.needsReferences && !hasReferences}
                    settings={settingsFor(m.key)}
                    liveBase={liveBaseFor(m)}
                    onToggle={() => toggleModel(m.key)}
                    onPatch={(patch) => patchSettings(m.key, patch)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* RESULTS */}
      <div ref={resultsRef}>
        {runs.length > 0 && (
          <div className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Results{" "}
                <span className="ml-1 text-sm font-normal text-neutral-500">
                  · spent {usd(spend.total)} on {spend.images} image{spend.images === 1 ? "" : "s"}
                </span>
              </h2>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Delete all results from your browser?")) setRuns([]);
                }}
                className="text-sm text-neutral-500 hover:text-red-500"
              >
                Clear results
              </button>
            </div>
            <div className="space-y-6">
              {runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  logLines={logLines}
                  onUseAsReference={addUrlReference}
                  onOpenImage={(modelKey, imgIdx) => openImage(run.id, modelKey, imgIdx)}
                  onDelete={() => setRuns((prev) => prev.filter((r) => r.id !== run.id))}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* STICKY COST + GENERATE BAR */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <div className="font-semibold">
              Estimated cost: <span className="text-amber-700">{usd(totalEstimate)}</span>
            </div>
            <div className="text-xs text-neutral-500">
              {activeModels.length > 0
                ? costRows.map((r) => `${r.model.label} ${usd(r.cost)}`).join(" · ")
                : "Add a key, a prompt and pick at least one model."}
            </div>
            <div className="text-[11px] text-neutral-400">
              {pricing.status === "loading" && "Fetching live Fal pricing…"}
              {pricing.status === "live" && pricing.at && (
                <span className="text-green-600">● Live Fal pricing · {new Date(pricing.at).toLocaleTimeString()}</span>
              )}
              {pricing.status === "error" && (
                <span className="text-amber-600" title={pricing.error}>
                  ● Couldn’t reach Fal pricing — using local estimate
                </span>
              )}
              {pricing.status === "idle" && "Pricing refreshes from Fal when you pick models."}
            </div>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="rounded-xl bg-amber-400 px-6 py-2.5 font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            {generating ? "Generating…" : `Generate (≈ ${usd(totalEstimate)})`}
          </button>
        </div>
      </div>

      {lightboxIndex != null && gallery[lightboxIndex] && (
        <Lightbox
          images={gallery}
          index={lightboxIndex}
          onIndex={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

/* ----------------------------- subcomponents ----------------------------- */

function Section({
  step,
  title,
  done,
  children,
}: {
  step: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${
            done ? "bg-amber-400 text-amber-950" : "bg-neutral-200 text-neutral-600"
          }`}
        >
          {done ? "✓" : step}
        </span>
        <h2 className="font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">{children}</span>
  );
}

function Select<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: string) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-300 bg-white px-2 py-1"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ModelRow({
  model,
  selected,
  blocked,
  settings,
  liveBase,
  onToggle,
  onPatch,
}: {
  model: ModelDef;
  selected: boolean;
  blocked: boolean;
  settings: ModelSettings;
  liveBase?: number;
  onToggle: () => void;
  onPatch: (patch: Partial<ModelSettings>) => void;
}) {
  const active = selected && !blocked;
  return (
    <div
      className={`rounded-xl border p-3 transition ${
        active ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"
      } ${blocked ? "opacity-60" : ""}`}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1 size-4 accent-amber-500" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{model.label}</span>
            <Badge>{model.mode}</Badge>
          </div>
          <p className="text-sm text-neutral-500">{model.blurb}</p>
          {blocked && selected && (
            <p className="mt-1 text-xs font-medium text-red-500">Add at least one reference image to use this model.</p>
          )}
        </div>
        {active && (
          <span className="shrink-0 text-sm font-semibold text-amber-700">{usd(estimateCost(model, settings, liveBase))}</span>
        )}
      </label>

      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-amber-200/70 pt-3 pl-7 text-sm">
          <Select
            label="Images"
            value={settings.numImages}
            onChange={(v) => onPatch({ numImages: Number(v) })}
            options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
          />
          {model.controls.resolutions && (
            <Select
              label="Resolution"
              value={effectiveResolution(model, settings)}
              onChange={(v) => onPatch({ resolution: v })}
              options={model.controls.resolutions.map((r) => ({ value: r, label: RESOLUTION_LABELS[r] ?? r }))}
            />
          )}
          {model.controls.quality && (
            <Select
              label="Quality"
              value={settings.quality}
              onChange={(v) => onPatch({ quality: v as GptQuality })}
              options={QUALITY_OPTIONS.map((q) => ({ value: q, label: QUALITY_LABELS[q] }))}
            />
          )}
          {model.controls.sizes && (
            <Select
              label="Size"
              value={effectiveSize(model, settings)}
              onChange={(v) => onPatch({ size: v })}
              options={model.controls.sizes}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Dropzone({ onFiles }: { onFiles: (files: FileList | File[]) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition ${
        over ? "border-amber-400 bg-amber-50" : "border-neutral-300 hover:border-amber-300"
      }`}
    >
      <span className="text-neutral-600">Drop images here or click to choose</span>
      <span className="mt-0.5 text-xs text-neutral-400">PNG, JPG, WebP — any number</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function RunCard({
  run,
  logLines,
  onUseAsReference,
  onOpenImage,
  onDelete,
}: {
  run: GenerationRun;
  logLines: Record<string, string>;
  onUseAsReference: (url: string) => void;
  onOpenImage: (modelKey: string, imgIdx: number) => void;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={run.prompt}>
            “{run.prompt}”
          </p>
          <p className="text-xs text-neutral-400">
            {new Date(run.createdAt).toLocaleString()}
            {run.referenceUrls.length > 0 && ` · ${run.referenceUrls.length} reference(s)`}
          </p>
        </div>
        <button type="button" onClick={onDelete} className="text-sm text-neutral-400 hover:text-red-500">
          Delete
        </button>
      </div>

      <div className="space-y-4">
        {run.items.map((item) => (
          <div key={item.modelKey}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{item.modelLabel}</span>
              {item.status === "running" && (
                <span className="text-amber-600">⏳ {logLines[item.modelKey] ?? "working…"}</span>
              )}
              {item.status === "done" && (
                <span className="text-green-600">
                  ✓ {item.images.length} image{item.images.length === 1 ? "" : "s"} · {usd(item.actualCost ?? 0)}
                </span>
              )}
              {item.status === "error" && <span className="text-red-500">error</span>}
            </div>

            {item.status === "error" && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{item.error}</p>
            )}

            {item.images.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {item.images.map((img, i) => (
                  <figure key={i} className="overflow-hidden rounded-lg border border-neutral-200">
                    <button
                      type="button"
                      onClick={() => onOpenImage(item.modelKey, i)}
                      className="relative block w-full"
                      title="Open in lightbox"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="result" className="aspect-square w-full object-cover" />
                      <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        {usd(item.unitCost)}
                      </span>
                    </button>
                    <div className="flex divide-x divide-neutral-200 border-t border-neutral-200 text-xs">
                      <button
                        type="button"
                        onClick={() => onUseAsReference(img.url)}
                        className="flex-1 py-1.5 text-center hover:bg-amber-50"
                        title="Use as reference for the next generation"
                      >
                        ↑ as reference
                      </button>
                      <a href={img.url} target="_blank" rel="noreferrer" className="flex-1 py-1.5 text-center hover:bg-neutral-50">
                        open
                      </a>
                    </div>
                  </figure>
                ))}
              </div>
            )}

            {item.status === "running" && item.images.length === 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: Math.max(1, item.settings.numImages) }).map((_, i) => (
                  <div key={i} className="aspect-square animate-pulse rounded-lg bg-neutral-100" />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

function Lightbox({
  images,
  index,
  onIndex,
  onClose,
}: {
  images: GalleryImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const len = images.length;
  const go = useCallback((i: number) => onIndex(((i % len) + len) % len), [len, onIndex]);
  const thumbsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, onClose]);

  useEffect(() => {
    thumbsRef.current?.querySelector<HTMLElement>(`[data-active="true"]`)?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [index]);

  const cur = images[index];
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-between gap-4 p-3 text-white" onClick={stop}>
        <div className="min-w-0">
          <div className="text-sm font-medium">{cur.modelLabel}</div>
          <div className="max-w-[60vw] truncate text-xs text-white/60">{cur.prompt}</div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-white/70">
            {index + 1} / {len}
          </span>
          <a href={cur.url} target="_blank" rel="noreferrer" className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/20">
            open
          </a>
          <button type="button" onClick={onClose} className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/20" aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-12" onClick={stop}>
        {len > 1 && (
          <button
            type="button"
            onClick={() => go(index - 1)}
            className="absolute left-2 flex size-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
            aria-label="Previous"
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur.url} alt="result" className="max-h-full max-w-full object-contain" />
        {len > 1 && (
          <button
            type="button"
            onClick={() => go(index + 1)}
            className="absolute right-2 flex size-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
            aria-label="Next"
          >
            ›
          </button>
        )}
      </div>

      {len > 1 && (
        <div ref={thumbsRef} className="flex gap-2 overflow-x-auto p-3" onClick={stop}>
          {images.map((img, i) => (
            <button
              key={img.key}
              data-active={i === index}
              type="button"
              onClick={() => onIndex(i)}
              className={`shrink-0 overflow-hidden rounded-md border-2 transition ${
                i === index ? "border-amber-400" : "border-transparent opacity-50 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="thumbnail" className="size-16 object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
