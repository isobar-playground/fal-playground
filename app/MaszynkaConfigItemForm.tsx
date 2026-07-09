"use client";

// Generic, field-definition-driven form for a single Config item (issue #18 — shared
// Config form editor shell). Doesn't know about hooks/styles/cameras specifically — it
// just renders whatever `ConfigFieldDef[]` the kind's `ConfigItemFormDef` declares
// (lib/maszynka/configFormDefs.ts), so later slices (#23) register a new form def instead
// of building a new form component per Config kind. Issue #21 added the `stringList`
// field type (add/edit/remove/reorder entries within a single item, e.g. StyleConfig.
// avoid) on top of the plain text/textarea fields issue #18 shipped with. Issue #22 adds
// `boolean` (checkbox) and `number` fields for ModelCapabilityEntry's supports*/
// maxInputImages fields.
import { useState } from "react";
import type { ConfigFieldDef, ConfigItemFormDef } from "@/lib/maszynka/configFormDefs";
import { addListEntry, moveConfigItem, removeListEntry, updateListEntry, type ConfigItem } from "@/lib/maszynka/configItemCrud";

const FIELD_CLASS =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100";
const LABEL_CLASS = "mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400";
const LIST_ICON_BUTTON_CLASS =
  "shrink-0 rounded-lg border border-neutral-300 px-1.5 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40";

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigFieldDef;
  value: unknown;
  onChange: (v: string | number | boolean) => void;
}) {
  if (field.type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-neutral-300 accent-amber-400"
      />
    );
  }
  if (field.type === "number") {
    const numberValue = typeof value === "number" ? value : "";
    return (
      <input
        type="number"
        min={0}
        value={numberValue}
        // An empty or not-yet-parseable field (e.g. "-", "1e" while mid-typing) commits
        // as 0 rather than NaN — configSchemas.ts's isFiniteNumber check would otherwise
        // reject `NaN` with a confusing "must be a non-negative number" error banner
        // while the operator is still typing.
        onChange={(e) => {
          const parsed = Number(e.target.value);
          onChange(e.target.value === "" || Number.isNaN(parsed) ? 0 : parsed);
        }}
        className={FIELD_CLASS}
      />
    );
  }
  const stringValue = typeof value === "string" ? value : "";
  if (field.type === "textarea") {
    return (
      <textarea
        value={stringValue}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={`${FIELD_CLASS} resize-y`}
      />
    );
  }
  return <input type="text" value={stringValue} onChange={(e) => onChange(e.target.value)} className={FIELD_CLASS} />;
}

/** Editor for a `stringList` field (e.g. StyleConfig.avoid/recommendedModels/
 *  scoringCriteria) — add, edit in place, remove, and reorder entries. All mutation goes
 *  through the pure helpers in configItemCrud.ts so this component just wires buttons to
 *  them and reports the new array up via `onChange`. */
function StringListField({
  field,
  value,
  onChange,
}: {
  field: ConfigFieldDef;
  value: unknown;
  onChange: (next: string[]) => void;
}) {
  const list = Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const [draft, setDraft] = useState("");
  const entryLabel = field.entryLabel ?? "entry";

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange(addListEntry(list, trimmed));
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      {list.length === 0 && <p className="text-xs text-neutral-400">No entries yet.</p>}
      {list.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={entry}
            onChange={(e) => onChange(updateListEntry(list, i, e.target.value))}
            className={`${FIELD_CLASS} flex-1`}
          />
          <button
            type="button"
            onClick={() => onChange(moveConfigItem(list, i, i - 1))}
            disabled={i === 0}
            title={`Move ${entryLabel} up`}
            className={LIST_ICON_BUTTON_CLASS}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onChange(moveConfigItem(list, i, i + 1))}
            disabled={i === list.length - 1}
            title={`Move ${entryLabel} down`}
            className={LIST_ICON_BUTTON_CLASS}
          >
            ↓
          </button>
          <button
            type="button"
            onClick={() => onChange(removeListEntry(list, i))}
            title={`Remove ${entryLabel}`}
            className="shrink-0 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={`Add ${entryLabel}…`}
          className={`${FIELD_CLASS} flex-1`}
        />
        <button
          type="button"
          onClick={handleAdd}
          className="shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

/** `isNew`: the id field is a suggested/editable text input (PRD story 14). Otherwise
 *  (editing an existing item) the id field is read-only (PRD story 15 / ADR 0001). */
export default function ConfigItemForm({
  formDef,
  item,
  isNew,
  suggestedId,
  onChange,
}: {
  formDef: ConfigItemFormDef;
  item: ConfigItem;
  isNew: boolean;
  suggestedId?: string;
  onChange: (next: ConfigItem) => void;
}) {
  const idValue = typeof item[formDef.idKey] === "string" ? (item[formDef.idKey] as string) : "";

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL_CLASS}>{formDef.idFieldLabel}</label>
        {isNew ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={idValue}
              onChange={(e) => onChange({ ...item, [formDef.idKey]: e.target.value })}
              placeholder={suggestedId || "id"}
              className={`${FIELD_CLASS} font-mono`}
            />
            {suggestedId && idValue !== suggestedId && (
              <button
                type="button"
                onClick={() => onChange({ ...item, [formDef.idKey]: suggestedId })}
                className="shrink-0 rounded-lg border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50"
              >
                Use suggested “{suggestedId}”
              </button>
            )}
          </div>
        ) : (
          <input
            type="text"
            value={idValue}
            readOnly
            disabled
            title="Existing item IDs are read-only — use the advanced raw JSON editor to repair an ID."
            className="w-full cursor-not-allowed rounded-lg border border-neutral-200 bg-neutral-100 px-3 py-1.5 font-mono text-sm text-neutral-500"
          />
        )}
      </div>

      {formDef.fields.map((field) => (
        <div key={field.key}>
          <label className={LABEL_CLASS}>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          {field.type === "stringList" ? (
            <StringListField
              field={field}
              value={item[field.key]}
              onChange={(next) => onChange({ ...item, [field.key]: next })}
            />
          ) : (
            <FieldInput field={field} value={item[field.key]} onChange={(v) => onChange({ ...item, [field.key]: v })} />
          )}
        </div>
      ))}
    </div>
  );
}
