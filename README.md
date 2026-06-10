# 🍌 Fal Prompt Playground

Browser-only tool for testing prompts on Fal.ai image models (Nano Banana family +
OpenAI GPT Image). No backend — your Fal key lives in `localStorage` and calls fal.ai
directly from the browser.

## Run

```bash
pnpm install
pnpm dev      # http://localhost:3000
```

## Flow

1. **Key** — paste your Fal key (saved in the browser).
2. **References** — drop any number of images (used by *edit* models).
3. **Prompt** — type it; optionally "Save to history" (session, click to reload).
4. **Models** — pick one or more; set images / resolution / quality / size per model.
5. **Cost** — bottom bar shows the estimate before you generate.
6. **Generate** — runs each model in parallel with live logs.
7. **Results** — image URLs persist in the browser. Each image shows its real cost; the
   header shows total spend. "↑ as reference" reuses an output in the next round. Click an
   image for a fullscreen lightbox with arrows + thumbnails across **all** generations.

"Reset all" clears key, history, results and references.

## Models

| Endpoint | Mode | Est. / image |
| --- | --- | --- |
| `fal-ai/nano-banana` (+`/edit`) | generate / edit | $0.039 |
| `fal-ai/nano-banana-2` (+`/edit`) | generate / edit | $0.06–$0.16 (by resolution) |
| `fal-ai/nano-banana-pro` (+`/edit`) | generate / edit | $0.15 / $0.30 at 4K |
| `fal-ai/gpt-image-1/text-to-image` (+`/edit-image`) | generate / edit | $0.011–$0.25 (quality × size) |
| `openai/gpt-image-2` (+ `fal-ai/gpt-image-2/image-to-image`) | generate / edit | $0.006–$0.401 (quality × size) |

Add a model = one entry in [lib/models.ts](lib/models.ts). Prices are hardcoded estimates
(June 2026); per-image "real cost" is computed from the unit price × images actually returned.

## Deploy (Vercel)

No env vars (the user supplies the key in the UI).

```bash
npx vercel --prod
```

Direct browser → fal.ai calls are a deliberate prototype trade-off (bring-your-own key).
If fal.ai blocks browser CORS, the next step is a thin Next.js proxy route — intentionally
not built. See [NOTES.md](NOTES.md).
