"use client";

// Maszynka Configs section — slice 2 (extended by issue #16 to include stage_prompts).
// Lists the config kinds (server-side truth, see ADR 0001), lets an operator view any
// past version and save an edited JSON body as a new version (append-only — never
// UPDATE). No preset/hook names are hardcoded here; the *kind* identifiers are a fixed
// taxonomy (ADR 0001 / PRD), not preset content — everything inside a kind's body comes
// from Neon.
import { useCallback, useEffect, useState } from "react";
import {
  listConfigVersions,
  listLatestConfigs,
  saveConfigVersion,
  type ConfigKind,
  type MaszynkaConfigVersion,
} from "@/lib/maszynka/configApi";
import { CONFIG_KINDS, CONFIG_KIND_LABELS } from "@/lib/maszynka/configSchemas";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

export default function MaszynkaConfigs({ onSaved }: { onSaved?: () => void }) {
  const [overview, setOverview] = useState<Partial<Record<ConfigKind, MaszynkaConfigVersion>>>({});
  const [overviewState, setOverviewState] = useState<"idle" | "loading" | "error">("loading");
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [openKind, setOpenKind] = useState<ConfigKind | null>(null);
  const [versions, setVersions] = useState<MaszynkaConfigVersion[]>([]);
  const [versionsState, setVersionsState] = useState<"idle" | "loading" | "error">("idle");
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshOverview = useCallback(() => {
    setOverviewState("loading");
    setOverviewError(null);
    listLatestConfigs()
      .then((configs) => {
        setOverview(Object.fromEntries(configs.map((c) => [c.kind, c])));
        setOverviewState("idle");
      })
      .catch((e) => {
        setOverviewState("error");
        setOverviewError(errMsg(e));
      });
  }, []);
  useEffect(() => refreshOverview(), [refreshOverview]);

  const openVersion = useCallback((v: MaszynkaConfigVersion) => {
    setViewingVersion(v.version);
    setDraftText(JSON.stringify(v.body, null, 2));
    setParseError(null);
    setSaveError(null);
  }, []);

  const toggleKind = useCallback(
    (kind: ConfigKind) => {
      if (openKind === kind) {
        setOpenKind(null);
        return;
      }
      setOpenKind(kind);
      setVersions([]);
      setViewingVersion(null);
      setDraftText("");
      setParseError(null);
      setSaveError(null);
      setVersionsState("loading");
      listConfigVersions(kind)
        .then((vs) => {
          setVersions(vs);
          setVersionsState("idle");
          if (vs.length) openVersion(vs[vs.length - 1]); // latest is last (ordered oldest -> newest)
        })
        .catch((e) => {
          setVersionsState("error");
          setSaveError(errMsg(e));
        });
    },
    [openKind, openVersion],
  );

  const handleSave = useCallback(async () => {
    if (!openKind) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftText);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Invalid JSON");
      return;
    }
    setParseError(null);
    setSaveError(null);
    setSaving(true);
    try {
      const saved = await saveConfigVersion(openKind, parsed);
      setVersions((prev) => [...prev, saved]);
      setOverview((prev) => ({ ...prev, [openKind]: saved }));
      openVersion(saved);
      // Issue #17: the Run form keeps its own copy of "latest configs" (dropdowns +
      // Contract snapshots at Run time) — tell it a version just landed so it refetches
      // rather than the operator having to hit a manual refresh button.
      onSaved?.();
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }, [openKind, draftText, openVersion, onSaved]);

  const latestVersionNumber = versions.length ? versions[versions.length - 1].version : null;
  const isEditingLatest = viewingVersion === latestVersionNumber;

  return (
    <section className="mb-5 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">Configs</h2>
        <button type="button" onClick={refreshOverview} className="text-sm text-neutral-500 hover:text-amber-700">
          Refresh
        </button>
      </div>

      {overviewState === "error" && (
        <p className="mb-3 text-sm text-red-600">Couldn't load configs: {overviewError}</p>
      )}

      <ul className="space-y-2">
        {CONFIG_KINDS.map((kind) => {
          const latest = overview[kind];
          const open = openKind === kind;
          return (
            <li key={kind} className="rounded-lg border border-neutral-200">
              <button
                type="button"
                onClick={() => toggleKind(kind)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-amber-50 ${
                  open ? "bg-amber-50" : ""
                }`}
              >
                <span className="flex-1 font-medium text-neutral-700">{CONFIG_KIND_LABELS[kind]}</span>
                {latest ? (
                  <>
                    <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                      v{latest.version}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {new Date(latest.createdAt).toLocaleString()}
                    </span>
                  </>
                ) : (
                  overviewState === "loading" && <span className="shrink-0 text-xs text-neutral-400">loading…</span>
                )}
                <span className="shrink-0 text-neutral-400">{open ? "▾" : "▸"}</span>
              </button>

              {open && (
                <div className="border-t border-neutral-200 p-3">
                  {versionsState === "loading" && <p className="text-xs text-neutral-400">Loading versions…</p>}
                  {versionsState === "error" && <p className="text-xs text-red-600">Failed to load versions.</p>}

                  {versions.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-1">
                      {versions.map((v) => (
                        <button
                          key={v.version}
                          type="button"
                          onClick={() => openVersion(v)}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            viewingVersion === v.version
                              ? "bg-amber-400 text-amber-950"
                              : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                          }`}
                          title={new Date(v.createdAt).toLocaleString()}
                        >
                          v{v.version}
                          {v.version === latestVersionNumber ? " (latest)" : ""}
                        </button>
                      ))}
                    </div>
                  )}

                  {viewingVersion != null && (
                    <>
                      {!isEditingLatest && (
                        <p className="mb-2 text-xs text-amber-700">
                          Viewing v{viewingVersion} (not the latest) — saving still creates a new version on top of
                          v{latestVersionNumber}.
                        </p>
                      )}
                      <textarea
                        value={draftText}
                        onChange={(e) => {
                          setDraftText(e.target.value);
                          setParseError(null);
                          setSaveError(null);
                        }}
                        rows={14}
                        spellCheck={false}
                        className="mb-2 w-full resize-y rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                      />
                      {parseError && (
                        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                          Invalid JSON: {parseError}
                        </p>
                      )}
                      {saveError && (
                        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{saveError}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={saving}
                        className="rounded-lg bg-amber-400 px-4 py-1.5 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                      >
                        {saving ? "Saving…" : "Save as new version"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
