"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  MODELS,
  MODEL_BY_KEY,
  MODEL_GROUPS,
  buildInput,
  effectiveResolution,
  effectiveSize,
  estimateCost,
  liveBaseFromPrice,
  unitCost,
  type LivePrice,
  type ModelDef,
  type ModelSettings,
} from "@/lib/models";
import { configureFal, runModel, uploadReference } from "@/lib/fal";
import { fetchLivePrices } from "@/lib/pricing";
import { decodeSession, encodeSession } from "@/lib/session";
import { useLocalStorage, useSessionStorage } from "@/lib/hooks";
import type {
  AppMode,
  GenerationRun,
  PromptKind,
  Reference,
  SessionExport,
  VideoRun,
} from "@/lib/types";
// --- video (separate code path; see lib/video/*) -------------------------
import {
  DEFAULT_VIDEO_SETTINGS,
  VIDEO_MODELS,
  VIDEO_MODEL_BY_KEY,
  VIDEO_MODEL_GROUPS,
  buildVideoInput,
  effectiveAspectRatio,
  effectiveDuration,
  estimateVideoCost,
  hasVideoField,
  liveVideoBaseFromPrice,
  type VideoModelDef,
  type VideoSettings,
} from "@/lib/video/models";
import { runVideoModel } from "@/lib/video/fal";

// Sub-dollar amounts keep up to 4 decimals (so $0.0398 isn't rounded to $0.04),
// trailing zeros trimmed but at least 2 shown; $1+ uses plain 2-decimal currency.
function usd(n: number): string {
  if (!n) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  let s = n.toFixed(4).replace(/0+$/, "");
  if (s.length - s.indexOf(".") - 1 < 2) s = n.toFixed(2);
  return `$${s}`;
}
const formatMoney = (n: number, currency: string) =>
  currency === "USD" ? usd(n) : `${n.toFixed(2)} ${currency}`;
const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "string" ? e : "Unknown error";
const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

// Drop prompt/image_urls — keep only the tunable params we want to surface in results.
function paramsOf(input: Record<string, unknown>): Record<string, unknown> {
  const { prompt: _p, image_urls: _u, ...rest } = input;
  return rest;
}

const PARAM_LABELS: Record<string, string> = {
  num_images: "images",
  resolution: "resolution",
  image_size: "size",
  quality: "quality",
  seed: "seed",
  aspect_ratio: "aspect",
  safety_tolerance: "safety",
  output_format: "format",
};

function paramText(v: unknown): string {
  if (v && typeof v === "object" && "width" in v && "height" in v) {
    const o = v as { width: number; height: number };
    return `${o.width}×${o.height}`;
  }
  return String(v);
}

// Video param chips — drop prompt + frame URLs, keep the tunables (duration/aspect).
function videoParamsOf(input: Record<string, unknown>): Record<string, unknown> {
  const {
    prompt: _p,
    image_url: _i,
    start_image_url: _s,
    end_image_url: _e,
    first_frame_url: _f,
    last_frame_url: _l,
    ...rest
  } = input;
  return rest;
}

const VIDEO_PARAM_LABELS: Record<string, string> = {
  duration: "duration",
  aspect_ratio: "aspect",
};

interface SavedPrompt {
  text: string;
  ts: number;
}

interface GalleryImage {
  url: string;
  modelLabel: string;
  prompt: string;
  promptKind?: PromptKind;
  params?: Record<string, unknown>;
  refUrls?: string[];
  key: string;
}

// A video frame slot holds an uploaded File (with a local preview) or a URL
// (a generated/manual image). Files are uploaded to Fal storage at generate time.
type VideoFrame =
  | { kind: "file"; file: File; previewUrl: string }
  | { kind: "url"; url: string };

const frameSrc = (f: VideoFrame): string => (f.kind === "file" ? f.previewUrl : f.url);

// Input-mode badge label for the video model rows.
const VIDEO_MODE_BADGE: Record<string, string> = {
  text: "Text",
  start: "Start",
  "start-end": "Start+End",
};

// --- prompt beautifier ("Upiększacz") ------------------------------------
type BeautifyStrength = "light" | "moderate" | "aggressive";
type BeautifyLanguage = "auto" | "en" | "pl";
type SendMode = "original" | "beautified" | "both";

const STRENGTH_OPTS: { value: BeautifyStrength; label: string }[] = [
  { value: "light", label: "Lekkie" },
  { value: "moderate", label: "Umiarkowane" },
  { value: "aggressive", label: "Agresywne" },
];
const LANGUAGE_OPTS: { value: BeautifyLanguage; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "EN" },
  { value: "pl", label: "PL" },
];
const SEND_OPTS: { value: SendMode; label: string }[] = [
  { value: "original", label: "Twój" },
  { value: "beautified", label: "Upiększony" },
  { value: "both", label: "Oba" },
];
const BEAUTIFY_MAX_CHARS = 100_000;

export default function Page() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Top-level mode — Images | Video. Persisted; shared steps (key, prompt) render
  // in both; steps 2/4/5 swap to their video versions. Default "image".
  const [mode, setMode] = useLocalStorage<AppMode>("fal:mode", "image");
  const isVideo = mode === "video";

  // Step 1 — API key
  const [apiKey, setApiKey] = useLocalStorage<string>("fal:key", "");
  const [showKey, setShowKey] = useState(false);
  useEffect(() => {
    if (apiKey) configureFal(apiKey);
  }, [apiKey]);

  // Local-dev convenience: pre-fill the key from FAL_KEY (dev only), unless one is stored.
  const envTried = useRef(false);
  const loadEnvKey = useCallback(() => {
    fetch("/api/dev-key")
      .then((r) => r.json())
      .then((d) => {
        if (d?.key) setApiKey(d.key);
      })
      .catch(() => {});
  }, [setApiKey]);
  useEffect(() => {
    if (!mounted || envTried.current) return;
    envTried.current = true;
    try {
      if (window.localStorage.getItem("fal:key")) return;
    } catch {}
    loadEnvKey();
  }, [mounted, loadEnvKey]);

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

  // Per-reference role label ("logo klienta", "aktorka") — fed to the beautifier in order.
  const setReferenceLabel = useCallback((id: string, label: string) => {
    setReferences((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  // Step 3 — prompt + history
  const [prompt, setPrompt] = useState("");
  const [history, setHistory] = useSessionStorage<SavedPrompt[]>("fal:prompts", []);
  // Holds an unsaved draft that got overwritten (by loading history / clearing), so it can be restored.
  const [stashedPrompt, setStashedPrompt] = useState<string | null>(null);

  const savePrompt = useCallback(() => {
    const text = prompt.trim();
    if (!text) return;
    setHistory((prev) => [{ text, ts: Date.now() }, ...prev.filter((p) => p.text !== text)].slice(0, 30));
  }, [prompt, setHistory]);

  // Stash the current text first if it's a non-empty draft that isn't already saved in history.
  const stashIfDraft = useCallback(() => {
    const trimmed = prompt.trim();
    if (trimmed && !history.some((h) => h.text === trimmed)) setStashedPrompt(prompt);
  }, [prompt, history]);

  const loadFromHistory = useCallback(
    (text: string) => {
      if (prompt.trim() !== text.trim()) stashIfDraft();
      setPrompt(text);
    },
    [prompt, stashIfDraft],
  );

  const clearPrompt = useCallback(() => {
    stashIfDraft();
    setPrompt("");
  }, [stashIfDraft]);

  const restoreStash = useCallback(() => {
    if (stashedPrompt != null) setPrompt(stashedPrompt);
    setStashedPrompt(null);
  }, [stashedPrompt]);

  // Step 3b — prompt beautifier ("Upiększacz"). Ephemeral, like `prompt` (not persisted).
  const [strength, setStrength] = useState<BeautifyStrength>("moderate");
  const [language, setLanguage] = useState<BeautifyLanguage>("auto");
  const [beautified, setBeautified] = useState(""); // editable field 2; "" = none yet
  const [beautifying, setBeautifying] = useState(false);
  const [beautifyError, setBeautifyError] = useState<string | null>(null);
  // The original prompt snapshot at the moment of the last beautify, to detect "stale".
  const [beautifySource, setBeautifySource] = useState<string | null>(null);
  const hasBeautified = beautified.trim().length > 0;
  const beautifyStale = hasBeautified && beautifySource != null && prompt.trim() !== beautifySource.trim();

  // Human-readable beautifier model name + system prompt, resolved server-side
  // (the env slug never reaches here; the system prompt isn't secret, shown in a tooltip).
  const [beautifyInfo, setBeautifyInfo] = useState<{
    available: boolean;
    name: string;
    systemPrompt?: string;
  } | null>(null);
  useEffect(() => {
    if (!mounted) return;
    fetch("/api/beautify")
      .then((r) => r.json())
      .then((d) =>
        setBeautifyInfo(
          d?.name
            ? {
                available: Boolean(d.available),
                name: d.name,
                systemPrompt: typeof d.systemPrompt === "string" ? d.systemPrompt : undefined,
              }
            : null,
        ),
      )
      .catch(() => setBeautifyInfo(null));
  }, [mounted]);

  const handleBeautify = useCallback(async () => {
    const text = prompt.trim();
    if (!text || beautifying) return;
    if (text.length > BEAUTIFY_MAX_CHARS) {
      setBeautifyError(`Prompt za długi (${text.length} > ${BEAUTIFY_MAX_CHARS} znaków).`);
      return;
    }
    setBeautifying(true);
    setBeautifyError(null);
    try {
      const res = await fetch("/api/beautify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          strength,
          language,
          mode, // image → static-detail rewrite; video → cinematic rewrite
          referenceCount: references.length,
          referenceLabels: references.map((r) => r.label ?? ""),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.prompt) {
        throw new Error(data?.error || `Błąd upiększania (${res.status})`);
      }
      setBeautified(data.prompt);
      setBeautifySource(text); // pin the source so edits to field 1 mark it stale
      // Deliberately do NOT switch sendMode — only unlock the options.
    } catch (e) {
      setBeautifyError(errMsg(e));
    } finally {
      setBeautifying(false);
    }
  }, [prompt, beautifying, strength, language, mode, references]);

  // Step 4 — models + settings
  const [selectedKeys, setSelectedKeys] = useState<string[]>(["nano-banana"]);
  const [settings, setSettings] = useState<Record<string, ModelSettings>>({});
  // Always merge over defaults so every field exists (e.g. imported/older sessions).
  const settingsFor = useCallback(
    (key: string): ModelSettings => ({ ...DEFAULT_SETTINGS, ...settings[key] }),
    [settings],
  );
  const patchSettings = useCallback((key: string, patch: Partial<ModelSettings>) => {
    setSettings((prev) => ({ ...prev, [key]: { ...DEFAULT_SETTINGS, ...prev[key], ...patch } }));
  }, []);
  const toggleModel = useCallback((key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);
  const switchToEdit = useCallback((genKey: string, editKey: string) => {
    setSelectedKeys((prev) => {
      const next = prev.filter((k) => k !== genKey);
      if (!next.includes(editKey)) next.push(editKey);
      return next;
    });
  }, []);

  const activeModels = useMemo(
    () => selectedKeys.map((k) => MODEL_BY_KEY[k]).filter((m) => m && (!m.needsReferences || hasReferences)),
    [selectedKeys, hasReferences],
  );
  const hasEditSelected = useMemo(
    () => selectedKeys.some((k) => MODEL_BY_KEY[k]?.mode === "edit"),
    [selectedKeys],
  );

  // --- Video state (separate code path; only used when mode === "video") ---
  // Step 2 (video) — Start / End frame slots. Each holds an uploaded File (with a
  // local preview) OR a URL (a generated/manual image), enabling "generate → animate".
  const [startFrame, setStartFrame] = useState<VideoFrame | null>(null);
  const [endFrame, setEndFrame] = useState<VideoFrame | null>(null);
  const clearFrame = useCallback((frame: VideoFrame | null) => {
    if (frame?.kind === "file") URL.revokeObjectURL(frame.previewUrl);
  }, []);
  const setFrame = useCallback(
    (slot: "start" | "end", next: VideoFrame | null) => {
      const apply = slot === "start" ? setStartFrame : setEndFrame;
      apply((prev) => {
        clearFrame(prev);
        return next;
      });
    },
    [clearFrame],
  );
  const setFrameFile = useCallback(
    (slot: "start" | "end", file: File) => {
      if (!file.type.startsWith("image/")) return;
      setFrame(slot, { kind: "file", file, previewUrl: URL.createObjectURL(file) });
    },
    [setFrame],
  );
  const setFrameUrl = useCallback(
    (slot: "start" | "end", url: string) => setFrame(slot, { kind: "url", url }),
    [setFrame],
  );

  // Step 4 (video) — single-select model + per-model duration/aspect settings.
  const [videoKey, setVideoKey] = useState<string>("veo3.1-text");
  const videoModel = VIDEO_MODEL_BY_KEY[videoKey] ?? VIDEO_MODELS[0];
  const [videoSettings, setVideoSettings] = useState<Record<string, VideoSettings>>({});
  const videoSettingsFor = useCallback(
    (key: string): VideoSettings => ({ ...DEFAULT_VIDEO_SETTINGS, ...videoSettings[key] }),
    [videoSettings],
  );
  const patchVideoSettings = useCallback((key: string, patch: Partial<VideoSettings>) => {
    setVideoSettings((prev) => ({ ...prev, [key]: { ...DEFAULT_VIDEO_SETTINGS, ...prev[key], ...patch } }));
  }, []);

  // Live Fal pricing for the currently selected endpoints.
  const [livePrices, setLivePrices] = useState<Record<string, LivePrice>>({});
  const [pricing, setPricing] = useState<{ status: "idle" | "loading" | "live" | "error"; at?: number; error?: string }>({
    status: "idle",
  });
  const liveBaseFor = useCallback((m: ModelDef) => liveBaseFromPrice(livePrices[m.id]), [livePrices]);
  const liveVideoBaseFor = useCallback(
    (m: VideoModelDef) => liveVideoBaseFromPrice(livePrices[m.id]),
    [livePrices],
  );

  // Fal account credit balance (via server-side FAL_ADMIN_KEY; absent → not shown).
  const [credits, setCredits] = useState<{ balance: number; currency: string } | null>(null);
  const refreshCredits = useCallback(() => {
    fetch("/api/credits")
      .then((r) => r.json())
      .then((d) => setCredits(d?.available ? { balance: d.balance, currency: d.currency ?? "USD" } : null))
      .catch(() => setCredits(null));
  }, []);
  useEffect(() => {
    if (mounted) refreshCredits();
  }, [mounted, refreshCredits]);

  // Endpoints to price: image mode → the selected image models; video mode → the
  // single selected video model. The same refresh mechanism serves both.
  const activeIds = useMemo(
    () => (isVideo ? [videoModel.id] : [...new Set(activeModels.map((m) => m.id))]),
    [isVideo, videoModel.id, activeModels],
  );
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

  // Which prompt variant(s) to send. "beautified"/"both" are unusable without a beautified prompt.
  const [sendMode, setSendMode] = useState<SendMode>("original");
  const effectiveSendMode: SendMode = hasBeautified ? sendMode : "original";
  // How many prompt variants each model runs with — "both" doubles cost & item count.
  const variantCount = effectiveSendMode === "both" ? 2 : 1;

  const costRows = useMemo(
    () => activeModels.map((m) => ({ model: m, cost: estimateCost(m, settingsFor(m.key), liveBaseFor(m)) })),
    [activeModels, settingsFor, liveBaseFor],
  );
  const imageTotalEstimate = costRows.reduce((sum, r) => sum + r.cost, 0) * variantCount;

  // Video cost — one clip from the single selected model, scaled by duration (×variants).
  const videoEstimate = useMemo(
    () => estimateVideoCost(videoModel, videoSettingsFor(videoModel.key), liveVideoBaseFor(videoModel)) * variantCount,
    [videoModel, videoSettingsFor, liveVideoBaseFor, variantCount],
  );
  const totalEstimate = isVideo ? videoEstimate : imageTotalEstimate;

  // Generation + results
  const [runs, setRuns] = useLocalStorage<GenerationRun[]>("fal:runs", []);
  const [videoRuns, setVideoRuns] = useLocalStorage<VideoRun[]>("fal:video-runs", []);
  const [generating, setGenerating] = useState(false);
  const [logLines, setLogLines] = useState<Record<string, string>>({});
  // Live status line per running video item (queue position / log). Ephemeral.
  const [videoStatus, setVideoStatus] = useState<Record<string, string>>({});
  // Elapsed-time ticker for in-flight video jobs (video runs are long).
  const [, setNowTick] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);

  const updateItem = useCallback(
    (runId: string, itemId: string, patch: Partial<GenerationRun["items"][number]>) => {
      setRuns((prev) =>
        prev.map((run) =>
          run.id !== runId
            ? run
            : { ...run, items: run.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) },
        ),
      );
    },
    [setRuns],
  );

  const updateVideoItem = useCallback(
    (runId: string, itemId: string, patch: Partial<VideoRun["items"][number]>) => {
      setVideoRuns((prev) =>
        prev.map((run) =>
          run.id !== runId
            ? run
            : { ...run, items: run.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) },
        ),
      );
    },
    [setVideoRuns],
  );

  // Tick once a second while any video job is running, so elapsed timers update.
  const anyVideoRunning = useMemo(
    () => videoRuns.some((r) => r.items.some((it) => it.status === "running")),
    [videoRuns],
  );
  useEffect(() => {
    if (!anyVideoRunning) return;
    const t = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [anyVideoRunning]);

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

  // Generated images available to drop into a frame slot (this session, both modes).
  const framePickerUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const run of runs) for (const item of run.items) for (const img of item.images) urls.add(img.url);
    return [...urls];
  }, [runs]);

  // Video spend across every stored video run.
  const videoSpend = useMemo(() => {
    let total = 0;
    let count = 0;
    for (const run of videoRuns)
      for (const item of run.items)
        if (item.status === "done") {
          total += item.actualCost ?? 0;
          count += 1;
        }
    return { total, count };
  }, [videoRuns]);

  // Flat gallery of every generated image, for the lightbox.
  const gallery = useMemo<GalleryImage[]>(() => {
    const arr: GalleryImage[] = [];
    for (const run of runs)
      for (const item of run.items)
        item.images.forEach((img, i) =>
          arr.push({
            url: img.url,
            modelLabel: item.modelLabel,
            prompt: item.prompt ?? run.prompt, // older runs predate per-item prompt
            promptKind: item.promptKind,
            params: item.params,
            refUrls: item.refUrls,
            key: `${run.id}:${item.id ?? item.modelKey}:${i}`,
          }),
        );
    return arr;
  }, [runs]);
  const indexByKey = useMemo(() => {
    const m = new Map<string, number>();
    gallery.forEach((g, i) => m.set(g.key, i));
    return m;
  }, [gallery]);

  const [lightbox, setLightbox] = useState<{ images: GalleryImage[]; index: number } | null>(null);
  const openImage = useCallback(
    (runId: string, itemId: string, imgIdx: number) => {
      const idx = indexByKey.get(`${runId}:${itemId}:${imgIdx}`);
      if (idx != null) setLightbox({ images: gallery, index: idx });
    },
    [indexByKey, gallery],
  );
  const openRefs = useCallback((urls: string[], index: number, label: string) => {
    setLightbox({
      images: urls.map((u, i) => ({
        url: u,
        modelLabel: `Reference ${i + 1}/${urls.length}`,
        prompt: label,
        key: `ref:${label}:${u}:${i}`,
      })),
      index,
    });
  }, []);

  // "beautified" needs a non-empty beautified prompt; "original"/"both" always need the typed one.
  const sendReady = effectiveSendMode === "beautified" ? hasBeautified : prompt.trim().length > 0;
  // Video gate: a start/start-end model needs a start frame; end stays optional.
  const videoStartMissing = videoModel.inputMode !== "text" && !startFrame;
  const canGenerate =
    Boolean(apiKey) &&
    sendReady &&
    !generating &&
    (isVideo ? !videoStartMissing : activeModels.length > 0);

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
    const originalText = prompt.trim();
    const beautifiedText = beautified.trim();
    // Which prompt variant(s) each model runs with. "both" → original first, then beautified.
    const variants: { kind: PromptKind; text: string }[] =
      effectiveSendMode === "beautified"
        ? [{ kind: "beautified", text: beautifiedText }]
        : effectiveSendMode === "both"
          ? [
              { kind: "original", text: originalText },
              { kind: "beautified", text: beautifiedText },
            ]
          : [{ kind: "original", text: originalText }];

    // Flatten (model × variant) into discrete jobs, each with its own item id.
    const jobs = models.flatMap((m) =>
      variants.map((v) => ({ id: uid(), model: m, kind: v.kind, text: v.text })),
    );

    const run: GenerationRun = {
      id: runId,
      createdAt: Date.now(),
      prompt: originalText, // header / "your prompt" reference stays the typed text
      referenceUrls: imageUrls,
      items: jobs.map(({ id, model: m, kind, text }) => {
        const s = settingsFor(m.key);
        const input = buildInput(m, text, imageUrls, s);
        return {
          id,
          modelKey: m.key,
          modelLabel: m.label,
          prompt: text,
          promptKind: kind,
          status: "running" as const,
          images: [],
          unitCost: unitCost(m, s, baseFor(m)),
          estimatedCost: estimateCost(m, s, baseFor(m)),
          settings: s,
          params: paramsOf(input),
          refUrls: Array.isArray(input.image_urls) ? (input.image_urls as string[]) : undefined,
        };
      }),
    };
    setRuns((prev) => [run, ...prev]);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    await Promise.all(
      jobs.map(async ({ id, model: m, text }) => {
        const s = settingsFor(m.key);
        try {
          const { images, seed } = await runModel(m, text, imageUrls, s, (line) =>
            setLogLines((prev) => ({ ...prev, [id]: line })),
          );
          const base = run.items.find((it) => it.id === id)?.params ?? {};
          const params = seed != null ? { ...base, seed } : base;
          updateItem(runId, id, {
            status: "done",
            images,
            actualCost: unitCost(m, s, baseFor(m)) * images.length,
            params,
          });
        } catch (e) {
          updateItem(runId, id, { status: "error", error: errMsg(e) });
        }
      }),
    );

    setGenerating(false);
    refreshCredits(); // balance dropped after spending
  }, [canGenerate, apiKey, references, activeModels, prompt, beautified, effectiveSendMode, settingsFor, setRuns, updateItem, refreshPrices, livePrices, refreshCredits]);

  // Video generate — single model, optional start/end frames, prompt variant(s).
  // Long-running: streams queue/log status per item; no resume after refresh.
  const handleGenerateVideo = useCallback(async () => {
    if (!canGenerate) return;
    setGenerating(true);
    setVideoStatus({});

    const m = videoModel;

    // Upload any File frames; pass URL frames straight through. Start required for
    // start/start-end models (gated above); end is optional.
    let startUrl: string | undefined;
    let endUrl: string | undefined;
    try {
      configureFal(apiKey);
      if (m.inputMode !== "text" && startFrame) {
        startUrl = startFrame.kind === "file" ? await uploadReference(startFrame.file) : startFrame.url;
      }
      if (m.inputMode === "start-end" && endFrame) {
        endUrl = endFrame.kind === "file" ? await uploadReference(endFrame.file) : endFrame.url;
      }
    } catch (e) {
      alert("Failed to upload frame images:\n" + errMsg(e));
      setGenerating(false);
      return;
    }
    const frames = { startUrl, endUrl };

    // Price against fresh Fal numbers right before generating.
    const fresh = await refreshPrices([m.id]);
    const priceMap = fresh ? { ...livePrices, ...fresh } : livePrices;
    const liveBase = liveVideoBaseFromPrice(priceMap[m.id]);

    const runId = uid();
    const originalText = prompt.trim();
    const beautifiedText = beautified.trim();
    const variants: { kind: PromptKind; text: string }[] =
      effectiveSendMode === "beautified"
        ? [{ kind: "beautified", text: beautifiedText }]
        : effectiveSendMode === "both"
          ? [
              { kind: "original", text: originalText },
              { kind: "beautified", text: beautifiedText },
            ]
          : [{ kind: "original", text: originalText }];

    const s = videoSettingsFor(m.key);
    const jobs = variants.map((v) => ({ id: uid(), kind: v.kind, text: v.text }));

    const run: VideoRun = {
      id: runId,
      createdAt: Date.now(),
      prompt: originalText,
      items: jobs.map(({ id, kind, text }) => {
        const input = buildVideoInput(m, text, frames, s);
        return {
          id,
          modelKey: m.key,
          modelLabel: m.label,
          prompt: text,
          promptKind: kind,
          status: "running" as const,
          estimatedCost: estimateVideoCost(m, s, liveBase),
          settings: s,
          params: videoParamsOf(input),
          startUrl,
          endUrl,
        };
      }),
    };
    setVideoRuns((prev) => [run, ...prev]);
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

    await Promise.all(
      jobs.map(async ({ id, text }) => {
        try {
          const video = await runVideoModel(m, text, frames, s, (st) =>
            setVideoStatus((prev) => ({
              ...prev,
              [id]:
                st.phase === "queued"
                  ? `in queue${st.queuePosition != null ? ` · #${st.queuePosition}` : ""}…`
                  : st.log ?? "rendering…",
            })),
          );
          updateVideoItem(runId, id, {
            status: "done",
            video,
            actualCost: estimateVideoCost(m, s, liveBase),
          });
        } catch (e) {
          updateVideoItem(runId, id, { status: "error", error: errMsg(e) });
        }
      }),
    );

    setGenerating(false);
    refreshCredits();
  }, [canGenerate, apiKey, videoModel, startFrame, endFrame, prompt, beautified, effectiveSendMode, videoSettingsFor, setVideoRuns, updateVideoItem, refreshPrices, livePrices, refreshCredits]);

  const resetAll = useCallback(() => {
    if (!confirm("Reset everything? This clears your key, prompt history, results and references.")) return;
    references.forEach((r) => r.kind === "file" && URL.revokeObjectURL(r.previewUrl));
    setApiKey("");
    setHistory([]);
    setRuns([]);
    setReferences([]);
    setPrompt("");
    setStashedPrompt(null);
    setBeautified("");
    setBeautifySource(null);
    setBeautifyError(null);
    setSendMode("original");
    setSelectedKeys(["nano-banana"]);
    setSettings({});
    setLightbox(null);
    // video path
    setVideoRuns([]);
    setVideoStatus({});
    setVideoKey("veo3.1-text");
    setVideoSettings({});
    setStartFrame((f) => (clearFrame(f), null));
    setEndFrame((f) => (clearFrame(f), null));
    loadEnvKey(); // restore the dev env key if present
  }, [references, setApiKey, setHistory, setRuns, setVideoRuns, clearFrame, loadEnvKey]);

  // Export / import the whole session (share progress with others).
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportSession = useCallback(() => {
    if (apiKey && !confirm("⚠️ The exported file includes your Fal API key. Only share it with people you trust. Continue?")) {
      return;
    }
    const data: SessionExport = {
      app: "fal-prompt-playground",
      version: 2, // bumped: v2 carries video runs + the active mode
      exportedAt: new Date().toISOString(),
      key: apiKey,
      promptHistory: history,
      runs,
      selectedKeys,
      settings,
      references: references.flatMap((r) =>
        r.kind === "url" ? [{ url: r.url, origin: r.origin, ...(r.label ? { label: r.label } : {}) }] : [],
      ),
      // video additions (v2+)
      mode,
      videoRuns,
      videoSelectedKey: videoKey,
      videoSettings,
    };
    const blob = new Blob([encodeSession(data)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fal-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.falsession`;
    a.click();
    URL.revokeObjectURL(url);
  }, [apiKey, history, runs, selectedKeys, settings, references, mode, videoRuns, videoKey, videoSettings]);

  const importSession = useCallback(
    async (file: File) => {
      let data: Partial<SessionExport>;
      try {
        data = decodeSession(await file.text());
      } catch {
        alert("Couldn't read that file — it isn't a valid session export.");
        return;
      }
      if (data?.app !== "fal-prompt-playground" && !confirm("This doesn't look like a Fal Playground session file. Import anyway?")) {
        return;
      }
      if (!confirm("⚠️ Import OVERWRITES your current session — key, prompts, results and selection will be replaced. Continue?")) {
        return;
      }
      references.forEach((r) => r.kind === "file" && URL.revokeObjectURL(r.previewUrl));
      setApiKey(typeof data.key === "string" ? data.key : "");
      setHistory(Array.isArray(data.promptHistory) ? data.promptHistory : []);
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setSelectedKeys(Array.isArray(data.selectedKeys) && data.selectedKeys.length ? data.selectedKeys : ["nano-banana"]);
      setSettings(data.settings && typeof data.settings === "object" ? data.settings : {});
      setReferences(
        Array.isArray(data.references)
          ? data.references
              .filter((r) => r?.url)
              .map((r) => ({
                kind: "url" as const,
                id: uid(),
                url: r.url,
                origin: r.origin === "manual" ? "manual" : "generated",
                ...(r.label ? { label: r.label } : {}),
              }))
          : [],
      );
      setStashedPrompt(null);
      setBeautified("");
      setBeautifySource(null);
      setBeautifyError(null);
      setSendMode("original");
      setLightbox(null);
      // video path (optional in v1 files; defaults keep legacy imports working)
      setMode(data.mode === "video" ? "video" : "image");
      setVideoRuns(Array.isArray(data.videoRuns) ? data.videoRuns : []);
      setVideoKey(
        typeof data.videoSelectedKey === "string" && VIDEO_MODEL_BY_KEY[data.videoSelectedKey]
          ? data.videoSelectedKey
          : "veo3.1-text",
      );
      setVideoSettings(data.videoSettings && typeof data.videoSettings === "object" ? data.videoSettings : {});
      setVideoStatus({});
      setStartFrame((f) => (clearFrame(f), null));
      setEndFrame((f) => (clearFrame(f), null));
    },
    [references, setApiKey, setHistory, setRuns, setMode, setVideoRuns, clearFrame],
  );

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
            Test prompts on Fal.ai {isVideo ? "video" : "image"} models — no code. Everything stays in your browser.
          </p>
          {/* Top-level mode toggle — Images | Video. Persisted across reloads. */}
          <div className="mt-3 inline-flex overflow-hidden rounded-lg border border-neutral-300">
            {(["image", "video"] as const).map((md) => (
              <button
                key={md}
                type="button"
                onClick={() => setMode(md)}
                className={`px-4 py-1.5 text-sm font-medium transition ${
                  mode === md ? "bg-amber-400 text-amber-950" : "bg-white text-neutral-600 hover:bg-amber-50"
                }`}
              >
                {md === "image" ? "🖼 Images" : "🎬 Video"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={exportSession}
            title="Download your whole session (key, prompts, results) as a file"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-amber-300 hover:text-amber-700"
          >
            Export session
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Load a session file — this overwrites your current work"
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-amber-300 hover:text-amber-700"
          >
            Import session
          </button>
          <button
            type="button"
            onClick={resetAll}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-red-300 hover:text-red-600"
          >
            Reset all
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".falsession,.json,.txt,application/json,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importSession(f);
              e.target.value = "";
            }}
          />
        </div>
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

      {/* STEP 2 — MODEL (video mode; single-select) */}
      {isVideo && (
        <Section step={2} title="Model" done={Boolean(videoModel)}>
          <p className="mb-3 text-sm text-neutral-500">
            Pick <b>one</b> video model. Selecting a <b>text</b> model hides the frame slots; an{" "}
            <b>image</b> model reveals Start (and optional End) in step 3.
          </p>
          <div className="space-y-5">
            {VIDEO_MODEL_GROUPS.map((group) => (
              <div key={group}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{group}</p>
                <div className="space-y-2">
                  {VIDEO_MODELS.filter((m) => m.group === group).map((m) => (
                    <VideoModelRow
                      key={m.key}
                      model={m}
                      selected={videoKey === m.key}
                      settings={videoSettingsFor(m.key)}
                      live={liveVideoBaseFor(m)}
                      onSelect={() => setVideoKey(m.key)}
                      onPatch={(patch) => patchVideoSettings(m.key, patch)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* STEP 2 — REFERENCES (image mode only) */}
      {!isVideo && (
      <Section step={2} title="Reference images (optional)" done={hasReferences}>
        <p className="mb-3 text-sm text-neutral-500">
          Upload any number of images. Used by <b>edit</b> models; <b>generate</b> models ignore them.
        </p>
        <Dropzone onFiles={addFiles} />
        {hasReferences && (
          <>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {references.map((ref, idx) => (
                <figure key={ref.id} className="group flex flex-col gap-1">
                  <div className="relative overflow-hidden rounded-lg border border-neutral-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={ref.kind === "file" ? ref.previewUrl : ref.url}
                      alt="reference"
                      className="aspect-square w-full object-cover"
                    />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                      image {idx + 1}
                    </span>
                    {ref.kind === "url" && ref.origin === "generated" && (
                      <span className="absolute left-1 bottom-1 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">
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
                  </div>
                  <input
                    type="text"
                    value={ref.label ?? ""}
                    onChange={(e) => setReferenceLabel(ref.id, e.target.value)}
                    placeholder="rola/opis…"
                    title="Rola tej referencji (np. logo klienta, aktorka) — trafia do upiększacza jako opis image N"
                    className="w-full rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-100"
                  />
                </figure>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              Opisy ról (kolejność = „image 1, image 2…") trafiają do upiększacza promptów. Bez analizy pikseli.
            </p>
          </>
        )}
        {hasReferences && !hasEditSelected && (
          <p className="mt-3 rounded-lg bg-amber-100/80 px-3 py-2 text-xs text-amber-900">
            ⚠ None of your selected models use reference images. Pick an <b>edit / image-to-image</b> model in step 4
            to apply them — otherwise they’re ignored.
          </p>
        )}
      </Section>
      )}

      {/* STEP 3 — FRAMES (video mode only) */}
      {isVideo && (
        <Section
          step={3}
          title="Frames"
          done={videoModel.inputMode === "text" || Boolean(startFrame)}
        >
          {videoModel.inputMode === "text" ? (
            <p className="text-sm text-neutral-500">
              <b>{videoModel.label}</b> is text-to-video — it needs no input frames. Pick an{" "}
              <b>image</b> model in step 2 to animate a start (and optional end) frame.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-neutral-500">
                Drop or pick a <b>start frame</b>
                {videoModel.inputMode === "start-end" && (
                  <>
                    {" "}
                    and an optional <b>end frame</b>
                  </>
                )}
                . You can reuse any image generated in this session (“generate image → animate it”).
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FrameSlot
                  label="Start frame"
                  required
                  frame={startFrame}
                  pickerUrls={framePickerUrls}
                  onFile={(f) => setFrameFile("start", f)}
                  onUrl={(u) => setFrameUrl("start", u)}
                  onClear={() => setFrame("start", null)}
                />
                {videoModel.inputMode === "start-end" && (
                  <FrameSlot
                    label="End frame (optional)"
                    frame={endFrame}
                    pickerUrls={framePickerUrls}
                    onFile={(f) => setFrameFile("end", f)}
                    onUrl={(u) => setFrameUrl("end", u)}
                    onClear={() => setFrame("end", null)}
                  />
                )}
              </div>
              {videoStartMissing && (
                <p className="mt-3 text-xs font-medium text-red-500">
                  A start frame is required for this model — add one to generate.
                </p>
              )}
            </>
          )}
        </Section>
      )}

      {/* STEP 3 — PROMPT (image mode) / STEP 4 — PROMPT (video mode) */}
      <Section step={isVideo ? 4 : 3} title="Prompt" done={prompt.trim().length > 0}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Describe what to generate, or how to change the references…"
          className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={savePrompt}
            disabled={!prompt.trim()}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            Save to history
          </button>
          {prompt && (
            <button type="button" onClick={clearPrompt} className="text-sm text-neutral-500 hover:text-neutral-800">
              Clear
            </button>
          )}
          {stashedPrompt != null && stashedPrompt !== prompt && (
            <span className="ml-auto flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1">
              <button
                type="button"
                onClick={restoreStash}
                title={stashedPrompt}
                className="text-sm font-medium text-amber-700 hover:text-amber-800"
              >
                ↩ Restore unsaved prompt
              </button>
              <button
                type="button"
                onClick={() => setStashedPrompt(null)}
                title="Dismiss"
                aria-label="Dismiss"
                className="text-amber-500 hover:text-red-500"
              >
                ✕
              </button>
            </span>
          )}
        </div>

        {/* Prompt beautifier ("Upiększacz") — strategy + language + ✨ wand */}
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium text-amber-900">
              <span>✨ Automatyczne upiększanie przez </span>
              {beautifyInfo?.name && <span className="text-amber-700">{beautifyInfo.name}</span>}
              {beautifyInfo && !beautifyInfo.available && (
                <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-normal text-orange-700">
                  nieskonfigurowane — ustaw OPENROUTER_API_KEY
                </span>
              )}
              {beautifyInfo?.systemPrompt && (
                <span className="group relative ml-auto inline-flex">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-1.5 py-0.5 text-[11px] font-normal text-amber-700 hover:bg-amber-100"
                    aria-label="Pokaż prompt systemowy upiększacza"
                  >
                    ⓘ prompt systemowy
                  </button>
                  <span
                    role="tooltip"
                    className="invisible absolute right-0 top-full z-30 max-h-80 w-[min(90vw,34rem)] overflow-auto whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-3 text-left font-mono text-[11px] font-normal leading-relaxed text-neutral-700 opacity-0 shadow-xl transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                  >
                    {beautifyInfo.systemPrompt}
                  </span>
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">
              Przepisuje Twój prompt modelem językowym, dodając szczegóły i porządkując opis. Wynik trafia do
              osobnego, edytowalnego pola poniżej.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Select
              label="Styl"
              value={strength}
              onChange={(v) => setStrength(v as BeautifyStrength)}
              options={STRENGTH_OPTS}
            />
            <Select
              label="Język"
              value={language}
              onChange={(v) => setLanguage(v as BeautifyLanguage)}
              options={LANGUAGE_OPTS}
            />
            <button
              type="button"
              onClick={handleBeautify}
              disabled={!prompt.trim() || beautifying}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 font-medium text-amber-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
              title="Przepisz prompt modelem językowym (OpenRouter)"
            >
              {beautifying ? (
                <>
                  <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-amber-950/30 border-t-amber-950" />
                  Upiększam…
                </>
              ) : (
                <>✨ Upiększ</>
              )}
            </button>
          </div>

          {beautifyError && (
            <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">⚠ {beautifyError}</p>
          )}

          {hasBeautified && (
            <div className="mt-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                  ✨ Upiększony
                </span>
                {beautifyStale && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700"
                    title="Zmieniłeś oryginalny prompt po upiększeniu — upiększ ponownie lub edytuj ręcznie."
                  >
                    ⚠ nieaktualny
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setBeautified("");
                    setBeautifySource(null);
                    setBeautifyError(null);
                    setSendMode("original");
                  }}
                  className="ml-auto text-xs text-neutral-500 hover:text-red-500"
                >
                  Usuń
                </button>
              </div>
              <textarea
                value={beautified}
                onChange={(e) => setBeautified(e.target.value)}
                rows={5}
                placeholder="Upiększony prompt pojawi się tutaj — możesz go edytować."
                className="w-full resize-y rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
            </div>
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
                    onClick={() => loadFromHistory(h.text)}
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

      {/* STEP 4 — MODELS (image mode) */}
      {!isVideo && (
      <Section step={4} title="Models" done={activeModels.length > 0}>
        <div className="space-y-5">
          {MODEL_GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">{group}</p>
              <div className="space-y-2">
                {MODELS.filter((m) => m.group === group).map((m) => {
                  const editVariant =
                    m.mode === "generate"
                      ? MODELS.find((x) => x.family === m.family && x.mode === "edit")
                      : undefined;
                  return (
                    <ModelRow
                      key={m.key}
                      model={m}
                      selected={selectedKeys.includes(m.key)}
                      blocked={m.needsReferences && !hasReferences}
                      ignoresRefs={hasReferences && m.mode === "generate" && selectedKeys.includes(m.key)}
                      editVariantLabel={editVariant?.label}
                      onUseEditVariant={editVariant ? () => switchToEdit(m.key, editVariant.key) : undefined}
                      settings={settingsFor(m.key)}
                      liveBase={liveBaseFor(m)}
                      onToggle={() => toggleModel(m.key)}
                      onPatch={(patch) => patchSettings(m.key, patch)}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>
      )}

      {/* RESULTS */}
      <div ref={resultsRef}>
        {!isVideo && runs.length > 0 && (
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
                  onOpenImage={(itemId, imgIdx) => openImage(run.id, itemId, imgIdx)}
                  onOpenRefs={openRefs}
                  onDelete={() => setRuns((prev) => prev.filter((r) => r.id !== run.id))}
                />
              ))}
            </div>
          </div>
        )}

        {/* VIDEO RESULTS */}
        {isVideo && videoRuns.length > 0 && (
          <div className="mt-10">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                Video results{" "}
                <span className="ml-1 text-sm font-normal text-neutral-500">· {videoSpend.count} clip{videoSpend.count === 1 ? "" : "s"} · spent {usd(videoSpend.total)}</span>
              </h2>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Delete all video results from your browser?")) setVideoRuns([]);
                }}
                className="text-sm text-neutral-500 hover:text-red-500"
              >
                Clear results
              </button>
            </div>
            <p className="mb-3 rounded-lg bg-amber-100/80 px-3 py-2 text-xs text-amber-900">
              ⏳ Video jobs can take a while. <b>Keep this tab open</b> — there is no resume after a reload.
            </p>
            <div className="space-y-6">
              {videoRuns.map((run) => (
                <VideoRunCard
                  key={run.id}
                  run={run}
                  status={videoStatus}
                  onDelete={() => setVideoRuns((prev) => prev.filter((r) => r.id !== run.id))}
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
              {isVideo ? (
                <>
                  {`${videoModel.label} · ${effectiveDuration(videoModel, videoSettingsFor(videoModel.key))}s`}
                  {effectiveSendMode === "both" && <span className="text-amber-700"> · ×2 (Twój + Upiększony)</span>}
                </>
              ) : (
                <>
                  {activeModels.length > 0
                    ? costRows.map((r) => `${r.model.label} ${usd(r.cost)}`).join(" · ")
                    : "Add a key, a prompt and pick at least one model."}
                  {effectiveSendMode === "both" && activeModels.length > 0 && (
                    <span className="text-amber-700"> · ×2 (Twój + Upiększony)</span>
                  )}
                </>
              )}
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
          <div className="flex items-stretch gap-3">
            {/* "Wyślij" — which prompt variant(s) to send. Locked until a beautified prompt exists. */}
            <div className="flex flex-col justify-center">
              <span className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">Wyślij</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-neutral-300">
                {SEND_OPTS.map((opt) => {
                  const locked = opt.value !== "original" && !hasBeautified;
                  const selected = effectiveSendMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={locked}
                      onClick={() => setSendMode(opt.value)}
                      title={locked ? "Najpierw upiększ prompt (✨ Upiększ)" : undefined}
                      className={`px-2.5 py-1.5 text-xs font-medium transition ${
                        selected
                          ? "bg-amber-400 text-amber-950"
                          : locked
                            ? "cursor-not-allowed bg-neutral-50 text-neutral-300"
                            : "bg-white text-neutral-600 hover:bg-amber-50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {credits && (
              <div className="flex flex-col justify-center rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-2 text-right">
                <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Fal balance</span>
                <span className="text-lg font-semibold leading-tight text-neutral-800">
                  {formatMoney(credits.balance, credits.currency)}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={isVideo ? handleGenerateVideo : handleGenerate}
              disabled={!canGenerate}
              className="rounded-xl bg-amber-400 px-6 py-2.5 font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
            >
              {generating
                ? "Generating…"
                : isVideo
                  ? `Generate video (≈ ${usd(totalEstimate)})`
                  : `Generate (≈ ${usd(totalEstimate)})`}
            </button>
          </div>
        </div>
      </div>

      {lightbox && lightbox.images[lightbox.index] && (
        <Lightbox
          images={lightbox.images}
          index={lightbox.index}
          onIndex={(i) => setLightbox((lb) => (lb ? { ...lb, index: i } : lb))}
          onClose={() => setLightbox(null)}
          onOpenRefs={openRefs}
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

function ParamChips({ params, tone = "light" }: { params?: Record<string, unknown>; tone?: "light" | "dark" }) {
  const entries = params ? Object.entries(params) : [];
  if (!entries.length) return null;
  const chip = tone === "dark" ? "bg-white/10 text-white/80" : "bg-neutral-100 text-neutral-600";
  const key = tone === "dark" ? "text-white/50" : "text-neutral-400";
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className={`rounded px-1.5 py-0.5 text-[11px] ${chip}`}>
          <span className={key}>{PARAM_LABELS[k] ?? k}:</span> {paramText(v)}
        </span>
      ))}
    </div>
  );
}

function RefThumbs({
  urls,
  tone = "light",
  onOpen,
}: {
  urls?: string[];
  tone?: "light" | "dark";
  onOpen?: (index: number) => void;
}) {
  if (!urls?.length) return null;
  const label = tone === "dark" ? "text-white/50" : "text-neutral-400";
  const border = tone === "dark" ? "border-white/20" : "border-neutral-200";
  const cls = `block overflow-hidden rounded border ${border}`;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`shrink-0 text-[11px] ${label}`}>based on:</span>
      <div className="flex flex-wrap gap-1">
        {urls.map((u, i) =>
          onOpen ? (
            <button key={i} type="button" onClick={() => onOpen(i)} title="Open in lightbox" className={cls}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="reference" className="size-9 object-cover" />
            </button>
          ) : (
            <a key={i} href={u} target="_blank" rel="noreferrer" title="Open reference image" className={cls}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="reference" className="size-9 object-cover" />
            </a>
          ),
        )}
      </div>
    </div>
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
  ignoresRefs,
  editVariantLabel,
  onUseEditVariant,
  settings,
  liveBase,
  onToggle,
  onPatch,
}: {
  model: ModelDef;
  selected: boolean;
  blocked: boolean;
  ignoresRefs: boolean;
  editVariantLabel?: string;
  onUseEditVariant?: () => void;
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
      <div className="flex items-start gap-3">
        <label className="flex flex-1 cursor-pointer items-start gap-3">
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
        </label>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {active && (
            <span className="text-sm font-semibold text-amber-700">{usd(estimateCost(model, settings, liveBase))}</span>
          )}
          <a
            href={`https://fal.ai/models/${model.id}/api`}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap text-xs text-neutral-400 hover:text-amber-600"
            title={`Open ${model.id} API docs on fal.ai`}
          >
            API ↗
          </a>
        </div>
      </div>

      {ignoresRefs && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-100/80 px-3 py-2 text-xs text-amber-900">
          <span>⚠ This model generates from the prompt only — your reference images won’t be used.</span>
          {onUseEditVariant && (
            <button
              type="button"
              onClick={onUseEditVariant}
              className="rounded-md bg-amber-500 px-2 py-1 font-medium text-amber-950 hover:bg-amber-400"
            >
              Use {editVariantLabel ?? "the edit model"} instead
            </button>
          )}
        </div>
      )}

      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-amber-200/70 pt-3 pl-7 text-sm">
          {model.fields.map((field) => {
            if (field.kind === "images") {
              return (
                <Select
                  key="images"
                  label="Images"
                  value={settings.numImages}
                  onChange={(v) => onPatch({ numImages: Number(v) })}
                  options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))}
                />
              );
            }
            if (field.kind === "seed") {
              return <SeedField key="seed" value={settings.seed} onChange={(v) => onPatch({ seed: v })} />;
            }
            const value =
              field.key === "resolution"
                ? effectiveResolution(model, settings)
                : field.key === "size"
                  ? effectiveSize(model, settings)
                  : settings[field.key];
            return (
              <Select
                key={field.key}
                label={field.label}
                value={value}
                onChange={(v) => onPatch({ [field.key]: v } as Partial<ModelSettings>)}
                options={field.options}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function SeedField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-neutral-500">Seed</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
        placeholder="random"
        className="w-24 rounded-md border border-neutral-300 bg-white px-2 py-1"
      />
      <button
        type="button"
        onClick={() => onChange(String(Math.floor(Math.random() * 1_000_000_000)))}
        title="Random seed"
        className="rounded-md border border-neutral-300 bg-white px-1.5 py-1 leading-none hover:bg-neutral-50"
      >
        🎲
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear seed (random)"
          className="text-neutral-400 hover:text-red-500"
        >
          ✕
        </button>
      )}
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

// Variant badge: "Twój prompt" / "✨ Upiększony".
function PromptKindBadge({ kind, tone = "light" }: { kind?: PromptKind; tone?: "light" | "dark" }) {
  const beautified = kind === "beautified";
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium";
  const cls = beautified
    ? tone === "dark"
      ? "bg-amber-400/30 text-amber-200"
      : "bg-amber-200 text-amber-900"
    : tone === "dark"
      ? "bg-white/10 text-white/70"
      : "bg-neutral-100 text-neutral-600";
  return <span className={`${base} ${cls}`}>{beautified ? "✨ Upiększony" : "Twój prompt"}</span>;
}

// Collapsible, whitespace-preserving prompt with a variant badge. Replaces the old `truncate`.
function PromptBlock({
  prompt,
  kind,
  tone = "light",
}: {
  prompt: string;
  kind?: PromptKind;
  tone?: "light" | "dark";
}) {
  const [expanded, setExpanded] = useState(false);
  if (!prompt) return null;
  const longish = prompt.length > 140 || prompt.includes("\n");
  const moreCls = tone === "dark" ? "text-amber-300 hover:text-amber-200" : "text-amber-600 hover:text-amber-700";
  const textCls = tone === "dark" ? "text-white/80" : "text-neutral-700";
  return (
    <div className="flex flex-col gap-1">
      <PromptKindBadge kind={kind} tone={tone} />
      <p className={`whitespace-pre-wrap text-sm ${textCls} ${expanded ? "" : "line-clamp-2"}`}>{prompt}</p>
      {longish && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`self-start text-xs font-medium ${moreCls}`}
        >
          {expanded ? "pokaż mniej" : "pokaż więcej"}
        </button>
      )}
    </div>
  );
}

function RunCard({
  run,
  logLines,
  onUseAsReference,
  onOpenImage,
  onOpenRefs,
  onDelete,
}: {
  run: GenerationRun;
  logLines: Record<string, string>;
  onUseAsReference: (url: string) => void;
  onOpenImage: (itemId: string, imgIdx: number) => void;
  onOpenRefs: (urls: string[], index: number, label: string) => void;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-neutral-400">
            {new Date(run.createdAt).toLocaleString()}
            {run.referenceUrls.length > 0 && ` · ${run.referenceUrls.length} reference(s)`}
          </p>
        </div>
        <button type="button" onClick={onDelete} className="text-sm text-neutral-400 hover:text-red-500">
          Delete
        </button>
      </div>

      <div className="space-y-5">
        {run.items.map((item) => (
          <div key={item.id ?? item.modelKey}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{item.modelLabel}</span>
              {item.status === "running" && (
                <span className="text-amber-600">⏳ {logLines[item.id] ?? "working…"}</span>
              )}
              {item.status === "done" && (
                <span className="text-green-600">
                  ✓ {item.images.length} image{item.images.length === 1 ? "" : "s"} · {usd(item.actualCost ?? 0)}
                </span>
              )}
              {item.status === "error" && <span className="text-red-500">error</span>}
            </div>

            {item.prompt && (
              <div className="mb-2 rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2">
                <PromptBlock prompt={item.prompt} kind={item.promptKind} />
              </div>
            )}

            {item.params && (
              <div className="mb-2">
                <ParamChips params={item.params} />
              </div>
            )}

            {item.refUrls && item.refUrls.length > 0 && (
              <div className="mb-2">
                <RefThumbs
                  urls={item.refUrls}
                  onOpen={(i) => onOpenRefs(item.refUrls!, i, `Reference for ${item.modelLabel}`)}
                />
              </div>
            )}

            {item.status === "error" && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{item.error}</p>
            )}

            {item.images.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {item.images.map((img, i) => (
                  <figure key={i} className="overflow-hidden rounded-lg border border-neutral-200">
                    <button
                      type="button"
                      onClick={() => onOpenImage(item.id, i)}
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
  onOpenRefs,
}: {
  images: GalleryImage[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onOpenRefs: (urls: string[], index: number, label: string) => void;
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
        <div className="min-w-0 max-w-[60vw]">
          <div className="text-sm font-medium">{cur.modelLabel}</div>
          {cur.promptKind ? (
            <div className="mt-1 max-h-32 overflow-auto">
              <PromptBlock prompt={cur.prompt} kind={cur.promptKind} tone="dark" />
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-xs text-white/60">{cur.prompt}</div>
          )}
          {cur.params && (
            <div className="mt-1">
              <ParamChips params={cur.params} tone="dark" />
            </div>
          )}
          {cur.refUrls && cur.refUrls.length > 0 && (
            <div className="mt-1">
              <RefThumbs
                urls={cur.refUrls}
                tone="dark"
                onOpen={(i) => onOpenRefs(cur.refUrls!, i, `Reference for ${cur.modelLabel}`)}
              />
            </div>
          )}
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

/* --------------------------- video subcomponents ------------------------- */

// A Start / End frame slot: drag-drop or click to upload, or pick a generated
// image from this session. Shows a thumbnail + clear when filled.
function FrameSlot({
  label,
  required,
  frame,
  pickerUrls,
  onFile,
  onUrl,
  onClear,
}: {
  label: string;
  required?: boolean;
  frame: VideoFrame | null;
  pickerUrls: string[];
  onFile: (file: File) => void;
  onUrl: (url: string) => void;
  onClear: () => void;
}) {
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-medium text-neutral-700">
        <span>{label}</span>
        {required && <span className="text-[11px] font-normal text-red-500">required</span>}
      </div>

      {frame ? (
        <figure className="relative overflow-hidden rounded-xl border border-neutral-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={frameSrc(frame)} alt={label} className="aspect-video w-full object-cover" />
          <button
            type="button"
            onClick={onClear}
            className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/80"
          >
            Clear
          </button>
        </figure>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex aspect-video cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition ${
            over ? "border-amber-400 bg-amber-50" : "border-neutral-300 hover:border-amber-300"
          }`}
        >
          <span className="text-neutral-600">Drop an image or click to choose</span>
          <span className="mt-0.5 text-xs text-neutral-400">PNG, JPG, WebP</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      {pickerUrls.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            className="text-xs font-medium text-amber-600 hover:text-amber-700"
          >
            {picking ? "Hide" : `Use a generated image (${pickerUrls.length})`}
          </button>
          {picking && (
            <div className="mt-2 grid max-h-40 grid-cols-4 gap-1.5 overflow-auto rounded-lg border border-neutral-200 p-2 sm:grid-cols-5">
              {pickerUrls.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => {
                    onUrl(u);
                    setPicking(false);
                  }}
                  className="overflow-hidden rounded border border-neutral-200 hover:border-amber-400"
                  title="Use this frame"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="generated" className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// A single-select video model row with input-mode + audio badges, blurb, cost,
// and the schema-gated duration/aspect controls when selected.
function VideoModelRow({
  model,
  selected,
  settings,
  live,
  onSelect,
  onPatch,
}: {
  model: VideoModelDef;
  selected: boolean;
  settings: VideoSettings;
  live?: { base: number; unit: "second" | "video" };
  onSelect: () => void;
  onPatch: (patch: Partial<VideoSettings>) => void;
}) {
  return (
    <div
      className={`rounded-xl border p-3 transition ${
        selected ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"
      }`}
    >
      <div className="flex items-start gap-3">
        <label className="flex flex-1 cursor-pointer items-start gap-3">
          {/* radio — single-select */}
          <input type="radio" checked={selected} onChange={onSelect} className="mt-1 size-4 accent-amber-500" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{model.label}</span>
              <Badge>{VIDEO_MODE_BADGE[model.inputMode]}</Badge>
              {model.supportsAudio && <Badge>🔊 audio</Badge>}
              <Badge>{model.tier}</Badge>
            </div>
            <p className="text-sm text-neutral-500">{model.blurb}</p>
          </div>
        </label>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {selected && (
            <span className="text-sm font-semibold text-amber-700">{usd(estimateVideoCost(model, settings, live))}</span>
          )}
          <a
            href={`https://fal.ai/models/${model.id}/api`}
            target="_blank"
            rel="noreferrer"
            className="whitespace-nowrap text-xs text-neutral-400 hover:text-amber-600"
            title={`Open ${model.id} API docs on fal.ai`}
          >
            API ↗
          </a>
        </div>
      </div>

      {selected && model.fields.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-amber-200/70 pt-3 pl-7 text-sm">
          {hasVideoField(model, "durationSec") && (
            <Select
              label="Duration"
              value={String(effectiveDuration(model, settings))}
              onChange={(v) => onPatch({ durationSec: Number(v) })}
              options={(model.fields.find((f) => f.key === "durationSec")?.options ?? []).map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          )}
          {hasVideoField(model, "aspectRatio") && (
            <Select
              label="Aspect"
              value={effectiveAspectRatio(model, settings)}
              onChange={(v) => onPatch({ aspectRatio: v })}
              options={(model.fields.find((f) => f.key === "aspectRatio")?.options ?? []).map((o) => ({
                value: o.value,
                label: o.label,
              }))}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Elapsed time since a run was created, for in-flight video jobs (mm:ss).
function elapsed(from: number): string {
  const s = Math.max(0, Math.floor((Date.now() - from) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// A video run card: per-item status (queue/elapsed/log), inline <video> player on
// success, download link + actual cost; errors land on the card. Terminal output —
// no reuse / no frame extraction (decision #7).
function VideoRunCard({
  run,
  status,
  onDelete,
}: {
  run: VideoRun;
  status: Record<string, string>;
  onDelete: () => void;
}) {
  return (
    <article className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs text-neutral-400">{new Date(run.createdAt).toLocaleString()}</p>
        <button type="button" onClick={onDelete} className="text-sm text-neutral-400 hover:text-red-500">
          Delete
        </button>
      </div>

      <div className="space-y-5">
        {run.items.map((item) => (
          <div key={item.id}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{item.modelLabel}</span>
              {item.status === "running" && (
                <span className="text-amber-600">
                  ⏳ {status[item.id] ?? "working…"} · {elapsed(run.createdAt)}
                </span>
              )}
              {item.status === "done" && (
                <span className="text-green-600">✓ done · {usd(item.actualCost ?? item.estimatedCost)}</span>
              )}
              {item.status === "error" && <span className="text-red-500">error</span>}
            </div>

            {item.prompt && (
              <div className="mb-2 rounded-lg border border-neutral-100 bg-neutral-50/60 px-3 py-2">
                <PromptBlock prompt={item.prompt} kind={item.promptKind} />
              </div>
            )}

            {item.params && (
              <div className="mb-2">
                <VideoParamChips params={item.params} />
              </div>
            )}

            {(item.startUrl || item.endUrl) && (
              <div className="mb-2 flex items-center gap-1.5">
                <span className="shrink-0 text-[11px] text-neutral-400">frames:</span>
                <div className="flex gap-1">
                  {[item.startUrl, item.endUrl].filter(Boolean).map((u, i) => (
                    <a
                      key={i}
                      href={u as string}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded border border-neutral-200"
                      title={i === 0 ? "Start frame" : "End frame"}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u as string} alt="frame" className="size-9 object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {item.status === "error" && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{item.error}</p>
            )}

            {item.status === "done" && item.video?.url && (
              <figure className="overflow-hidden rounded-lg border border-neutral-200">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={item.video.url} controls className="w-full bg-black" />
                <div className="flex divide-x divide-neutral-200 border-t border-neutral-200 text-xs">
                  <a
                    href={item.video.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-1.5 text-center hover:bg-amber-50"
                    title="Download the video"
                  >
                    ↓ download
                  </a>
                  <a
                    href={item.video.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-1.5 text-center hover:bg-neutral-50"
                  >
                    open
                  </a>
                </div>
              </figure>
            )}

            {item.status === "running" && (
              <div className="flex aspect-video w-full animate-pulse items-center justify-center rounded-lg bg-neutral-100 text-sm text-neutral-400">
                rendering…
              </div>
            )}
          </div>
        ))}
      </div>
    </article>
  );
}

// Video param chips (duration / aspect), mirrors ParamChips for images.
function VideoParamChips({ params }: { params?: Record<string, unknown> }) {
  const entries = params ? Object.entries(params) : [];
  if (!entries.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">
          <span className="text-neutral-400">{VIDEO_PARAM_LABELS[k] ?? k}:</span> {paramText(v)}
        </span>
      ))}
    </div>
  );
}
