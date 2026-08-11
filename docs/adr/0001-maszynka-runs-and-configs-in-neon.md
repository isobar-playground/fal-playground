# Maszynka runs and configs live in Neon Postgres, not localStorage

The rest of the playground is client-first (runs, keys, history in localStorage; Neon only as fire-and-forget log sink). For the Maszynka test bench we deliberately deviate: run tracking AND pipeline configs (hooks, styles, camera settings, global rules, priority logic, model capability matrix) are stored server-side in Neon and read back through API routes. Reasons: run history must be shared and comparable across operators/browsers (the whole point of the test bench), and the UX operator must iterate configs herself without a developer deploy. Configs are **append-only** — every save creates a new row with an incremented version; runs reference config id+version and store a snapshot, so any run is fully reproducible. Operator identity (`createdBy`) is consciously omitted in MVP.

Follow-up decision: operator-facing config editing should be form-based CRUD over individual config items, but each save still writes a new version of the whole config kind. We do not expose restore for hooks/presets/global rules in MVP because restoring a whole historical collection could silently revert unrelated item edits.

LLM **stage prompts** (Content safety, Asset analysis, Prompt improvement, Prompt builder, Prompt reviewer) are **not** Config kinds. They live as hardcoded constants in the pipeline modules (`lib/maszynka/contentSafety.ts`, `assetAnalysis.ts`, `promptImprovement.ts`, `promptBuilder.ts`, `promptReviewer.ts`). Changing stage instruction text requires a code change and deploy. Runs still expose the exact system/user messages sent to each LLM stage in debug request traces for inspection.

Only prompt instruction text in operator-facing Config kinds is editable from the UI. LLM response schemas, JSON Schema response formats, and runtime validators stay in code; changing those requires code changes because the run pipeline, validation statuses, and debug UI depend on those contracts.

Priority logic is full CRUD in the form editor, including adding, removing, renaming, and reordering layers. The UX operator owns the flow design, so the app should not lock this config to a canonical layer list in MVP.

Deleting a config item removes it from the next saved version of that config kind rather than marking it archived. Prior versions and prior Runs remain reproducible through their stored snapshots.

The Configs UI should default to structured forms. Raw JSON editing remains available as an unobtrusive advanced/debug path, using the same validation and append-only save flow, but it should not compete with the operator's main editing workflow.

After a successful config save in the Configs section, the Run form refreshes its latest-config state automatically. Operators should not need a separate refresh step before running generation with the just-saved config.

Config items do not carry their own `version` fields in MVP. Versioning belongs to the whole Config kind snapshot; selected items are still reproducible because Runs store the selected config version and item snapshot.

The Configs section moves above Run as the third top-level section, but it defaults to a compact collapsed overview with config versions. Opening a specific Config kind reveals its form editor; all editors are not expanded at once by default.

The Configs overview remains a flat list of Config kinds in MVP. We do not add visual grouping such as Creative/Pipeline because the current taxonomy is already the operator-facing editing unit.

Config item IDs are set when a new item is created and are not editable in the normal form editor afterward. The create form may suggest an ID from the item name/text. The advanced raw JSON path can still change IDs when an exceptional repair is needed.

Scope decisions from the same session: the run schema carries `assetType: image | video` from day one, but the video generation UI ships in a second stage, after the image path stabilizes (the spec's model-recommendation rules are image-only; video rules await the UX author). Prompt improvement is optional per run (operator selects an OpenRouter model or leaves it as none). Other LLM pipeline stages use fixed default OpenRouter models in code.

**Superseded (August 2026):** An earlier plan treated `stage_prompts` as a seventh Config kind with operator-editable instruction text, per-stage restore, and run snapshots. That scope was removed; see `docs/prd/0002-maszynka-form-configs-and-stage-prompts.md` for the original PRD and what was cancelled.
