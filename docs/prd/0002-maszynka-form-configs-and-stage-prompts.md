# PRD: Maszynka form Configs

> **Status (August 2026):** Form-based Config editing is **implemented** for Hooks, Styles, Camera settings, Lighting, Global rules, Priority logic, and Model capability matrix. The **Stage prompts** scope described in the original PRD was **removed** — LLM stage instruction text remains hardcoded in pipeline modules. This document is kept as historical context; current behavior is in `docs/adr/0001-maszynka-runs-and-configs-in-neon.md`.

Source context: follow-up planning session on July 9, 2026. Domain terms are defined in `CONTEXT.md`; storage and UX decisions are recorded in `docs/adr/0001-maszynka-runs-and-configs-in-neon.md`.

## Problem Statement

Maszynka already stores pipeline Config kinds in Neon and lets an operator edit them as raw JSON, but that is too technical for the end user who owns the testing flow. Hooks, Styles, Camera settings, Global rules, Priority logic, and Model capability matrix all have known structure, so asking the operator to edit JSON directly slows iteration and increases the chance of malformed or accidental changes.

Configs also currently sit below Run history, while the operator needs to adjust configs before starting a Run.

## Solution

Move Configs to the top of the Maszynka screen as the third top-level section, before Run, and make structured forms the primary editing workflow for every Config kind. Each form edits Config items inside the latest Config version, but every save remains append-only: the app writes a new Config version for the whole Config kind, preserving reproducible history.

Raw JSON editing remains available as a quiet advanced/debug path that uses the same validation and append-only save flow.

## User Stories

1. As an operator, I want Configs to appear before Run, so that I can adjust test settings before starting generation.
2. As an operator, I want Configs to be compact by default, so that config management does not push the Run workflow too far down the page.
3. As an operator, I want to see each Config kind with its latest version, so that I know which snapshot will be used by the next Run.
4. As an operator, I want to open one Config kind at a time, so that I can focus on the config I am editing.
5. As an operator, I want a flat list of Config kinds, so that the UI matches the current editing taxonomy.
6. As an operator, I want form-based CRUD for Hooks, so that I can add, edit, and remove Hook text and guidance without writing JSON.
7. As an operator, I want form-based CRUD for Styles, so that I can update visual instructions safely.
8. As an operator, I want form-based CRUD for Camera settings, so that I can update framing and camera behavior safely.
9. As an operator, I want form-based CRUD for Global rules, so that I can maintain always-on rules without editing JSON arrays.
10. As an operator, I want full form-based CRUD for Priority logic, so that I can add, remove, rename, and reorder conflict-priority layers.
11. As an operator, I want form-based CRUD for Model capability matrix entries, so that FAL request mapping can be adjusted without a deploy.
12. As an operator, I want deleting a Config item to remove it from the next saved version, so that it stops appearing in future Runs.
13. As an operator, I want a confirmation before deleting a Config item, so that accidental deletions are less likely.
14. As an operator, I want Config item IDs suggested when I create items, so that new items have stable IDs without manual slug work.
15. As an operator, I want existing Config item IDs to be read-only in normal forms, so that editing a name does not accidentally change identity.
16. As an operator, I want raw JSON to remain available as a quiet advanced/debug path, so that rare bulk edits or repair work are still possible.
17. As an operator, I want every form save to create a new Config version, so that I can compare or reproduce older Runs.
18. As an operator, I want the Run form to refresh latest Config state automatically after a Config save, so that the next Run uses the config I just saved.
19. As an operator, I want debug requests to continue showing the exact prompt sent to each LLM stage, so that detailed debugging remains possible.
20. As an operator, I want LLM response schemas and validators to stay fixed in code, so that changing creative config cannot silently break pipeline contracts.
21. As an operator, I want Config item `version` fields omitted, so that there is only one clear versioning system.
22. As a developer, I want config form behavior to be covered by pure transformation helpers where practical, so that CRUD operations can be tested without driving React.

### Cancelled — Stage prompts (removed August 2026)

The following stories were in the original PRD but are **not implemented** and **not planned**:

- Editable Stage prompts as a Config kind (`stage_prompts`)
- Per-stage Stage prompt restore
- Run snapshots of `stage_prompts` version/body
- Content safety save warning tied to Stage prompt editing
- Stage prompt resolver / config-driven request builders

LLM stage instruction text is owned by code in `lib/maszynka/*.ts`. To change it, edit those modules and redeploy.

## Implementation Decisions

- Seven Config kinds in Neon: hooks, styles, camera_settings, lighting, global_rules, priority_logic, model_capability_matrix.
- Keep LLM response schemas, JSON Schema response formats, and runtime validators in code.
- Do not expose restore for Hooks, Presets, Global rules, Priority logic, or Model capability matrix in MVP.
- Configs remains a flat list of Config kinds. Do not group into Creative/Pipeline sections.
- Configs moves above Run as the third top-level section, after the API key sections.
- Configs defaults to a compact collapsed overview with latest versions.
- Opening a Config kind reveals its form editor. Do not expand all editors by default.
- Structured forms are the primary editing path. Raw JSON remains as an unobtrusive advanced/debug path.
- Every form save and raw JSON save flows through the same server-side validation and append-only insert.
- Config item delete removes the item from the next saved version, not a soft-delete/archive marker.
- Config item IDs are set at creation and read-only afterward in normal forms. Raw JSON advanced can still repair IDs if needed.
- Config items do not carry individual `version` fields in MVP. Versioning belongs to the whole Config kind snapshot.
- Priority logic supports full CRUD in the form editor because the UX operator owns the flow design.
- After successful Config save, the Run form refreshes latest Config state automatically.
- Major modules: Config kind schemas and seeds, config form state helpers (`configFormDefs.ts`, `configItemCrud.ts`), Configs UI (`MaszynkaConfigs.tsx`), Contract/run trace structures, Run orchestration, and runnable checks.
- Deep module opportunities: a config item editor model that maps each Config kind to field definitions and immutable CRUD operations; a run config snapshot normalizer used by Contract/run trace/debug preview.

## Testing Decisions

- Test external behavior of pure helpers rather than implementation details or React state internals.
- Extend existing config checks so every seed validates against its Config kind schema.
- Add checks for form CRUD helper behavior: add, edit, delete, reorder where relevant, preserve read-only IDs, and emit a body accepted by config validation.
- Add checks for run trace/config snapshot behavior for the seven Config kinds.
- Prior art: existing runnable Maszynka checks for config validation, Contract validation, Prompt builder, Prompt reviewer, Asset analysis, Content safety, Prompt improvement, FAL mapper, scoring, and run trace.
- Manual verification should cover the operator path: edit a Hook via form, save, confirm new version, confirm Run dropdown refreshes; confirm Configs list has seven kinds and no Stage prompts section; run generation and inspect debug traces for LLM stages.

## Out of Scope

- Per-item version numbers inside Config items.
- Restore for any Config kind.
- Operator-editable LLM stage prompts (`stage_prompts` Config kind).
- Editing LLM output schemas, JSON Schema response formats, or runtime validators from the UI.
- Authentication, operator identity, approvals, or audit trails beyond append-only Config versions.
- Bulk import/export UX beyond the advanced raw JSON path.
- A redesigned grouped Configs navigation.
- Automated migration of existing Neon rows beyond first-use seeding for missing Config kinds.
- Changing the scoring vocabulary.
- Changing model recommendation rules.
- Video-generation UI.

## Further Notes

- The user explicitly chose form CRUD for all Config kinds, full CRUD for Priority logic, compact Configs placement before Run, and raw JSON as a quiet advanced path.
- Published to GitHub as parent issue #15; implementation slices were #16–#22 (form configs). Slice #23 (Stage prompts) was superseded by removal in August 2026.
- Older runs in Neon may still contain `stagePrompts` fields in stored JSON; new runs do not write them.
