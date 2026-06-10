# Notes

## Question

Can a non-technical person — with only their own Fal key — run the whole loop in the
browser: references → prompt → model pick → cost preview → generate → results, and reuse an
output as a reference in the next round? Design constraint: **no backend**.

## Deliberately skipped

- No tests, minimal error handling (per-model errors land on the result card).
- Reference files aren't persisted (only their uploaded URLs, within a run).

## Pricing — what's live vs. local

- The **base price** per endpoint is fetched live from Fal's `GET /v1/models/pricing`
  (`/api/pricing` proxy, user's key), before each generation.
- Fal returns **one base `unit_price` per endpoint**, not a quality/size/resolution
  breakdown, and **no per-request billed amount exists in any API** (the `usage` endpoint
  needs an admin key, aggregates per endpoint/day, and has no `request_id`). So the
  per-image figure = `live base × documented tier multiplier`, and "real cost" =
  that × images actually returned. This is the most precise number obtainable.
- Tier multipliers live in `lib/models.ts` (nano: Fal's own 0.75×/1.5×/2× resolution
  rates; GPT: ratios of the published quality×size grid). They assume Fal's base price
  maps to the reference cell (nano = 1K, GPT = medium·1024²).
- Falls back to the local June-2026 base if the fetch fails (offline / bad key / CORS).

**Confirmed against the live API (real key):**
- Nano Banana family → `unit: "images"`, real per-image base. `nano-banana` = **$0.0398**,
  `nano-banana-2` = $0.08 (= 1K base), `nano-banana-pro` = $0.15 → live base is used.
- GPT Image family → placeholder units (`gpt-image-1` = `1 "credits"`, `gpt-image-2` =
  `1 "units"`, gpt-image-2 edit = `"compute seconds"`). **No usable per-image price**, so
  these fall back to the local quality×size matrix by design.

## Verdict — fill in after running with a real key

- [ ] Do direct browser → fal.ai calls work (CORS, upload, subscribe)?
- [ ] Do the edit endpoints work on the Fal key alone (no OpenAI BYOK)?
- [ ] Do the `resolution` params for nano-banana-2 / pro match the real schema?
- [x] `GET /v1/models/pricing` works on a normal key. Nano = per-image (live base used);
      GPT = placeholder credits (local matrix used). Base maps to nano 1K as assumed.
- [ ] Does the computed cost match Fal's actual billing (esp. GPT quality tiers)?
- [ ] Is the flow understandable to a non-technical user without instructions?
