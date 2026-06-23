export interface ChatLog {
  /** Stable client conversation UUID — groups turns into a thread. */
  conversationId: string;
  /** Best-effort title snapshot; "New chat" on the first turn (auto-title runs after). */
  conversationTitle?: string;
  /** OpenRouter model id the turn was sent to. */
  model: string;
  /** Exact ChatRequestBody posted to OpenRouter (the "Request → OpenRouter" object). */
  request: unknown;
  /** Assembled response object — present on success, omitted on error. */
  response?: unknown;
  /** Error message — present instead of `response` when the turn failed. */
  error?: string;
}

// Replace inline base64 data URLs (uploaded image/PDF attachments) with a short
// placeholder so multi-MB blobs don't get persisted to Postgres. Remote URLs are
// left intact. ponytail: shrinks the payload; drop if you ever want the raw bytes logged.
const redactDataUrls = (s: string): string =>
  typeof s === "string" && s.startsWith("data:") ? `${s.slice(0, s.indexOf(",") + 1)}…[${s.length} chars]` : s;

export function logChat(log: ChatLog): void {
  // Normal fetch (NOT keepalive): chat payloads carry the full prior history and can
  // exceed the ~64KB keepalive cap, which fails silently. Fire-and-forget; never blocks UI
  // and a logging failure must never affect the chat.
  void fetch("/api/log-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(log, (_k, v) => redactDataUrls(v as string)),
  }).catch(() => {});
}
