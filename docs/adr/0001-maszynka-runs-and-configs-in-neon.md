# Maszynka runs and configs live in Neon Postgres, not localStorage

The rest of the playground is client-first (runs, keys, history in localStorage; Neon only as fire-and-forget log sink). For the Maszynka test bench we deliberately deviate: run tracking AND pipeline configs (hooks, styles, camera settings, global rules, priority logic, model capability matrix, stage prompts) are stored server-side in Neon and read back through API routes. Reasons: run history must be shared and comparable across operators/browsers (the whole point of the test bench), and the UX operator must iterate configs herself without a developer deploy. Configs are **append-only** — every save creates a new row with an incremented version; runs reference config id+version and store a snapshot, so any run is fully reproducible. Operator identity (`createdBy`) is consciously omitted in MVP.

Follow-up decision: operator-facing config editing should be form-based CRUD over individual config items, but each save still writes a new version of the whole config kind. Stage prompts also support restore, scoped to one stage prompt at a time: restoring an older prompt copies that prompt into the current set and saves a new `stage_prompts` version, never overwriting history. We do not expose restore for hooks/presets/global rules in MVP because restoring a whole historical collection could silently revert unrelated item edits. The `asset_analysis` stage prompt is modeled as shared base instructions plus one role-specific instruction for each Asset role (`packshot`, `style_reference`, `brand_reference`, `campaign_reference`) so role differences remain explicit without duplicating the whole stage prompt.

Only prompt instruction text is operator-editable. LLM response schemas, JSON Schema response formats, and runtime validators stay in code; changing those requires code changes because the run pipeline, validation statuses, and debug UI depend on those contracts.

Priority logic is full CRUD in the form editor, including adding, removing, renaming, and reordering layers. The UX operator owns the flow design, so the app should not lock this config to a canonical layer list in MVP.

Deleting a config item removes it from the next saved version of that config kind rather than marking it archived. Prior versions and prior Runs remain reproducible through their stored snapshots.

The Configs UI should default to structured forms. Raw JSON editing remains available as an unobtrusive advanced/debug path, using the same validation and append-only save flow, but it should not compete with the operator's main editing workflow.

Runs store the `stage_prompts` config version and snapshot alongside the other config snapshots. Debug requests may also show the exact system prompt sent to each LLM stage, but the run trace should still expose a single stage-prompts snapshot for version-level comparison.

After a successful config save in the Configs section, the Run form refreshes its latest-config state automatically. Operators should not need a separate refresh step before running generation with the just-saved config.

Config items do not carry their own `version` fields in MVP. Versioning belongs to the whole Config kind snapshot; selected items are still reproducible because Runs store the selected config version and item snapshot.

The Configs section moves above Run as the third top-level section, but it defaults to a compact collapsed overview with config versions. Opening a specific Config kind reveals its form editor; all editors are not expanded at once by default.

The Configs overview remains a flat list of Config kinds in MVP. We do not add visual grouping such as Creative/Pipeline because the current taxonomy is already the operator-facing editing unit.

Config item IDs are set when a new item is created and are not editable in the normal form editor afterward. The create form may suggest an ID from the item name/text. The advanced raw JSON path can still change IDs when an exceptional repair is needed.

`stage_prompts.prompt_builder` includes the main system prompt plus the revision instruction template used when Prompt reviewer returns `revise`. The revision template is operator-editable but less prominent than the main stage prompt in the form.

Saving changes to the Content safety Stage prompt shows a lightweight warning/confirmation because this prompt controls the first pipeline gate. The warning informs the operator about risk; it does not prevent the save.

Scope decisions from the same session: the run schema carries `assetType: image | video` from day one, but the video generation UI ships in a second stage, after the image path stabilizes (the spec's model-recommendation rules are image-only; video rules await the UX author). Each LLM pipeline stage (safety pre-check, asset analysis, prompt improvement, prompt builder, prompt reviewer) has its own operator-selectable OpenRouter model with per-stage defaults.
