# Notes

## Question

Can a non-technical person — with only their own Fal key — run the whole loop in the
browser: references → prompt → model pick → cost preview → generate → results, and reuse an
output as a reference in the next round? Design constraint: **no backend**.

## Deliberately skipped

- No tests, minimal error handling (per-model errors land on the result card).
- Prices are hardcoded (June 2026). Fal has no simple cost-estimate API, so "real cost" is
  computed locally as unit price × images returned (ignores GPT's tiny text-token charge).
- No server proxy — see the CORS note in the README. First thing to add if browser calls
  to fal.ai get blocked.
- Reference files aren't persisted (only their uploaded URLs, within a run).

## Verdict — fill in after running with a real key

- [ ] Do direct browser → fal.ai calls work (CORS, upload, subscribe)?
- [ ] Do the edit endpoints work on the Fal key alone (no OpenAI BYOK)?
- [ ] Do the `resolution` params for nano-banana-2 / pro match the real schema?
- [ ] Does the computed cost match Fal's actual billing?
- [ ] Is the flow understandable to a non-technical user without instructions?
