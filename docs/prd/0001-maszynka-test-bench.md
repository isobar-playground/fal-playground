# PRD: Maszynka — Content Factory test bench tab

Source spec: `dump/Maszynka v2.0.md` (UX author). Decisions below were resolved in a grilling session on 2026-07-08; domain terms are defined in `CONTEXT.md`, the storage decision in `docs/adr/0001-maszynka-runs-and-configs-in-neon.md`.

## Problem Statement

A single hand-written prompt is not enough to test AI asset generation in a controlled way. When everything is typed into one prompt, the operator cannot tell which rule was applied, which preset influenced the result, whether the model ignored the style, whether the prompt builder combined instructions badly, whether asset roles were interpreted correctly, or whether a bad result came from the model, the prompt, the config, or the input asset. The existing playground tabs (Images / Video / Chat) only test raw prompts against models — they cannot test the *logic* of the Content Factory prompt system.

## Solution

A new **Maszynka** tab in the playground: an operator test bench that runs a full, decomposed pipeline per Run — user prompt + role-tagged asset uploads → content safety pre-check → asset analysis → prompt builder contract → prompt builder (OpenRouter, structured output) → prompt reviewer → FAL request mapper → FAL generation → manual scoring — recording every stage's inputs, outputs, config versions, and status so any Run can be fully replayed and compared. Runs and all pipeline configs live server-side in Neon; configs are operator-editable and append-only versioned.

## User Stories

1. As an operator, I want a Maszynka tab next to Images / Video / Chat, so that I can run controlled pipeline tests without leaving the playground.
2. As an operator, I want to type a raw creative prompt (`userPromptRaw`), so that the pipeline starts from my intent.
3. As an operator, I want separate upload fields for packshot, style reference, brand reference, and campaign reference, so that each asset's role is set by where I dropped it, not by a description.
4. As an operator, I want the packshot to be treated as the product to preserve (packaging, color, proportions, logo, label, variant), so that generated assets don't mutate the product.
5. As an operator, I want to pick one Hook from the Hook library, so that a chosen attention-grabbing text ("zaczepka") is rendered on the asset.
6. As an operator, I want to pick one Style and one Camera setting from the Preset library, so that the run tests a controlled visual configuration.
7. As an operator, I want to pick target language, aspect ratio, and variants count, so that generation settings are explicit per run.
8. As an operator, I want the system to recommend a FAL model with a reason, so that I have a sensible default per scenario.
9. As an operator, I want to override the recommended model, so that I can compare models on identical inputs; the run must record both the recommendation and my override.
10. As an operator, I want a content safety pre-check on my prompt and uploads before generation, so that blocked or risky inputs stop the run early with a clear status.
11. As an operator, I want the system to analyze each uploaded asset according to its role, so that the prompt builder works from a structured description instead of raw pixels.
12. As an operator, I want an optional "Improve prompt" button that proposes a rewritten prompt which I explicitly accept or discard, so that the improved version is only used with my consent and both versions are recorded.
13. As an operator, I want the app to assemble a single validated Contract (user input, assets + analysis, hook, presets, global rules, priority logic, model capability, generation settings), so that the prompt builder always receives complete, versioned input.
14. As an operator, I want the Prompt builder to return structured JSON (`finalPrompt`, `negativePrompt`, `promptSummary`, `appliedRules`, `riskNotes`), so that I can inspect what the system actually built.
15. As an operator, I want the Prompt reviewer to gate the built prompt (`pass` / `revise` / `failed`, max one revise cycle), so that broken prompts never reach FAL.
16. As an operator, I want the FAL request mapper to fit the prompt to the selected model's capabilities (negative prompt support, seed, image count, multi-image input) and record `mappingNotes`, so that I can see which fields were sent, skipped, or folded into the prompt.
17. As an operator, I want a debug preview showing the Contract, final prompt, negative prompt, reviewer output, and FAL payload, so that I can see what the system really sent to the model.
18. As an operator, I want to pick the OpenRouter model separately for each LLM stage (safety, analysis, improvement, builder, reviewer), with sensible defaults, so that I can experiment with pipeline models.
19. As an operator, I want generated assets displayed in the run with the existing lightbox behavior, so that I can inspect results closely.
20. As an operator, I want to score each generated asset (decision accept/reject/mixed, blocker issues from the fixed vocabulary, comment, next action), so that test results are recorded and comparable.
21. As an operator, I want a run history listing all runs (shared, server-side), so that I can reopen any past run and see its full trace: inputs, assets, config versions, prompts, reviewer output, FAL payload, outputs, scoring, final status.
22. As an operator, I want every run stage to record one of the defined statuses (from `run_started` through `run_completed`, including all failure statuses), so that I can tell exactly where and why a run stopped.
23. As an operator, I want to edit hooks, styles, camera settings, global rules, priority logic, and the model capability matrix in a Configs section (JSON editor with validation), so that I can iterate configs without a developer.
24. As an operator, I want every config save to create a new version (append-only) and every run to snapshot the config versions it used, so that any run is reproducible even after configs change.
25. As an operator, I want global rules applied to every run automatically, so that safety, product/brand preservation, copy removal, language override, typography, and composition rules are always in force without manual selection.
26. As an operator, I want a `provider_policy_blocked` status when FAL/the provider rejects a request, so that policy rejections are distinguishable from technical failures (`fal_generation_failed`).
27. As a developer, I want each pipeline stage's raw LLM request and response persisted with the run, so that misbehaving stages can be debugged from data alone.
28. As a UX author, I want runs to record which rules/presets the builder claims it applied (`appliedRules`) next to the operator's scoring blockers, so that I can tell config problems from model problems.
29. As an operator, I want the run schema to already carry `assetType: image | video`, so that the video path can be enabled later without a data migration (video UI itself is stage 2).

## Implementation Decisions

- **New tab**: fourth `AppMode` value; the Maszynka view is a separate component and code path, following the Chat tab precedent (isolated view component + own lib/ modules).
- **Storage (ADR 0001)**: runs and configs live in Neon Postgres behind API routes — a deliberate deviation from the app's client-first localStorage pattern. Configs are append-only versioned rows (`id`, auto-incremented `version`, JSON body); runs reference config `id`+`version` and store snapshots. `createdBy` is consciously omitted.
- **Config kinds**: hooks, styles, camera settings, global rules, priority logic, model capability matrix — all editable in the tab's Configs section as validated JSON; seed data ships with the code and populates Neon on first use.
- **Hook** = short attention-grabbing marketing text rendered on the asset (per CONTEXT.md); hook config carries id, text, placement/tone guidance, version.
- **Priority logic** = versioned ordered list of layers, most important first: content safety > product/brand preservation > packshot analysis > hook > style > camera setting > operator prompt; passed to the builder as "on conflict, higher wins". Initial content needs UX author sign-off.
- **LLM stages via OpenRouter**: five stages (safety pre-check, asset analysis, prompt improvement, prompt builder, prompt reviewer), each with its own operator-selectable OpenRouter model and per-stage vision-capable defaults; all use the existing `/api/chat` proxy pattern (BYOK OpenRouter key) with `response_format: json_schema` (strict) — the same JSON Schema objects double as output validators.
- **Safety pre-check** is one vision LLM call returning status + reasons (no external moderation API); statuses per spec section 6.
- **Pure module layer** (approved): `schemas` (JSON Schemas + validators for Contract and all stage outputs), `contract` (assembler), `stages` (per-stage OpenRouter request builders + response parsers), `mapper` (FAL request mapper driven by the capability matrix, emits `mappingNotes`), `recommend` (rule table from spec section 12), `pipeline` (client-side run orchestrator walking the status machine from spec section 16, persisting each stage to Neon fire-and-forget-plus-await-on-critical).
- **FAL generation** reuses the existing client-side Fal runner and `fal.storage.upload` for input assets; asset URLs are stored in the run.
- **Model catalog**: shared with the Images tab; `ideogram/v4` and `xai/grok-imagine-image` get added as catalog entries (endpoint availability on fal.ai to be verified during implementation).
- **Model recommendation** implements the spec's six-rule table verbatim; recommendation, override, and reason are recorded per run.
- **Run history** is read from Neon via a list + detail API; no localStorage copy (runs are shared across browsers/operators).
- **Scoring vocabulary** (decisions, blockers, next actions) is fixed in code from spec section 17 — not a config — since the reviewer/scoring comparability depends on a stable vocabulary.
- **Statuses** are exactly the spec section 16 list; the orchestrator is a linear state machine with one optional revise loop (builder → reviewer → builder, max 1 retry).

## Testing Decisions

- **No automated tests in the MVP** (explicit decision); verification is manual through the tab. There is currently no test runner in the repo.
- The module split still follows the codebase's established pattern of pure, framework-free helpers (cf. the chat request builder), so `mapper`, `recommend`, `schemas`, and `contract` remain unit-testable without React or network if tests are added later. A good test, when added, asserts external behavior (input object → output object) and never internal call order.

## Out of Scope

- Video generation UI (schema carries `assetType` from day one; UI is stage 2 after the image path stabilizes; no video model recommendation rules — those await the UX author).
- Operator identity / auth (`createdBy` omitted; internal test sandbox).
- Langfuse or any external tracing service.
- Automated scoring, aggregate dashboards, cross-run comparison views (history + full trace is enough for MVP).
- Editing the scoring vocabulary via configs.
- A separate `Project context` input field (explicitly removed in spec v2.0).
- Cost estimation/live pricing for the LLM stages (FAL-side cost reuses whatever the shared catalog already provides).

## Further Notes

- Full pipeline per run = 4–5 LLM calls + FAL generation; a single run will take tens of seconds. Communicate this in the UI (stage progress indicator doubles as the status display).
- Spec gaps found and resolved during grilling: hook config structure (resolved: text zaczepka), priority logic definition (resolved: ordered rank list, pending UX sign-off), video recommendation rules (deferred).
- Implementation order should follow spec section 20, adjusted for the Neon-config decision (config storage + API before the pipeline stages).
