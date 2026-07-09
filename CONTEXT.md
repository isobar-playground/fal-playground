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
The operator-editable instruction text that guides one LLM pipeline stage, such as Content safety, Asset analysis, Prompt improvement, Prompt builder, or Prompt reviewer.
_Avoid_: system prompt, hardcoded prompt

**Stage prompt restore**:
An operator action that reuses an older Stage prompt as the content for the same stage in a new Config version, preserving the full version history.
_Avoid_: rollback, overwrite

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
