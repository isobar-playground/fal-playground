# PRD: Maszynka form Configs and Stage prompts

Source context: follow-up planning session on July 9, 2026. Domain terms are defined in `CONTEXT.md`; storage and UX decisions are recorded in `docs/adr/0001-maszynka-runs-and-configs-in-neon.md`.

## Problem Statement

Maszynka already stores pipeline Config kinds in Neon and lets an operator edit them as raw JSON, but that is too technical for the end user who owns the testing flow. Hooks, Styles, Camera settings, Global rules, Priority logic, Model capability matrix, and Stage prompts all have known structure, so asking the operator to edit JSON directly slows iteration and increases the chance of malformed or accidental changes.

Configs also currently sit below Run history, while the operator needs to adjust configs before starting a Run. The LLM Stage prompts are still hardcoded in the Maszynka pipeline modules, so the operator cannot tune Content safety, Asset analysis, Prompt improvement, Prompt builder, or Prompt reviewer instructions before generation.

## Solution

Move Configs to the top of the Maszynka screen as the third top-level section, before Run, and make structured forms the primary editing workflow for every Config kind. Each form edits Config items inside the latest Config version, but every save remains append-only: the app writes a new Config version for the whole Config kind, preserving reproducible history.

Add `stage_prompts` as a Config kind. It stores operator-editable prompt instruction text for the LLM pipeline stages. Runs use the latest Stage prompts at Run time, store the `stage_prompts` version and snapshot alongside other config snapshots, and continue to expose raw stage requests for detailed debugging.

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
19. As an operator, I want Stage prompts to be editable from Configs, so that I can tune pipeline instructions without developer changes.
20. As an operator, I want Content safety prompt text editable, so that I can tune what the first safety gate catches.
21. As an operator, I want a lightweight warning when saving the Content safety Stage prompt, so that I remember this prompt controls the first pipeline gate.
22. As an operator, I want Asset analysis modeled as shared base instructions plus role-specific instructions for each Asset role, so that common behavior and role differences are both easy to edit.
23. As an operator, I want Prompt improvement prompt text editable, so that I can tune how raw creative prompts are rewritten.
24. As an operator, I want Prompt builder prompt text editable, so that I can tune how the Contract becomes finalPrompt and negativePrompt.
25. As an operator, I want the Prompt builder revision instruction template editable, so that I can tune the one allowed rebuild after Prompt reviewer asks for revise.
26. As an operator, I want Prompt reviewer prompt text editable, so that I can tune what counts as pass, revise, or failed before FAL generation.
27. As an operator, I want Stage prompt restore per single stage, so that I can recover a previous Prompt reviewer or Prompt builder prompt without reverting all Stage prompts at once.
28. As an operator, I want Stage prompt restore to create a new Config version, so that history stays append-only.
29. As an operator, I want Runs to store the `stage_prompts` version and snapshot, so that I can tell which prompt instructions produced a result.
30. As an operator, I want debug requests to continue showing the exact prompt sent to each LLM stage, so that detailed debugging remains possible.
31. As an operator, I want LLM response schemas and validators to stay fixed in code, so that changing prompt text cannot silently break pipeline contracts.
32. As an operator, I want Config item `version` fields omitted, so that there is only one clear versioning system.
33. As a developer, I want Stage prompt request builders to accept prompt config input, so that hardcoded prompt constants can become seed defaults rather than the only source of truth.
34. As a developer, I want config form behavior to be covered by pure transformation helpers where practical, so that CRUD operations can be tested without driving React.
35. As a developer, I want Stage prompt validation to be schema-checked like existing Config kinds, so that invalid prompt config bodies never create versions.

## Implementation Decisions

- Add `stage_prompts` as a new Config kind in the existing append-only Neon-backed config storage.
- Seed `stage_prompts` from the current hardcoded Stage prompt text so existing behavior is preserved on first use.
- Keep LLM response schemas, JSON Schema response formats, and runtime validators in code. Only operator instruction text moves into config.
- Model Asset analysis Stage prompt as shared base instructions plus role-specific instructions for `packshot`, `style_reference`, `brand_reference`, and `campaign_reference`.
- Model Prompt builder Stage prompt as main system prompt plus a revision instruction template used when Prompt reviewer returns `revise`.
- Runs use latest Config versions at Run time, including latest `stage_prompts`.
- Runs store `stage_prompts` version and snapshot alongside other selected config snapshots.
- Stage prompt restore is scoped to one Stage prompt. Restoring copies the selected historical prompt content into the current `stage_prompts` body and saves a new version.
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
- Saving Content safety Stage prompt shows a lightweight warning/confirmation but does not block the operator.
- Major modules to build or modify: Config kind schemas and seeds, config form state helpers, Configs UI, Stage prompt resolution helpers, stage request builders, Contract/run trace structures, Run orchestration, and runnable checks.
- Deep module opportunities: a config item editor model that maps each Config kind to field definitions and immutable CRUD operations; a Stage prompt resolver that converts `stage_prompts` config plus stage parameters into final instruction text; a run config snapshot normalizer used by Contract/run trace/debug preview.

## Testing Decisions

- Test external behavior of pure helpers rather than implementation details or React state internals.
- Extend existing config checks so every seed, including `stage_prompts`, validates against its Config kind schema.
- Add checks for form CRUD helper behavior: add, edit, delete, reorder where relevant, preserve read-only IDs, and emit a body accepted by config validation.
- Add checks for Stage prompt resolution: each stage request builder uses configured text; Asset analysis composes shared base plus role-specific text; Prompt builder revise attempts use the configured revision template.
- Add checks for run trace/config snapshot behavior so `stage_prompts` version and snapshot are persisted and summarized with other configs.
- Add checks that LLM response schemas remain code-owned and are not read from `stage_prompts`.
- Prior art: existing runnable Maszynka checks for config validation, Contract validation, Prompt builder, Prompt reviewer, Asset analysis, Content safety, Prompt improvement, FAL mapper, scoring, and run trace.
- Manual verification should cover the operator path: edit a Hook via form, save, confirm new version, confirm Run dropdown refreshes; edit a Stage prompt, run generation, confirm stage request/debug trace uses the saved text; restore one Stage prompt, confirm new version and snapshot.

## Out of Scope

- Per-item version numbers inside Config items.
- Restore for non-prompt Config kinds.
- Editing LLM output schemas, JSON Schema response formats, or runtime validators from the UI.
- Authentication, operator identity, approvals, or audit trails beyond append-only Config versions.
- Bulk import/export UX beyond the advanced raw JSON path.
- A redesigned grouped Configs navigation.
- Automated migration of existing Neon rows beyond first-use seeding for missing Config kinds.
- Changing the scoring vocabulary.
- Changing model recommendation rules.
- Video-generation UI.

## Further Notes

- The implementation should preserve current behavior by seeding `stage_prompts` from existing hardcoded prompt constants before wiring the Run path to consume config.
- The user explicitly chose form CRUD for all Config kinds, full CRUD for Priority logic, compact Configs placement before Run, raw JSON as a quiet advanced path, and Stage prompt restore only for individual prompts.
- Published to GitHub as parent issue #15; implementation slices are #16-#23.
