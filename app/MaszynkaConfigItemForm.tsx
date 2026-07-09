"use client";

// Generic, field-definition-driven form for a single Config item (issue #18 — shared
// Config form editor shell). Doesn't know about hooks/styles/cameras specifically — it
// just renders whatever `ConfigFieldDef[]` the kind's `ConfigItemFormDef` declares
// (lib/maszynka/configFormDefs.ts), so later slices (#20-#22) register a new form def
// instead of building a new form component per Config kind.
import type { ConfigFieldDef, ConfigItemFormDef } from "@/lib/maszynka/configFormDefs";
import type { ConfigItem } from "@/lib/maszynka/configItemCrud";

const FIELD_CLASS =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100";
const LABEL_CLASS = "mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400";

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigFieldDef;
  value: unknown;
  onChange: (v: string) => void;
}) {
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
          <FieldInput field={field} value={item[field.key]} onChange={(v) => onChange({ ...item, [field.key]: v })} />
        </div>
      ))}
    </div>
  );
}
