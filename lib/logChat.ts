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

export function logChat(log: ChatLog): void {
  // Normal fetch (NOT keepalive): chat payloads carry the full prior history and can
  // exceed the ~64KB keepalive cap, which fails silently. Fire-and-forget; never blocks UI
  // and a logging failure must never affect the chat.
  void fetch("/api/log-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(log),
  }).catch(() => {});
}
