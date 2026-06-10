"use client";

// PROTOTYPE — Fal Prompt Playground (throwaway).
// Question this answers: "Can a non-technical person, with only their own Fal key,
// run a reference-image + prompt + model-pick + cost-preview + generate loop entirely
// in the browser?" Everything lives in browser storage; the key never hits a server.
// One screen, top-to-bottom flow. See NOTES.md for the verdict.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  MODELS,
  MODEL_BY_KEY,
  QUALITY_LABELS,
  SIZE_LABELS,
  estimateModelCost,
  type GptQuality,
  type GptSize,
  type ModelSettings,
} from "@/lib/models";
import { configureFal, runModel, uploadReference } from "@/lib/fal";
import { useLocalStorage, useSessionStorage } from "@/lib/hooks";
import type { GenerationRun, Reference } from "@/lib/types";

const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Nieznany błąd";
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

interface SavedPrompt {
  text: string;
  ts: number;
}

export default function Page() {
  // Client-only app: skip SSR of the UI entirely. This makes hydration
  // immune to browser extensions (password managers etc.) that inject
  // attributes into form fields before React hydrates.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // --- Step 1: API key (persisted, browser-only) -------------------------
  const [apiKey, setApiKey] = useLocalStorage<string>("fal:key", "");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (apiKey) configureFal(apiKey);
  }, [apiKey]);

  // --- Step 2: reference images (in-memory) ------------------------------
  const [references, setReferences] = useState<Reference[]>([]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const next: Reference[] = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({
        kind: "file" as const,
        id: uid(),
        file,
        previewUrl: URL.createObjectURL(file),
      }));
    if (next.length) setReferences((prev) => [...prev, ...next]);
  }, []);

  const addUrlReference = useCallback((url: string, origin: "generated" | "manual") => {
    setReferences((prev) =>
      prev.some((r) => r.kind === "url" && r.url === url)
        ? prev
        : [...prev, { kind: "url", id: uid(), url, origin }],
    );
  }, []);

  const removeReference = useCallback((id: string) => {
    setReferences((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target?.kind === "file") URL.revokeObjectURL(target.previewUrl);
      return prev.filter((r) => r.id !== id);
    });
  }, []);

  const hasReferences = references.length > 0;

  // --- Step 3: prompt + session history ----------------------------------
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useSessionStorage<SavedPrompt[]>("fal:prompts", []);

  const savePrompt = useCallback(() => {
    const text = prompt.trim();
    if (!text) return;
    setHistory((prev) => [{ text, ts: Date.now() }, ...prev.filter((p) => p.text !== text)].slice(0, 30));
  }, [prompt, setHistory]);

  // --- Step 4: model selection + per-model settings ----------------------
  const [selectedKeys, setSelectedKeys] = useState<string[]>(["nano-banana"]);
  const [settings, setSettings] = useState<Record<string, ModelSettings>>({});
  const settingsFor = useCallback(
    (key: string) => settings[key] ?? DEFAULT_SETTINGS,
    [settings],
  );
  const patchSettings = useCallback((key: string, patch: Partial<ModelSettings>) => {
    setSettings((prev) => ({ ...prev, [key]: { ...(prev[key] ?? DEFAULT_SETTINGS), ...patch } }));
  }, []);
  const toggleModel = useCallback((key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  // Models that are selected AND actually runnable (edit models need references).
  const activeModels = useMemo(
    () =>
      selectedKeys
        .map((k) => MODEL_BY_KEY[k])
        .filter((m) => m && (!m.needsReferences || hasReferences)),
    [selectedKeys, hasReferences],
  );

  const costRows = useMemo(
    () => activeModels.map((m) => ({ model: m, cost: estimateModelCost(m, settingsFor(m.key)) })),
    [activeModels, settingsFor],
  );
  const totalCost = costRows.reduce((sum, r) => sum + r.cost, 0);

  // --- Generation --------------------------------------------------------
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
      alert("Nie udało się wgrać obrazów referencyjnych:\n" + errMsg(e));
      setGenerating(false);
      return;
    }

    const models = activeModels;
    const runId = uid();
    const promptText = prompt.trim();
    const run: GenerationRun = {
      id: runId,
      createdAt: Date.now(),
      prompt: promptText,
      referenceUrls: imageUrls,
      items: models.map((m) => ({
        modelKey: m.key,
        modelLabel: m.label,
        status: "running",
        images: [],
        estimatedCost: estimateModelCost(m, settingsFor(m.key)),
        settings: settingsFor(m.key),
      })),
    };
    setRuns((prev) => [run, ...prev]);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    await Promise.all(
      models.map(async (m) => {
        try {
          const images = await runModel(m, promptText, imageUrls, settingsFor(m.key), (line) =>
            setLogLines((prev) => ({ ...prev, [m.key]: line })),
          );
          updateItem(runId, m.key, { status: "done", images });
        } catch (e) {
          updateItem(runId, m.key, { status: "error", error: errMsg(e) });
        }
      }),
    );

    setGenerating(false);
  }, [canGenerate, apiKey, references, activeModels, prompt, settingsFor, setRuns, updateItem]);

  // -----------------------------------------------------------------------
  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-400">
        Ładowanie…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-44 pt-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="mr-1">🍌</span> Fal Prompt Playground
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          Testuj prompty na modelach Fal.ai (nano-banana, GPT Image) — bez kodu. Wszystko zostaje
          w Twojej przeglądarce.
        </p>
      </header>

      {/* STEP 1 — API KEY */}
      <Section step={1} title="Klucz Fal.ai" done={Boolean(apiKey)}>
        <p className="mb-3 text-sm text-neutral-500">
          Twój klucz zapisuje się w przeglądarce i nie jest nigdzie wysyłany poza fal.ai. Znajdziesz
          go w{" "}
          <a className="text-amber-600 underline" href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">
            panelu fal.ai → Keys
          </a>
          .
        </p>
        <div className="flex gap-2">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="np. 4a1b2c3d-...:e5f6..."
            className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
          <button
            type="button"
            onClick={() => setShowKey((s) => !s)}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm hover:bg-neutral-50"
          >
            {showKey ? "Ukryj" : "Pokaż"}
          </button>
        </div>
      </Section>

      {/* STEP 2 — REFERENCES */}
      <Section step={2} title="Obrazy referencyjne (opcjonalnie)" done={hasReferences}>
        <p className="mb-3 text-sm text-neutral-500">
          Wgraj dowolną liczbę grafik. Są używane przez modele w trybie <b>edycji</b>. Modele
          „generowanie” je ignorują.
        </p>
        <Dropzone onFiles={addFiles} />
        {hasReferences && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {references.map((ref) => (
              <figure key={ref.id} className="group relative overflow-hidden rounded-lg border border-neutral-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ref.kind === "file" ? ref.previewUrl : ref.url}
                  alt="referencja"
                  className="aspect-square w-full object-cover"
                />
                {ref.kind === "url" && ref.origin === "generated" && (
                  <span className="absolute left-1 top-1 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">
                    z wyniku
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeReference(ref.id)}
                  className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white opacity-0 transition group-hover:opacity-100"
                >
                  Usuń
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
          placeholder="Opisz, co model ma wygenerować lub jak zmienić referencje…"
          className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={savePrompt}
            disabled={!prompt.trim()}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            Zapisz do historii
          </button>
          {prompt && (
            <button type="button" onClick={() => setPrompt("")} className="text-sm text-neutral-500 hover:text-neutral-800">
              Wyczyść
            </button>
          )}
        </div>

        {history.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
              Historia (sesja)
            </p>
            <ul className="max-h-44 space-y-1 overflow-auto pr-1">
              {history.map((h) => (
                <li key={h.ts} className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setPrompt(h.text)}
                    className="flex-1 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-left text-sm hover:border-amber-300 hover:bg-amber-50"
                    title="Wczytaj prompt"
                  >
                    {h.text}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistory((prev) => prev.filter((p) => p.ts !== h.ts))}
                    className="mt-1 text-neutral-400 hover:text-red-500"
                    aria-label="Usuń z historii"
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
      <Section step={4} title="Modele" done={activeModels.length > 0}>
        <div className="space-y-2">
          {MODELS.map((m) => {
            const selected = selectedKeys.includes(m.key);
            const blocked = m.needsReferences && !hasReferences;
            const s = settingsFor(m.key);
            return (
              <div
                key={m.key}
                className={`rounded-xl border p-3 transition ${
                  selected && !blocked
                    ? "border-amber-300 bg-amber-50"
                    : "border-neutral-200 bg-white"
                } ${blocked ? "opacity-60" : ""}`}
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleModel(m.key)}
                    className="mt-1 size-4 accent-amber-500"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.label}</span>
                      <Badge>{m.mode === "edit" ? "edycja" : "generowanie"}</Badge>
                    </div>
                    <p className="text-sm text-neutral-500">{m.blurb}</p>
                    {blocked && selected && (
                      <p className="mt-1 text-xs font-medium text-red-500">
                        Wgraj choć jedną referencję, aby użyć tego modelu.
                      </p>
                    )}
                  </div>
                  {selected && !blocked && (
                    <span className="shrink-0 text-sm font-semibold text-amber-700">
                      {usd(estimateModelCost(m, s))}
                    </span>
                  )}
                </label>

                {selected && !blocked && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-amber-200/70 pt-3 pl-7 text-sm">
                    <label className="flex items-center gap-1.5">
                      <span className="text-neutral-500">Liczba obrazów</span>
                      <select
                        value={s.numImages}
                        onChange={(e) => patchSettings(m.key, { numImages: Number(e.target.value) })}
                        className="rounded-md border border-neutral-300 bg-white px-2 py-1"
                      >
                        {[1, 2, 3, 4].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    {m.family === "gpt-image" && (
                      <>
                        <label className="flex items-center gap-1.5">
                          <span className="text-neutral-500">Jakość</span>
                          <select
                            value={s.gptQuality}
                            onChange={(e) => patchSettings(m.key, { gptQuality: e.target.value as GptQuality })}
                            className="rounded-md border border-neutral-300 bg-white px-2 py-1"
                          >
                            {(Object.keys(QUALITY_LABELS) as GptQuality[]).map((q) => (
                              <option key={q} value={q}>
                                {QUALITY_LABELS[q]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="flex items-center gap-1.5">
                          <span className="text-neutral-500">Rozmiar</span>
                          <select
                            value={s.gptSize}
                            onChange={(e) => patchSettings(m.key, { gptSize: e.target.value as GptSize })}
                            className="rounded-md border border-neutral-300 bg-white px-2 py-1"
                          >
                            {(Object.keys(SIZE_LABELS) as GptSize[]).map((sz) => (
                              <option key={sz} value={sz}>
                                {SIZE_LABELS[sz]}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* RESULTS */}
      <div ref={resultsRef}>
        {runs.length > 0 && (
          <div className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Wyniki</h2>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Usunąć całą historię wyników z przeglądarki?")) setRuns([]);
                }}
                className="text-sm text-neutral-500 hover:text-red-500"
              >
                Wyczyść wszystkie
              </button>
            </div>
            <div className="space-y-6">
              {runs.map((run) => (
                <RunCard
                  key={run.id}
                  run={run}
                  logLines={logLines}
                  onUseAsReference={(url) => addUrlReference(url, "generated")}
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
              Szacowany koszt: <span className="text-amber-700">{usd(totalCost)}</span>
            </div>
            <div className="text-xs text-neutral-500">
              {activeModels.length > 0
                ? costRows.map((r) => `${r.model.label.split(" — ")[0]} ${r.model.mode === "edit" ? "(edycja)" : ""} ${usd(r.cost)}`).join(" · ")
                : "Wybierz model, podaj prompt i klucz."}
              {" · "}szacunek, faktyczny koszt nalicza Fal.
            </div>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className="rounded-xl bg-amber-400 px-6 py-2.5 font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            {generating ? "Generowanie…" : `Generuj (≈ ${usd(totalCost)})`}
          </button>
        </div>
      </div>
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
    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
      {children}
    </span>
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
      <span className="text-neutral-600">Przeciągnij grafiki tutaj lub kliknij, aby wybrać</span>
      <span className="mt-0.5 text-xs text-neutral-400">PNG, JPG, WebP — dowolna liczba</span>
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
  onDelete,
}: {
  run: GenerationRun;
  logLines: Record<string, string>;
  onUseAsReference: (url: string) => void;
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
            {new Date(run.createdAt).toLocaleString("pl-PL")}
            {run.referenceUrls.length > 0 && ` · ${run.referenceUrls.length} referencji`}
          </p>
        </div>
        <button type="button" onClick={onDelete} className="text-sm text-neutral-400 hover:text-red-500">
          Usuń
        </button>
      </div>

      <div className="space-y-4">
        {run.items.map((item) => (
          <div key={item.modelKey}>
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="font-medium">{item.modelLabel}</span>
              {item.status === "running" && (
                <span className="text-amber-600">⏳ {logLines[item.modelKey] ?? "w toku…"}</span>
              )}
              {item.status === "done" && <span className="text-green-600">✓ gotowe</span>}
              {item.status === "error" && <span className="text-red-500">błąd</span>}
            </div>

            {item.status === "error" && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{item.error}</p>
            )}

            {item.images.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {item.images.map((img, i) => (
                  <figure key={i} className="overflow-hidden rounded-lg border border-neutral-200">
                    <a href={img.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img.url} alt="wynik" className="aspect-square w-full object-cover" />
                    </a>
                    <div className="flex divide-x divide-neutral-200 border-t border-neutral-200 text-xs">
                      <button
                        type="button"
                        onClick={() => onUseAsReference(img.url)}
                        className="flex-1 py-1.5 text-center hover:bg-amber-50"
                        title="Dodaj do referencji następnej generacji"
                      >
                        ↑ jako referencja
                      </button>
                      <a href={img.url} target="_blank" rel="noreferrer" className="flex-1 py-1.5 text-center hover:bg-neutral-50">
                        otwórz
                      </a>
                    </div>
                  </figure>
                ))}
              </div>
            )}

            {item.status === "running" && item.images.length === 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: item.settings.numImages }).map((_, i) => (
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
