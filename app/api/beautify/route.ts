// Thin proxy to OpenRouter's chat-completions endpoint that rewrites ("beautifies")
// a raw image prompt. The OPENROUTER_API_KEY is a server-only secret — it never
// reaches the browser. No per-user auth here (deliberate: internal prototype).
// POST https://openrouter.ai/api/v1/chat/completions  (OpenAI-compatible)

export const runtime = "nodejs";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3.5-flash";
const MAX_PROMPT_CHARS = 100_000; // hard input cap — guards input-token cost
const MAX_TOKENS = 900; // output cap — enough for a rich prompt

type Strength = "light" | "moderate" | "aggressive";
type Language = "auto" | "en" | "pl";

const SYSTEM_PROMPT = `You are a prompt engineer for state-of-the-art text-to-image and image-editing
models (Google's Nano Banana / Gemini-image family and OpenAI's GPT Image).
Rewrite the user's raw image prompt into ONE polished prompt these models follow
well. Output ONLY the rewritten prompt — no preamble, quotes, markdown or notes.

Rules:
1. Preserve intent exactly. Keep every concrete element: subjects, named/brand
   entities, text to render, counts, colors, spatial relations. Never swap the
   subject; never drop details the user gave.
2. Detect and KEEP the prompt's nature:
   - SCENE DESCRIPTION (generate) -> enrich into vivid, coherent description.
   - EDITING INSTRUCTION (e.g. "change shirt to red", "place X on Y") -> keep it
     an instruction; make it precise; do NOT expand into a scene description or
     invent new content.
3. Modern natural-language prose, one coherent block. No keyword soup, no legacy
   boosters ("8k, ultra-detailed, masterpiece, trending on artstation").
4. Additions (lighting, lens, mood, style) must serve the stated intent, never
   overwrite or contradict it.

Reference images:
- You may be told N reference images are attached, with an optional role label per
  position. You CANNOT see them — never describe their pixels or invent contents.
- When references exist, refer to them explicitly by position and given role, e.g.
  "using the logo from image 1 and the woman from image 2". Map roles via the
  provided labels and the user's wording. Unlabeled + unspecified -> refer to it
  neutrally by position ("image 2"), no invention.

Language (per request): en -> English; pl -> Polish; auto -> same as the user's
prompt. Translate faithfully, preserving proper nouns and any verbatim render text.

Strength (per request):
- light -> fix grammar/clarity, resolve ambiguity, minimal additions, stay close
  to original length.
- moderate -> enrich with composition, light, materials, mood, light camera/style
  cues; one tight paragraph.
- aggressive -> richly detailed, photographer-grade specificity, still obeying
  rules 1-2.`;

const STRENGTHS: Strength[] = ["light", "moderate", "aggressive"];
const LANGUAGES: Language[] = ["auto", "en", "pl"];

function buildUserMessage(
  prompt: string,
  strength: Strength,
  language: Language,
  referenceCount: number,
  referenceLabels: string[],
): string {
  const lines = [`Target language: ${language}`, `Strength: ${strength}`];
  if (referenceCount > 0) {
    lines.push(`Reference images: ${referenceCount}`);
    for (let i = 0; i < referenceCount; i++) {
      const label = referenceLabels[i]?.trim();
      lines.push(`  image ${i + 1}: ${label || "—"}`);
    }
  }
  lines.push("", "User prompt:", prompt);
  return lines.join("\n");
}

export async function POST(req: Request) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return Response.json(
      { error: "Beautifier not configured — set OPENROUTER_API_KEY in the server env." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const rawPrompt = typeof b.prompt === "string" ? b.prompt : "";
  const prompt = rawPrompt.trim();
  if (!prompt) return Response.json({ error: "Empty prompt" }, { status: 400 });
  if (rawPrompt.length > MAX_PROMPT_CHARS) {
    return Response.json(
      { error: `Prompt too long (${rawPrompt.length} > ${MAX_PROMPT_CHARS} chars).` },
      { status: 413 },
    );
  }

  const strength: Strength = STRENGTHS.includes(b.strength as Strength)
    ? (b.strength as Strength)
    : "moderate";
  const language: Language = LANGUAGES.includes(b.language as Language)
    ? (b.language as Language)
    : "auto";
  const referenceCount =
    typeof b.referenceCount === "number" && Number.isFinite(b.referenceCount)
      ? Math.max(0, Math.min(50, Math.floor(b.referenceCount)))
      : 0;
  const referenceLabels = Array.isArray(b.referenceLabels)
    ? b.referenceLabels.map((x) => (typeof x === "string" ? x : "")).slice(0, referenceCount)
    : [];

  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const userMessage = buildUserMessage(prompt, strength, language, referenceCount, referenceLabels);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/fal-prompt-playground",
        "X-Title": "Fal Prompt Playground",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
      }),
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      // Surface a trimmed upstream message; never echo the key.
      return Response.json(
        { error: `OpenRouter ${res.status}: ${text.slice(0, 300)}` },
        { status: res.status === 401 ? 502 : res.status },
      );
    }

    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = JSON.parse(text);
    } catch {
      return Response.json({ error: "OpenRouter returned non-JSON response." }, { status: 502 });
    }

    const beautified = data.choices?.[0]?.message?.content?.trim();
    if (!beautified) {
      return Response.json({ error: "OpenRouter returned an empty completion." }, { status: 502 });
    }

    return Response.json({ prompt: beautified, model, strength, language });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Beautify request failed" },
      { status: 502 },
    );
  }
}

// OpenRouter names look like "Google: Gemini 3.5 Flash" — drop the "Provider: " prefix.
function stripProvider(name: string): string {
  const i = name.indexOf(": ");
  return i >= 0 ? name.slice(i + 2) : name;
}

// Fallback when the models list is unreachable: "google/gemini-3.5-flash" → "Gemini 3.5 Flash".
function prettyModel(slug: string): string {
  const tail = slug.split("/").pop() ?? slug;
  return tail
    .split("-")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Resolves the configured model's human-readable name (the client doesn't know the env slug).
// Also reports whether the beautifier is configured at all (key present). Key stays server-side.
export async function GET() {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  // systemPrompt is not secret — exposed so the UI can show it in a tooltip, always in sync.
  const base = { model, name: prettyModel(model), systemPrompt: SYSTEM_PROMPT };
  if (!key) return Response.json({ ...base, available: false });

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      next: { revalidate: 3600 }, // model list changes rarely; cache for an hour
    });
    if (!res.ok) return Response.json({ ...base, available: true });
    const data = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const found = data.data?.find((m) => m.id === model);
    return Response.json({ ...base, available: true, name: found?.name ? stripProvider(found.name) : base.name });
  } catch {
    return Response.json({ ...base, available: true });
  }
}
