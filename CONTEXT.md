# Fal Prompt Playground

Browser playground for testing prompts against Fal.ai image/video models plus an OpenRouter chat, extended with **Maszynka** — an operator test bench that runs a full Content Factory pipeline (config-driven prompt building, review, generation, scoring) to test the *logic* of the system, not just single prompts.

## Language

### Maszynka (Content Factory test bench)

**Run**:
One full operator test execution, from user prompt + assets through prompt building and FAL generation to manual scoring. Identified by `runId`; every stage's inputs, outputs and status are recorded.
_Avoid_: generation (that's the FAL step only), session

**Hook**:
A short attention-grabbing marketing text ("zaczepka") rendered on the generated asset, e.g. "Przeczytaj to dwa razy, zanim podejmiesz decyzję", "Specjaliści to polecają". Chosen from the Hook library; the Prompt reviewer checks the asset copy against the selected hook config.
_Avoid_: headline, claim, caption

**Config kind**:
A category of Maszynka settings versioned as one collection, such as Hooks, Styles, Camera settings, Global rules, Priority logic, or Model capability matrix.
_Avoid_: table, section

**Config item**:
One operator-editable entry inside a Config kind, such as a single Hook, Style, Camera setting, Global rule, Priority layer, or Model capability entry.
_Avoid_: row, record

**Config version**:
A reproducible snapshot of one Config kind used to understand or rerun a Run later.
_Avoid_: draft, edit

**Stage prompt**:
The instruction text that guides one LLM pipeline stage, such as Content safety, Asset analysis, Prompt improvement, Prompt builder, or Prompt reviewer. Defined in code (`lib/maszynka/*.ts`), not as an operator-editable Config kind.
_Avoid_: system prompt (too generic), config prompt

**Asset role**:
The systemic function of an uploaded image, derived from which upload field it came through — `packshot`, `style_reference`, `brand_reference`, or `campaign_reference`. Never inferred from operator description.

**Packshot**:
The product image that must be preserved (packaging, color, proportions, logo, label, variant) in the generated asset.

**Preset**:
A versioned JSON config selected per run: a **Style** (visual direction) or a **Camera setting** (framing/lens/angle). Loaded from config storage, never hardcoded in components.

**Contract (Prompt builder contract)**:
The single validated JSON object assembled by the app before calling the Prompt builder: user input, asset analysis, hook/preset configs with versions, global rules, priority logic, model capability, generation settings.

**Priority logic**:
A versioned, ordered list of layers (most important first: content safety > product/brand preservation > packshot analysis > hook > style > camera setting > operator prompt) passed in the Contract; on conflict, the higher layer wins.
_Avoid_: conflict matrix, rule weights

**Prompt builder**:
The LLM step (OpenRouter, structured output) that turns a Contract into `finalPrompt` + `negativePrompt` + applied-rules metadata.

**Prompt reviewer**:
The LLM step that gates a built prompt before FAL: returns `pass` / `revise` / `failed`; at most one revise cycle in MVP.

**Manual scoring**:
The operator's per-asset quality verdict after generation: decision (accept/reject/mixed), blocker issues, comment, next action.

### Maszynka Video (video pipeline test bench)

**Video run**:
One Maszynka Video test execution, from Planner configuration through grid generation, Crops, and per-Scene Clips to the joined Final video. Recorded server-side with every stage's inputs and outputs. Distinct from the (image) Run above.
_Avoid_: run (unqualified), session

**Planner**:
The LLM stage that turns an operator-pasted system prompt plus input JSON into a Scene plan (short video) or Master scene plan with Grid batches (long video). Owns all scene-splitting and layout decisions; the app only displays and validates its output.
_Avoid_: brief generator, director

**Scene**:
One planned shot of the final video (roughly four seconds), identified by a globally unique `sceneId` with a global `order`. A Scene belongs to exactly one Grid batch and yields exactly one Crop and one Clip.
_Avoid_: frame, shot, segment

**Scene plan**:
The Planner output for a short video (5–30 s): all Scenes plus a single grid payload.

**Master scene plan**:
The Planner output for a long video (31–180 s): all Scenes, spanning multiple Grid batches.
_Avoid_: storyboard

**Grid batch**:
A group of at most four Scenes generated together as one grid image, identified by `batchId` and run independently of other batches.
_Avoid_: sheet, page, tile set

**Crop**:
The panel cut out of a generated grid for exactly one Scene, matched by `sceneId` — never by position alone. The operator may replace it before animation (Replace crop).
_Avoid_: panel, tile, cell

**Clip**:
The video generated from one Crop by an image-to-video model; its duration comes from the Scene's JSON.
_Avoid_: fragment, cut

**Final video**:
The hard concatenation of all Clips in global `order` — no trimming, no transitions, no re-encoding decisions.
_Avoid_: montage, edit, export
