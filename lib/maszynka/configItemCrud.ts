// Pure, framework-free CRUD + ID-suggestion helpers shared by every Config kind's
// structured form editor (issue #18 — shared Config form editor shell, PRD "Maszynka
// form Configs and Stage prompts"). Config items are plain JSON objects keyed by a
// per-kind id field (e.g. HookConfig.id, StyleConfig.styleId — see configSchemas.ts).
// These helpers never mutate their input arrays; every operation returns a new array so
// the React shell (app/MaszynkaConfigs.tsx) can treat a Config kind's item list as
// ordinary immutable state and let the existing append-only save flow
// (lib/maszynka/configApi.ts -> POST .../configs/[kind]) persist the result unchanged.
//
// Deliberately generic over `Record<string, unknown>` rather than the specific
// HookConfig/StyleConfig/etc. types: PRD "Deep module opportunities" asks for one
// config-item-editor model that maps each Config kind to field definitions and CRUD
// operations, so per-kind form defs (configFormDefs.ts) plug an `idKey` in here instead
// of this module knowing about every kind's shape.

export type ConfigItem = Record<string, unknown>;

/** Add a new item to the end of the list. Pure — returns a new array. */
export function addConfigItem<T extends ConfigItem>(items: T[], item: T): T[] {
  return [...items, item];
}

/** Update the item matching `id` under `idKey`, keeping every other item untouched.
 *  The id field itself is always preserved from the existing item — callers must not
 *  be able to change identity through edit (PRD story 15 / ADR 0001: "existing Config
 *  item IDs are read-only in normal forms"). Any `idKey` present in `patch` is ignored. */
export function updateConfigItem<T extends ConfigItem>(
  items: T[],
  idKey: string,
  id: string,
  patch: Partial<T>,
): T[] {
  return items.map((item) => (item[idKey] === id ? { ...item, ...patch, [idKey]: item[idKey] } : item));
}

/** Remove the item matching `id` under `idKey`. No-op (returns an equal-length array)
 *  if the id isn't found, so a stale confirm dialog can't throw. */
export function deleteConfigItem<T extends ConfigItem>(items: T[], idKey: string, id: string): T[] {
  return items.filter((item) => item[idKey] !== id);
}

/** Move the item at `fromIndex` to `toIndex`, shifting the items between. For Config
 *  kinds with an operator-defined order (e.g. priority_logic layers — ADR 0001: "full
 *  CRUD ... including adding, removing, renaming, and reordering layers"). Out-of-range
 *  indexes return the list unchanged rather than throwing.
 *
 *  Not called from the shell yet (app/MaszynkaConfigs.tsx) — priority_logic doesn't have
 *  a form def in this slice (#18 only wires `hooks`, which has no order to preserve), so
 *  there's no reorder UI to wire it into. It's included now because the PRD's testing
 *  decisions explicitly ask for reorder to be covered as a pure helper ahead of that UI
 *  landing in #20-#22, and the UI work is a `moveConfigItem` call plus buttons, not a new
 *  algorithm. */
export function moveConfigItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** True when `id` is already used by another item in the list (excluding `excludeId`,
 *  so re-checking an item against itself during edit doesn't self-collide). Config kind
 *  validators (configSchemas.ts) already reject duplicate ids server-side; this lets the
 *  create form warn before the operator even attempts a save. */
export function isDuplicateConfigId<T extends ConfigItem>(
  items: T[],
  idKey: string,
  id: string,
  excludeId?: string,
): boolean {
  return items.some((item) => item[idKey] === id && item[idKey] !== excludeId);
}

/** Derive a stable slug-style id from free text (PRD story 14: "Config item IDs
 *  suggested when I create items"). Lowercases, replaces runs of non-alphanumeric
 *  characters with a single hyphen, and trims leading/trailing hyphens. Falls back to
 *  "item" so a suggestion is never an empty string (which would fail the non-empty-id
 *  validators in configSchemas.ts). Truncated to a reasonable id length so a whole
 *  sentence typed into a text field doesn't become the id. */
export function suggestConfigId(text: string, maxLength = 40): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "item";
}

/** Appends `-2`, `-3`, ... to `baseId` until it no longer collides with an existing item
 *  id, so two items whose suggestion source text happens to match still get distinct
 *  ids offered in the create form. */
export function suggestUniqueConfigId<T extends ConfigItem>(items: T[], idKey: string, baseId: string): string {
  if (!isDuplicateConfigId(items, idKey, baseId)) return baseId;
  let n = 2;
  while (isDuplicateConfigId(items, idKey, `${baseId}-${n}`)) n++;
  return `${baseId}-${n}`;
}
