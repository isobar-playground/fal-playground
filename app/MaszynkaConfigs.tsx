"use client";

// Maszynka Configs section — slice 2 (extended by issue #16 to include stage_prompts,
// and by issue #18 to add the shared structured-form editor shell). Lists the config
// kinds (server-side truth, see ADR 0001), lets an operator view any past version and
// save an edited body as a new version (append-only — never UPDATE). No preset/hook
// names are hardcoded here; the *kind* identifiers are a fixed taxonomy (ADR 0001 /
// PRD), not preset content — everything inside a kind's body comes from Neon.
//
// Issue #18: structured form CRUD is now the default editing path for any Config kind
// with a registered `ConfigItemFormDef` (lib/maszynka/configFormDefs.ts) — that slice
// wired exactly one, `hooks`, end to end as the shell's concrete proof; #21 added styles/
// camera_settings; #22 adds global_rules, priority_logic (full CRUD incl. reordering
// layers, via `formDef.reorderable` + `handleMoveItem` below), and model_capability_matrix
// (boolean/number fields). Raw JSON remains one click away as the "Advanced" path for
// every kind, using the exact same validateConfigBody + saveConfigVersion (append-only)
// flow either mode ends on. `extractFormItems`/`buildFormBody` (configFormDefs.ts)
// translate between a kind's raw Config body and the plain item array this shell
// operates on — identity for array-body kinds, priority_logic's `{ layers: [...] }`
// unwrap/rewrap for that one kind.
//
// Issue #23 (the PRD's last slice) adds `stage_prompts` as a form-editable kind too, but
// NOT through `ConfigItemFormDef`/`CONFIG_FORM_DEFS` — its body is a single fixed-shape
// record, not an item array (see MaszynkaStagePromptsForm.tsx's header for why that model
// doesn't fit). It gets its own `stagePromptsDraft` state (parallel to `items`) and its
// own dedicated form component, gated by the `isStagePrompts` flag below wherever the
// generic item-array logic (`formDef`-driven) would otherwise run — but still shares the
// same version list, form/raw-JSON toggle (`mode`), and validateConfigBody + Save flow as
// every other kind.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listConfigVersions,
  listLatestConfigs,
  saveConfigVersion,
  type ConfigKind,
  type MaszynkaConfigVersion,
} from "@/lib/maszynka/configApi";
import { CONFIG_KINDS, CONFIG_KIND_LABELS, validateConfigBody, type StagePromptsConfig } from "@/lib/maszynka/configSchemas";
import { buildFormBody, CONFIG_FORM_DEFS, extractFormItems } from "@/lib/maszynka/configFormDefs";
import {
  addConfigItem,
  deleteConfigItem,
  isDuplicateConfigId,
  moveConfigItem,
  suggestConfigId,
  suggestUniqueConfigId,
  updateConfigItem,
  type ConfigItem,
} from "@/lib/maszynka/configItemCrud";
import { parseValidStagePromptsBody, shouldWarnOnContentSafetySave } from "@/lib/maszynka/stagePromptRestore";
import ConfigItemForm from "./MaszynkaConfigItemForm";
import StagePromptsForm from "./MaszynkaStagePromptsForm";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

// Shared Tailwind classes for the small in-panel item-editor action buttons — used by
// both the edit row and the create panel below, so a future style tweak only needs one
// edit per role rather than four scattered literals.
const ITEM_PRIMARY_BUTTON_CLASS =
  "rounded-lg bg-amber-400 px-3 py-1 text-xs font-semibold text-amber-950 hover:bg-amber-300";
const ITEM_SECONDARY_BUTTON_CLASS =
  "rounded-lg border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50";

/** A short, human-readable label for a Config item row — prefers the field the kind
 *  suggests ids from (usually the most descriptive text), falls back to the id. */
function itemSummary(item: ConfigItem, idKey: string, labelKey: string): string {
  const label = item[labelKey];
  if (typeof label === "string" && label.trim()) return label;
  return String(item[idKey] ?? "");
}

export default function MaszynkaConfigs({ onSaved }: { onSaved?: () => void }) {
  const [overview, setOverview] = useState<Partial<Record<ConfigKind, MaszynkaConfigVersion>>>({});
  const [overviewState, setOverviewState] = useState<"idle" | "loading" | "error">("loading");
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [openKind, setOpenKind] = useState<ConfigKind | null>(null);
  const [versions, setVersions] = useState<MaszynkaConfigVersion[]>([]);
  const [versionsState, setVersionsState] = useState<"idle" | "loading" | "error">("idle");
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);

  // Each mode owns its own source of truth while active: `items` in form mode, `draftText`
  // in JSON mode. They're only reconciled at the seam — switching modes, or saving — so a
  // structured-mode CRUD op (add/edit/delete) doesn't re-serialize the whole array on
  // every keystroke-adjacent action just to keep an unused string in sync.
  const [draftText, setDraftText] = useState("");
  const [items, setItems] = useState<ConfigItem[]>([]);
  // `stage_prompts` (issue #23) isn't an item array at all — a single fixed-shape record
  // (see MaszynkaStagePromptsForm.tsx's header) — so it gets its own draft slot alongside
  // `items` rather than being shoehorned into the item-array model the rest of this shell
  // uses. Only one of `items`/`stagePromptsDraft` is ever "live" at a time, gated by
  // `isStagePrompts` below, same as `items` vs `draftText` are gated by `mode`.
  const [stagePromptsDraft, setStagePromptsDraft] = useState<StagePromptsConfig | null>(null);
  const [mode, setMode] = useState<"form" | "json">("json");

  const [parseError, setParseError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ConfigItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<ConfigItem | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);

  const formDef = openKind ? CONFIG_FORM_DEFS[openKind] : undefined;
  const isStagePrompts = openKind === "stage_prompts";

  // Tracks which kind's version-list fetch is the "current" one, so a slow response for a
  // kind the operator has since closed (or swapped for another) can't land after the
  // fact and overwrite what's actually on screen — see toggleKind below.
  const openRequestRef = useRef<ConfigKind | null>(null);

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

  const resetItemEditing = useCallback(() => {
    setEditingId(null);
    setEditDraft(null);
    setCreating(false);
    setCreateDraft(null);
    setItemError(null);
  }, []);

  const openVersion = useCallback(
    (v: MaszynkaConfigVersion, activeFormDef: typeof formDef) => {
      setViewingVersion(v.version);
      setDraftText(JSON.stringify(v.body, null, 2));
      setParseError(null);
      setSaveError(null);
      resetItemEditing();

      // stage_prompts (issue #23) has no `ConfigItemFormDef`/item array — its own
      // dedicated form component takes the validated body directly. Same re-validate-
      // before-trusting-the-form defense in depth as the item-array path below.
      if (v.kind === "stage_prompts") {
        setItems([]);
        const parsedBody = parseValidStagePromptsBody(v.body);
        setStagePromptsDraft(parsedBody);
        setMode(parsedBody ? "form" : "json");
        return;
      }

      // Re-validate a loaded version's body against its kind's schema before trusting it
      // to the structured form — mirrors switchToForm's validate-before-extract below.
      // The save endpoint (app/api/maszynka/configs/[kind]/route.ts) already rejects a
      // malformed body before it ever reaches Neon, so this is defense in depth (e.g.
      // against a version some other write path stored), not a path any UI flow can
      // trigger today: without it, a `layers` entry shaped like `null` (schema-invalid,
      // so `extractFormItems`'s shallow `Array.isArray` check wouldn't catch it) would
      // reach `String(item[formDef.idKey])` in the row renderer below and throw.
      // `extractFormItems` handles both "body is the item array" (hooks, styles, ...)
      // and a form def's own unwrap (priority_logic's `{ layers: [...] }`) — see
      // configFormDefs.ts. Returns null for a body that doesn't match what the form
      // expects, in which case raw JSON is the only safe editor.
      const extracted =
        activeFormDef && validateConfigBody(v.kind, v.body).length === 0
          ? extractFormItems(activeFormDef, v.body)
          : null;
      if (activeFormDef && extracted) {
        setStagePromptsDraft(null);
        setItems(extracted);
        setMode("form");
      } else {
        setStagePromptsDraft(null);
        setItems([]);
        setMode("json");
      }
    },
    [resetItemEditing],
  );

  const toggleKind = useCallback(
    (kind: ConfigKind) => {
      if (openKind === kind) {
        openRequestRef.current = null;
        setOpenKind(null);
        return;
      }
      const activeFormDef = CONFIG_FORM_DEFS[kind];
      openRequestRef.current = kind;
      setOpenKind(kind);
      setVersions([]);
      setViewingVersion(null);
      setDraftText("");
      setItems([]);
      setStagePromptsDraft(null);
      setMode(kind === "stage_prompts" || activeFormDef ? "form" : "json");
      setParseError(null);
      setSaveError(null);
      resetItemEditing();
      setVersionsState("loading");
      listConfigVersions(kind)
        .then((vs) => {
          // A newer toggleKind call (a different kind opened, or this one closed) has
          // superseded this fetch — applying it now would silently overwrite whatever
          // the operator is actually looking at.
          if (openRequestRef.current !== kind) return;
          setVersions(vs);
          setVersionsState("idle");
          if (vs.length) openVersion(vs[vs.length - 1], activeFormDef); // latest is last (oldest -> newest)
        })
        .catch((e) => {
          if (openRequestRef.current !== kind) return;
          setVersionsState("error");
          setSaveError(errMsg(e));
        });
    },
    [openKind, openVersion, resetItemEditing],
  );

  const applyItems = useCallback(
    (next: ConfigItem[]) => {
      setItems(next);
      setSaveError(null);
    },
    [],
  );

  // JSON mode is a snapshot of `items` at the moment of switching — not kept live in sync
  // while in form mode (see the `draftText` state comment above), so it's (re)computed
  // here rather than on every CRUD op. `buildFormBody` re-wraps `items` into the kind's
  // real persisted body shape (a no-op for array-body kinds, `{ layers: items }` for
  // priority_logic) so the raw JSON editor always shows what "Save" would actually send.
  const switchToJson = useCallback(() => {
    if (isStagePrompts) {
      setDraftText(JSON.stringify(stagePromptsDraft, null, 2));
    } else {
      setDraftText(JSON.stringify(formDef ? buildFormBody(formDef, items) : items, null, 2));
    }
    resetItemEditing();
    setMode("json");
  }, [items, formDef, resetItemEditing, isStagePrompts, stagePromptsDraft]);

  const switchToForm = useCallback(() => {
    if (!openKind || !(isStagePrompts || formDef)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftText);
    } catch (e) {
      setParseError(`Invalid JSON: ${e instanceof Error ? e.message : "unknown error"}`);
      return;
    }
    // The structured form assumes a schema-valid body (configSchemas.ts) — run the same
    // validator the server and "Save" both use before accepting hand-edited JSON back
    // into the form. Without this, a malformed body (non-object entries, a missing/
    // non-string/duplicate id for item-array kinds; a missing sub-field for stage_prompts)
    // would reach the id-keyed lookups below or the stage_prompts form's field renderers,
    // which can crash or silently mismatch/merge rows.
    const errors = validateConfigBody(openKind, parsed);
    if (errors.length) {
      setParseError(`Can't switch to the form — fix this in JSON first: ${errors.join("; ")}`);
      return;
    }
    if (isStagePrompts) {
      resetItemEditing();
      setStagePromptsDraft(parsed as StagePromptsConfig);
      setParseError(null);
      setMode("form");
      return;
    }
    if (!formDef) return;
    const extracted = extractFormItems(formDef, parsed);
    if (!extracted) {
      setParseError("Can't switch to the form — body doesn't match the expected shape.");
      return;
    }
    resetItemEditing();
    setItems(extracted);
    setParseError(null);
    setMode("form");
  }, [openKind, formDef, draftText, resetItemEditing, isStagePrompts]);

  const handleStartCreate = useCallback(() => {
    if (!formDef) return;
    // Reset any in-progress edit first — otherwise a pending edit row and this new create
    // panel could both be open (and the pending edit silently dropped later) at once.
    resetItemEditing();
    setCreating(true);
    setCreateDraft(formDef.emptyItem());
  }, [formDef, resetItemEditing]);

  // Only the field the id is suggested *from* should drive recomputation — depending on
  // the whole `createDraft` object would rerun the uniqueness scan below on every
  // keystroke in every other field too (e.g. typing in "Placement guidance").
  const suggestSourceValue = formDef && createDraft ? createDraft[formDef.suggestIdFromKey] : undefined;
  const suggestedCreateId = useMemo(() => {
    if (!formDef || !creating) return "";
    const base = suggestConfigId(typeof suggestSourceValue === "string" ? suggestSourceValue : "");
    return suggestUniqueConfigId(items, formDef.idKey, base);
  }, [formDef, creating, suggestSourceValue, items]);

  const handleConfirmCreate = useCallback(() => {
    if (!openKind || !formDef || !createDraft) return;
    const rawId = createDraft[formDef.idKey];
    const id = (typeof rawId === "string" && rawId.trim() ? rawId.trim() : suggestedCreateId).trim();
    if (!id) {
      setItemError(`${formDef.itemLabel} needs an ID.`);
      return;
    }
    if (isDuplicateConfigId(items, formDef.idKey, id)) {
      setItemError(`ID "${id}" is already used by another ${formDef.itemLabel.toLowerCase()}.`);
      return;
    }
    const next = addConfigItem(items, { ...createDraft, [formDef.idKey]: id });
    // Catch missing/invalid required fields (e.g. an empty hook text) right here, so the
    // operator finds out which item is wrong immediately rather than in a generic
    // save-time error banner after the row has scrolled out of view. Validate the real
    // body shape (`buildFormBody`), not the bare item array — priority_logic's validator
    // expects `{ layers: [...] }`, not the array itself.
    const errors = validateConfigBody(openKind, buildFormBody(formDef, next));
    if (errors.length) {
      setItemError(errors.join("; "));
      return;
    }
    applyItems(next);
    resetItemEditing();
  }, [openKind, formDef, createDraft, suggestedCreateId, items, applyItems, resetItemEditing]);

  const handleStartEdit = useCallback(
    (item: ConfigItem, idKey: string) => {
      resetItemEditing();
      setEditingId(String(item[idKey]));
      setEditDraft({ ...item });
    },
    [resetItemEditing],
  );

  const handleConfirmEdit = useCallback(() => {
    if (!openKind || !formDef || editingId == null || !editDraft) return;
    const next = updateConfigItem(items, formDef.idKey, editingId, editDraft);
    const errors = validateConfigBody(openKind, buildFormBody(formDef, next));
    if (errors.length) {
      setItemError(errors.join("; "));
      return;
    }
    applyItems(next);
    setEditingId(null);
    setEditDraft(null);
    setItemError(null);
  }, [openKind, formDef, editingId, editDraft, items, applyItems]);

  // Reorders a top-level item (e.g. a priority_logic layer — ADR 0001 / issue #22 "full
  // CRUD ... including ... reordering layers"), gated by `formDef.reorderable` in the
  // render below. Reuses `moveConfigItem`, the same generic helper `stringList` fields
  // (MaszynkaConfigItemForm.tsx) already use to reorder entries within one item.
  const handleMoveItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      applyItems(moveConfigItem(items, fromIndex, toIndex));
    },
    [items, applyItems],
  );

  const handleDelete = useCallback(
    (item: ConfigItem) => {
      if (!formDef) return;
      const id = String(item[formDef.idKey]);
      const label = itemSummary(item, formDef.idKey, formDef.suggestIdFromKey);
      // PRD story 13 / issue #18 acceptance: deleting a Config item requires
      // confirmation. This only removes the item from the in-memory draft — it takes
      // effect in Neon only once the operator hits "Save as new version" below, which
      // keeps delete on the exact same append-only save path as every other edit.
      if (!confirm(`Delete ${formDef.itemLabel.toLowerCase()} "${label}"? This will be removed from the next saved version.`)) {
        return;
      }
      applyItems(deleteConfigItem(items, formDef.idKey, id));
      if (editingId === id) {
        setEditingId(null);
        setEditDraft(null);
      }
    },
    [formDef, items, applyItems, editingId],
  );

  const handleSave = useCallback(async () => {
    if (!openKind) return;
    let parsed: unknown;
    if (mode === "form" && isStagePrompts) {
      // Every other guard clause in this function reports why it stopped (parse error,
      // client validation error) — match that here rather than silently no-op'ing, even
      // though today's callers always pair `mode === "form"` with a non-null draft for
      // this kind (see `openVersion`/`switchToForm` above).
      if (!stagePromptsDraft) {
        setSaveError("Nothing to save yet — reopen this Config kind and try again.");
        return;
      }
      parsed = stagePromptsDraft;
    } else if (mode === "form" && formDef) {
      // `items` is form mode's live source of truth (see the `draftText` state comment
      // above) — rebuild the real body shape (`buildFormBody`) and save that directly
      // instead of round-tripping through `draftText`.
      parsed = buildFormBody(formDef, items);
    } else {
      try {
        parsed = JSON.parse(draftText);
      } catch (e) {
        setParseError(`Invalid JSON: ${e instanceof Error ? e.message : "unknown error"}`);
        return;
      }
    }
    setParseError(null);
    setSaveError(null);

    // Same validator the server runs (lib/maszynka/configSchemas.ts) — checked
    // client-side first so a failed save is never mistaken for a successful one and the
    // operator sees exactly what's wrong before any network round trip.
    const clientErrors = validateConfigBody(openKind, parsed);
    if (clientErrors.length) {
      setSaveError(clientErrors.join("; "));
      return;
    }

    // PRD story 21 / ADR 0001: saving a Content safety Stage prompt CHANGE shows a
    // lightweight, non-blocking warning. Plain `alert()` rather than `confirm()` — unlike
    // handleDelete's confirm() above (which gates the action on the operator's answer),
    // there's no OK/Cancel decision to make here: the save always proceeds either way, so
    // a dismiss-to-continue notice is the honest primitive. Compared against the last
    // actually-*saved* text (the latest version already in `versions`), not merely
    // whatever's sitting in the draft, so this only fires for a real change reaching Neon
    // (including one staged in via Restore), not for re-saving an unmodified body.
    if (isStagePrompts) {
      const latestSaved = versions.length ? versions[versions.length - 1] : null;
      const latestSavedContentSafety = latestSaved
        ? (parseValidStagePromptsBody(latestSaved.body)?.contentSafety.systemPrompt ?? "")
        : "";
      const nextContentSafety = (parsed as StagePromptsConfig).contentSafety.systemPrompt;
      if (shouldWarnOnContentSafetySave(latestSavedContentSafety, nextContentSafety)) {
        alert(
          "Content safety is the FIRST pipeline gate — every run is checked against it before Asset analysis or FAL generation runs. This save will proceed either way; use this moment to double-check the wording.",
        );
      }
    }

    setSaving(true);
    try {
      const saved = await saveConfigVersion(openKind, parsed);
      setVersions((prev) => [...prev, saved]);
      setOverview((prev) => ({ ...prev, [openKind]: saved }));
      openVersion(saved, formDef);
      // Issue #17: the Run form keeps its own copy of "latest configs" (dropdowns +
      // Contract snapshots at Run time) — tell it a version just landed so it refetches
      // rather than the operator having to hit a manual refresh button.
      onSaved?.();
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setSaving(false);
    }
  }, [openKind, mode, formDef, items, draftText, openVersion, onSaved, isStagePrompts, stagePromptsDraft, versions]);

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
                          onClick={() => openVersion(v, formDef)}
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

                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                          {mode === "form" ? "Form" : "Advanced: raw JSON"}
                        </span>
                        {formDef || isStagePrompts ? (
                          <button
                            type="button"
                            onClick={mode === "form" ? switchToJson : switchToForm}
                            className="text-xs text-neutral-400 underline decoration-dotted hover:text-amber-700"
                          >
                            {mode === "form" ? "Advanced: edit raw JSON" : "Back to form"}
                          </button>
                        ) : (
                          <span className="text-xs text-neutral-400">
                            Structured form for this Config kind isn't available yet — use raw JSON.
                          </span>
                        )}
                      </div>

                      {mode === "form" && isStagePrompts && stagePromptsDraft ? (
                        <div className="mb-3">
                          <StagePromptsForm value={stagePromptsDraft} onChange={setStagePromptsDraft} versions={versions} />
                        </div>
                      ) : mode === "form" && formDef ? (
                        <div className="mb-3 space-y-2">
                          {items.length === 0 && !creating && (
                            <p className="rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
                              No {formDef.itemLabel.toLowerCase()}s yet.
                            </p>
                          )}
                          {items.map((item, index) => {
                            const id = String(item[formDef.idKey]);
                            const isRowEditing = editingId === id;
                            return (
                              <div key={id} className="rounded-lg border border-neutral-200 p-3">
                                {isRowEditing && editDraft ? (
                                  <>
                                    <ConfigItemForm
                                      formDef={formDef}
                                      item={editDraft}
                                      isNew={false}
                                      onChange={setEditDraft}
                                    />
                                    {itemError && <p className="mt-2 text-xs text-red-600">{itemError}</p>}
                                    <div className="mt-3 flex gap-2">
                                      <button type="button" onClick={handleConfirmEdit} className={ITEM_PRIMARY_BUTTON_CLASS}>
                                        Apply edit
                                      </button>
                                      <button type="button" onClick={resetItemEditing} className={ITEM_SECONDARY_BUTTON_CLASS}>
                                        Cancel
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-sm font-medium text-neutral-700">
                                        {itemSummary(item, formDef.idKey, formDef.suggestIdFromKey)}
                                      </p>
                                      <p className="truncate font-mono text-[11px] text-neutral-400">{id}</p>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                      {formDef.reorderable && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => handleMoveItem(index, index - 1)}
                                            disabled={index === 0}
                                            title={`Move ${formDef.itemLabel.toLowerCase()} up`}
                                            className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                                          >
                                            ↑
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleMoveItem(index, index + 1)}
                                            disabled={index === items.length - 1}
                                            title={`Move ${formDef.itemLabel.toLowerCase()} down`}
                                            className="rounded-lg border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                                          >
                                            ↓
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleStartEdit(item, formDef.idKey)}
                                        className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleDelete(item)}
                                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {creating && createDraft ? (
                            <div className="rounded-lg border border-amber-300 bg-amber-50/40 p-3">
                              <ConfigItemForm
                                formDef={formDef}
                                item={createDraft}
                                isNew
                                suggestedId={suggestedCreateId}
                                onChange={setCreateDraft}
                              />
                              {itemError && <p className="mt-2 text-xs text-red-600">{itemError}</p>}
                              <div className="mt-3 flex gap-2">
                                <button type="button" onClick={handleConfirmCreate} className={ITEM_PRIMARY_BUTTON_CLASS}>
                                  Add {formDef.itemLabel.toLowerCase()}
                                </button>
                                <button type="button" onClick={resetItemEditing} className={ITEM_SECONDARY_BUTTON_CLASS}>
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={handleStartCreate}
                              className="w-full rounded-lg border border-dashed border-neutral-300 px-3 py-2 text-xs font-medium text-neutral-500 hover:border-amber-400 hover:text-amber-700"
                            >
                              + Add {formDef.itemLabel.toLowerCase()}
                            </button>
                          )}
                        </div>
                      ) : (
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
                      )}

                      {parseError && (
                        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{parseError}</p>
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
