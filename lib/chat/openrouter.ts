// OpenRouter request building + SSE parsing. Pure, framework-free helpers so the
// body builder and the delta parser can be unit-tested without React or network
// (see PRD "Testing Decisions"). The React layer calls streamChat() which wires
// these to a fetch against our /api/chat proxy.

import type { ChatMessage, ChatParams, ChatUsage, Conversation } from "./store";
import { modelSupportsReasoning } from "./models";

/** A wire message in the OpenRouter chat-completions payload. */
export interface WireMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  model: string;
  messages: WireMessage[];
  temperature: number;
  max_tokens: number;
  top_p: number;
  stream: boolean;
  /** Enables OpenRouter native usage accounting so the final chunk carries cost. */
  usage: { include: true };
  /** Reasoning effort; present only for reasoning-capable models with effort != off. */
  reasoning?: { effort: "low" | "medium" | "high" };
}

/**
 * Build the exact OpenRouter chat-completions body for a conversation.
 * System prompt (when set) is prepended, then the full prior turns, then the new
 * user turn. Pass `extraUserMessage` for the message just typed (not yet stored).
 */
export function buildChatBody(
  conversation: Pick<Conversation, "model" | "systemPrompt" | "params" | "messages">,
  opts: { stream: boolean; extraUserMessage?: string; overrideMessages?: ChatMessage[] } = { stream: true },
): ChatRequestBody {
  const turns = opts.overrideMessages ?? conversation.messages;
  const messages: WireMessage[] = [];
  if (conversation.systemPrompt.trim()) {
    messages.push({ role: "system", content: conversation.systemPrompt });
  }
  for (const m of turns) {
    // Skip empty/errored placeholder assistant turns so we never send blank content.
    if (m.role === "assistant" && !m.content.trim()) continue;
    messages.push({ role: m.role, content: m.content });
  }
  if (opts.extraUserMessage != null) {
    messages.push({ role: "user", content: opts.extraUserMessage });
  }
  const body: ChatRequestBody = {
    model: conversation.model,
    messages,
    temperature: conversation.params.temperature,
    max_tokens: conversation.params.max_tokens,
    top_p: conversation.params.top_p,
    stream: opts.stream,
    usage: { include: true },
  };
  const effort = conversation.params.reasoningEffort;
  if (effort && effort !== "off" && modelSupportsReasoning(conversation.model)) {
    body.reasoning = { effort };
  }
  return body;
}

/** Body for the one-shot, non-streaming auto-title request. */
export function buildTitleBody(model: string, firstUser: string, firstAssistant: string): ChatRequestBody {
  return {
    model,
    messages: [
      {
        role: "system",
        content:
          "You write a short conversation title. Reply with ONLY a concise title of at most 6 words. No quotes, no punctuation at the end, no preamble.",
      },
      {
        role: "user",
        content: `User: ${firstUser}\n\nAssistant: ${firstAssistant}\n\nTitle:`,
      },
    ],
    temperature: 0.3,
    max_tokens: 24,
    top_p: 1,
    stream: false,
    usage: { include: true },
  };
}

// --- SSE parsing --------------------------------------------------------

export interface ParsedDelta {
  /** A content delta to append, if this chunk carried one. */
  content?: string;
  /** A reasoning/thinking delta to append, if this chunk carried one. */
  reasoning?: string;
  /** The terminal usage payload, present on the final accounting chunk. */
  usage?: ChatUsage;
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

function normalizeUsage(u: RawUsage | undefined): ChatUsage | undefined {
  if (!u) return undefined;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    totalTokens: u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
    costUsd: typeof u.cost === "number" ? u.cost : 0,
  };
}

/**
 * Parse one SSE `data:` payload to a JSON object. Returns null for keep-alives,
 * the `[DONE]` sentinel, or anything unparseable.
 */
export function parseSSEChunk(data: string): unknown | null {
  const trimmed = data.trim();
  if (!trimmed || trimmed === "[DONE]") return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Extract a content/usage delta from an already-parsed chunk. OpenRouter sends
 * OpenAI-shaped chunks: choices[0].delta.content for text, and a terminal chunk
 * with `usage`. Returns null when the chunk carries neither.
 */
export function deltaFromChunk(json: unknown): ParsedDelta | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as {
    choices?: { delta?: { content?: string; reasoning?: string }; message?: { content?: string } }[];
    usage?: RawUsage;
  };
  const out: ParsedDelta = {};
  const content = obj.choices?.[0]?.delta?.content ?? obj.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.length) out.content = content;
  const reasoning = obj.choices?.[0]?.delta?.reasoning;
  if (typeof reasoning === "string" && reasoning.length) out.reasoning = reasoning;
  const usage = normalizeUsage(obj.usage);
  if (usage) out.usage = usage;
  if (out.content == null && out.reasoning == null && out.usage == null) return null;
  return out;
}

/** Parse one SSE `data:` payload directly into a delta (parse + extract). */
export function parseSSEData(data: string): ParsedDelta | null {
  const json = parseSSEChunk(data);
  return json == null ? null : deltaFromChunk(json);
}

/**
 * A non-streaming-shaped response reassembled from the streamed chunks, so the UI
 * can show "the JSON OpenRouter returned" next to the bubble. Content is the
 * concatenation of all deltas; `usage` is the raw terminal usage object verbatim.
 */
export interface AssembledResponse {
  id?: string;
  model?: string;
  provider?: string;
  created?: number;
  choices: {
    index: number;
    finish_reason: string | null;
    message: { role: "assistant"; content: string; reasoning?: string };
  }[];
  usage?: unknown;
}

export function assembleResponse(chunks: unknown[]): AssembledResponse {
  let content = "";
  let reasoning = "";
  let id: string | undefined;
  let model: string | undefined;
  let provider: string | undefined;
  let created: number | undefined;
  let finishReason: string | null = null;
  let usage: unknown;
  for (const ch of chunks) {
    const o = ch as {
      id?: string;
      model?: string;
      provider?: string;
      created?: number;
      choices?: {
        delta?: { content?: string; reasoning?: string };
        message?: { content?: string };
        finish_reason?: string | null;
      }[];
      usage?: unknown;
    };
    if (o.id) id = o.id;
    if (o.model) model = o.model;
    if (o.provider) provider = o.provider;
    if (typeof o.created === "number") created = o.created;
    const c = o.choices?.[0];
    const piece = c?.delta?.content ?? c?.message?.content;
    if (typeof piece === "string") content += piece;
    if (typeof c?.delta?.reasoning === "string") reasoning += c.delta.reasoning;
    if (c?.finish_reason) finishReason = c.finish_reason;
    if (o.usage) usage = o.usage;
  }
  return {
    id,
    model,
    provider,
    created,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: { role: "assistant", content, ...(reasoning ? { reasoning } : {}) },
      },
    ],
    usage,
  };
}

/**
 * Turn a raw SSE text stream into a sequence of `data:` payload strings.
 * Buffers partial lines across chunks. Yields the payload after `data:`.
 */
export async function* sseEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
      }
    }
    // Flush any trailing buffered line.
    const last = buffer.trim();
    if (last.startsWith("data:")) yield last.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

// --- client streaming helper -------------------------------------------

export interface StreamCallbacks {
  onDelta: (content: string) => void;
  onReasoning?: (reasoning: string) => void;
  onUsage: (usage: ChatUsage) => void;
}

export class ChatError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ChatError";
  }
}

/** Human-readable hint for the common OpenRouter rejection statuses. */
export function errorHint(status: number, fallback: string): string {
  switch (status) {
    case 401:
      return "Invalid or missing OpenRouter key. Check the key field above.";
    case 402:
      return "Out of OpenRouter credits. Add funds to your account.";
    case 429:
      return "Rate limited by OpenRouter. Wait a moment and try again.";
    default:
      return fallback || `Request failed (${status}).`;
  }
}

/**
 * POST the body to our /api/chat proxy and stream the reply. Calls onDelta as
 * content arrives and onUsage with the terminal accounting chunk. Throws ChatError
 * on a non-OK response (the proxy surfaces OpenRouter's status). Aborting the
 * signal stops the stream; the caller finalizes the partial message.
 */
export async function streamChat(
  key: string,
  body: ChatRequestBody,
  cb: StreamCallbacks,
  signal?: AbortSignal,
): Promise<AssembledResponse> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-openrouter-key": key },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data?.error?.message ?? data?.error ?? data?.message ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new ChatError(res.status, errorHint(res.status, detail));
  }

  const chunks: unknown[] = [];
  for await (const data of sseEvents(res.body)) {
    const json = parseSSEChunk(data);
    if (!json) continue;
    chunks.push(json);
    const parsed = deltaFromChunk(json);
    if (!parsed) continue;
    if (parsed.content) cb.onDelta(parsed.content);
    if (parsed.reasoning) cb.onReasoning?.(parsed.reasoning);
    if (parsed.usage) cb.onUsage(parsed.usage);
  }
  return assembleResponse(chunks);
}

/** One-shot non-streaming completion (used for auto-title). Returns trimmed text. */
export async function completeChat(key: string, body: ChatRequestBody): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-openrouter-key": key },
    body: JSON.stringify({ ...body, stream: false }),
  });
  if (!res.ok) throw new ChatError(res.status, errorHint(res.status, ""));
  const data = await res.json();
  const content: unknown = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}
