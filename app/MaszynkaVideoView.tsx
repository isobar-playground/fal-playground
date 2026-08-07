"use client";

// Maszynka Video — video pipeline test bench (PRD 0003, CONTEXT.md "Maszynka Video").
// A separate fifth tab from the existing Maszynka: the two pipelines share no stage,
// so this view has its own lib/maszynka-video/* module set and its own Neon table.
// Slice 1 (issue #24) is the walking skeleton: the spec's common fields (run name +
// the two paste-only fields) persisted server-side, plus the shared run history.
import { useCallback, useEffect, useState } from "react";
import {
  createVideoRun,
  getVideoRun,
  listVideoRuns,
  patchVideoRun,
  type VideoRun,
} from "@/lib/maszynka-video/api";

export default function MaszynkaVideoView() {
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

  const applyRun = useCallback((r: VideoRun) => {
    setRun(r);
    setName(r.name);
    setGlobalRules(r.globalRules);
    setPriorityLogic(r.priorityLogic);
  }, []);

  const handleCreateOrSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = run
        ? await patchVideoRun(run.id, { name, globalRules, priorityLogic })
        : await createVideoRun({ name, globalRules, priorityLogic });
      applyRun(saved);
      void refreshRuns();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save Video run");
    } finally {
      setSaving(false);
    }
  }, [run, name, globalRules, priorityLogic, applyRun, refreshRuns]);

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
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-8">
      <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">Video run</h2>
          {run && (
            <button
              type="button"
              onClick={handleNewRun}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              New run
            </button>
          )}
        </div>

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">Run name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Summer spot 30s — test 1"
          className="mb-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />

        {/* Paste-only fields: the app never authors global rules / priority logic
           content (PRD 0003 "Out of Scope") — no seeds, no defaults. */}
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Global rules (pasted)
        </label>
        <textarea
          value={globalRules}
          onChange={(e) => setGlobalRules(e.target.value)}
          rows={4}
          placeholder="Paste the global rules text…"
          className="mb-3 w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />

        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Priority logic (pasted)
        </label>
        <textarea
          value={priorityLogic}
          onChange={(e) => setPriorityLogic(e.target.value)}
          rows={4}
          placeholder="Paste the priority logic text…"
          className="mb-3 w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCreateOrSave()}
            disabled={!name.trim() || saving}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            {saving ? "Saving…" : run ? "Save changes" : "Create run"}
          </button>
          {run && <span className="font-mono text-xs text-neutral-400">run {run.id.slice(0, 8)}</span>}
        </div>
        {saveError && <p className="mt-2 text-sm text-red-600">{saveError}</p>}
      </section>

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
