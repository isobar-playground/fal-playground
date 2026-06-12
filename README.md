# 🍌 Fal Prompt Playground

Browser tool for testing prompts on Fal.ai image models (Nano Banana family + OpenAI
GPT Image). Your Fal key lives in `localStorage` and calls fal.ai directly from the
browser. Most server code is thin proxies (`/api/pricing`, `/api/credits`, `/api/dev-key`).

**One exception:** the prompt **beautifier** (`/api/beautify`) calls OpenRouter with a
**server-side secret** (`OPENROUTER_API_KEY`). That key is read via `process.env` in the
route, never logged, and never shipped to the browser. So unlike the rest of the app, this
feature does require a stored server secret — set it to enable the ✨ Upiększ button.

## Run

```bash
pnpm install
pnpm dev      # http://localhost:3000
```

**Local convenience:** put `FAL_KEY=...` in `.env.local` and it auto-fills the key field
in dev (only when the browser has no key stored). It's served via `/api/dev-key`, which
returns `null` in production — the key is never shipped to a deployed build. Change the env
key? Hit "Reset all" to pick it up.

**Account balance (optional):** set `FAL_ADMIN_KEY=...` (an **admin** key — the normal key
gets 403 on billing) in `.env.local` / Vercel env. The bottom bar then shows your Fal
credit balance, refreshed after each generation. It's read server-side via `/api/credits`
(`GET /v1/account/billing?expand=credits`); the admin key never reaches the browser, only
the balance number does. Note: this is the **deployment account's** balance (the admin
key's), independent of whatever per-user key is typed in the UI. Unset → balance hidden.

**Prompt beautifier (optional):** set `OPENROUTER_API_KEY=...` in `.env.local` / Vercel env
to enable the ✨ **Upiększ** button under the prompt. It rewrites your raw prompt into a
polished one via OpenRouter (default model `google/gemini-3.5-flash`, override with
`OPENROUTER_MODEL`). The key is server-only — read in [`/api/beautify`](app/api/beautify/route.ts),
never sent to the browser. Without the key the button returns a clear "not configured" error
and normal generation (sending **your** prompt) is unaffected. Input is hard-capped at 8000
chars to bound input-token cost. You pick a **style** (Lekkie / Umiarkowane / Agresywne) and
**language** (Auto / EN / PL), get an editable beautified field, and in the bottom bar choose
to send **Twój / Upiększony / Oba** (Oba runs each model twice → ~2× image cost).

## Flow

1. **Key** — paste your Fal key (saved in the browser).
2. **References** — drop any number of images (used by *edit* models).
3. **Prompt** — type it; optionally "Save to history" (session, click to reload).
4. **Models** — pick one or more. Each model shows only the settings it actually
   supports (from its Fal input schema): images, plus e.g. resolution/aspect/seed/safety
   tolerance/format for Nano Banana, or quality/size/format for GPT Image. `seed` appears
   only for seed-capable models (empty = random; 🎲 to randomize).
5. **Cost** — bottom bar shows the estimate, priced against **live Fal pricing** fetched
   for the selected models (refreshed on selection change and again right before generating).
6. **Generate** — runs each model in parallel with live logs.
7. **Results** — image URLs persist in the browser. Each image shows its real cost; the
   header shows total spend. "↑ as reference" reuses an output in the next round. Click an
   image for a fullscreen lightbox with arrows + thumbnails across **all** generations.

**Export / Import session** (header) — download the whole session (key, prompt history,
all generated URLs, model selection) as a base64-encoded `.falsession` file to share with
others, or load one back (legacy plain-JSON files still import). Import **overwrites** the
current session (confirmed first); export warns that the file contains your API key.
Base64 is obfuscation, not encryption — anyone can decode it, so treat the file as a
secret. "Reset all" clears key, history, results and references.

## Models

| Endpoint | Mode | Est. / image |
| --- | --- | --- |
| `fal-ai/nano-banana` (+`/edit`) | generate / edit | $0.039 |
| `fal-ai/nano-banana-2` (+`/edit`) | generate / edit | $0.06–$0.16 (by resolution) |
| `fal-ai/nano-banana-pro` (+`/edit`) | generate / edit | $0.15 / $0.30 at 4K |
| `fal-ai/gpt-image-1/text-to-image` (+`/edit-image`) | generate / edit | $0.011–$0.25 (quality × size) |
| `openai/gpt-image-2` (+ `fal-ai/gpt-image-2/edit`) | generate / edit | $0.006–$0.401 (quality × size) |

Each model row links to its fal.ai API docs (`…/api`).

Add a model = one entry in [lib/models.ts](lib/models.ts).

### Pricing

Cost is computed as **live base price × tier multiplier × images**:

- The **base price** per endpoint is fetched live from Fal's
  `GET /v1/models/pricing` (via the [`/api/pricing`](app/api/pricing/route.ts) proxy, using
  your key). This tracks Fal automatically.
- Fal returns a single base `unit_price` per endpoint — it does **not** break out
  quality/size/resolution. So the **tier multiplier** is applied on top from the published
  matrices in [lib/models.ts](lib/models.ts): for nano-banana-2/pro these are Fal's own
  documented `0.75× / 1.5× / 2×` resolution rates; for GPT Image they are the ratios of the
  published quality×size grid relative to the `medium · 1024²` cell.
- If the pricing fetch fails (offline, bad key, blocked), it **falls back to the local base**
  (June 2026) and the bar says so.
- Per-image "real cost" on each result = the unit price used at generation time × images
  actually returned. Fal exposes no per-request billed amount, so this is the most precise
  figure obtainable (see [NOTES.md](NOTES.md)).

## Deploy (Vercel)

Image generation needs no env vars (the user supplies the Fal key in the UI). Optional env:
`FAL_KEY` (dev autofill), `FAL_ADMIN_KEY` (balance display), and `OPENROUTER_API_KEY` /
`OPENROUTER_MODEL` (prompt beautifier — server secret, never shipped to the browser). The
`/api/*` routes run as serverless functions; the rest is static.

```bash
npx vercel --prod
```

Image **generation** still goes browser → fal.ai directly (bring-your-own key). If fal.ai
blocks browser CORS for those calls, the `/api/pricing` proxy is the pattern to extend.
See [NOTES.md](NOTES.md).
