"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  CHAT_MODELS,
  CHAT_MODEL_GROUPS,
  AUTO_TITLE_MODEL,
  chatModelLabel,
  modelSupportsReasoning,
} from "@/lib/chat/models";
import {
  appendMessage,
  getConversation,
  newConversation,
  newMessage,
  patchMessage,
  removeMessage,
  renameConversation,
  setConversationModel,
  setConversationParams,
  setConversationSystemPrompt,
  setConversationTitle,
  sortConversations,
  deleteConversation as deleteConv,
  addConversation,
  type ChatMessage,
  type ChatUsage,
  type Conversation,
  type ReasoningEffort,
} from "@/lib/chat/store";
import {
  buildChatBody,
  buildTitleBody,
  ChatError,
  completeChat,
  streamChat,
} from "@/lib/chat/openrouter";
import { ChatMarkdown } from "./chat/Markdown";

// --- formatting ---------------------------------------------------------

function fmtCost(n: number): string {
  if (!n) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}
const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

interface OpenRouterCredits {
  balance: number;
  currency: string;
}

// =======================================================================

export default function ChatView({
  orKey,
  setOrKey,
  conversations,
  setConversations,
}: {
  orKey: string;
  setOrKey: Dispatch<SetStateAction<string>>;
  conversations: Conversation[];
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
}) {
  const [showKey, setShowKey] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [credits, setCredits] = useState<OpenRouterCredits | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => sortConversations(conversations), [conversations]);
  const active = getConversation(conversations, activeId);

  // Keep an active conversation selected; pick the most recent on mount/changes.
  useEffect(() => {
    if (activeId && conversations.some((c) => c.id === activeId)) return;
    setActiveId(sorted[0]?.id ?? null);
  }, [activeId, conversations, sorted]);

  // --- balance ----------------------------------------------------------
  const refreshCredits = useCallback(() => {
    if (!orKey) {
      setCredits(null);
      return;
    }
    fetch("/api/credits/openrouter", { headers: { "x-openrouter-key": orKey } })
      .then((r) => r.json())
      .then((d) => setCredits(d?.available ? { balance: d.balance, currency: d.currency ?? "USD" } : null))
      .catch(() => setCredits(null));
  }, [orKey]);
  useEffect(() => {
    refreshCredits();
  }, [refreshCredits]);

  // --- autoscroll while streaming --------------------------------------
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages, streaming]);

  // --- conversation actions --------------------------------------------
  const ensureConversation = useCallback((): Conversation => {
    if (active) return active;
    const conv = newConversation();
    setConversations((list) => addConversation(list, conv));
    setActiveId(conv.id);
    return conv;
  }, [active, setConversations]);

  const startNew = useCallback(() => {
    const conv = newConversation();
    setConversations((list) => addConversation(list, conv));
    setActiveId(conv.id);
    setDraft("");
    setShowSettings(false);
  }, [setConversations]);

  const handleDelete = useCallback(
    (id: string) => {
      if (!confirm("Delete this conversation?")) return;
      setConversations((list) => deleteConv(list, id));
      if (id === activeId) setActiveId(null);
    },
    [activeId, setConversations],
  );

  const handleRename = useCallback(
    (id: string, current: string) => {
      const next = prompt("Rename conversation", current);
      if (next != null) setConversations((list) => renameConversation(list, id, next));
    },
    [setConversations],
  );

  // --- auto-title -------------------------------------------------------
  const maybeAutoTitle = useCallback(
    async (conversationId: string, firstUser: string, firstAssistant: string) => {
      try {
        const title = await completeChat(orKey, buildTitleBody(AUTO_TITLE_MODEL, firstUser, firstAssistant));
        const clean = title.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
        if (clean) setConversations((list) => setConversationTitle(list, conversationId, clean));
      } catch {
        /* titling is best-effort; leave the default title on failure */
      }
    },
    [orKey, setConversations],
  );

  // --- send / regenerate ------------------------------------------------
  const runTurn = useCallback(
    async (conversation: Conversation, priorMessages: ChatMessage[]) => {
      const assistant = newMessage("assistant", "");
      setConversations((list) => appendMessage(list, conversation.id, assistant));
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      let acc = "";
      let accReason = "";
      let usage: ChatUsage | undefined;
      try {
        const body = buildChatBody(
          { ...conversation, messages: priorMessages },
          { stream: true },
        );
        // Stash the exact request immediately so it's inspectable even if the turn errors.
        setConversations((list) => patchMessage(list, conversation.id, assistant.id, { request: body }));
        const response = await streamChat(
          orKey,
          body,
          {
            onDelta: (delta) => {
              acc += delta;
              setConversations((list) => patchMessage(list, conversation.id, assistant.id, { content: acc }));
            },
            onReasoning: (delta) => {
              accReason += delta;
              setConversations((list) =>
                patchMessage(list, conversation.id, assistant.id, { reasoning: accReason }),
              );
            },
            onUsage: (u) => {
              usage = u;
            },
          },
          controller.signal,
        );
        setConversations((list) =>
          patchMessage(list, conversation.id, assistant.id, { ...(usage ? { usage } : {}), response }),
        );
        // Auto-title once: first exchange completed and still on the default title.
        const isFirstExchange = priorMessages.filter((m) => m.role === "user").length === 1;
        if (isFirstExchange && conversation.title === "New chat" && acc.trim()) {
          const firstUser = priorMessages.find((m) => m.role === "user")?.content ?? "";
          await maybeAutoTitle(conversation.id, firstUser, acc);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          // Aborted: keep the partial content as-is (finalized below in finally).
        } else {
          const message = e instanceof ChatError ? e.message : e instanceof Error ? e.message : "Request failed.";
          setConversations((list) =>
            patchMessage(list, conversation.id, assistant.id, {
              error: message,
              content: acc,
            }),
          );
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        refreshCredits();
      }
    },
    [orKey, maybeAutoTitle, refreshCredits, setConversations],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !orKey || streaming) return;
    const conv = ensureConversation();
    const userMsg = newMessage("user", text);
    setConversations((list) => appendMessage(list, conv.id, userMsg));
    setDraft("");
    await runTurn(conv, [...conv.messages, userMsg]);
  }, [draft, orKey, streaming, ensureConversation, setConversations, runTurn]);

  const regenerate = useCallback(async () => {
    if (!active || streaming || !orKey) return;
    const msgs = active.messages;
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    // Drop the last assistant turn and re-run from the prior user context.
    const prior = msgs.slice(0, msgs.findIndex((m) => m.id === lastAssistant.id));
    setConversations((list) => removeMessage(list, active.id, lastAssistant.id));
    await runTurn({ ...active, messages: prior }, prior);
  }, [active, streaming, orKey, setConversations, runTurn]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const lastMessage = active?.messages[active.messages.length - 1];
  const canRegenerate = Boolean(active && lastMessage?.role === "assistant" && !streaming);

  // --- render -----------------------------------------------------------
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* OpenRouter key + balance header */}
      <div className="border-b border-neutral-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <label className="shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-400">
              OpenRouter key
            </label>
            <input
              type={showKey ? "text" : "password"}
              value={orKey}
              onChange={(e) => setOrKey(e.target.value)}
              placeholder="sk-or-v1-…"
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 font-mono text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="shrink-0 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              {showKey ? "Hide" : "Show"}
            </button>
            {orKey && <span className="shrink-0 text-xs font-medium text-green-600">● set</span>}
          </div>
          {credits && (
            <div className="flex shrink-0 flex-col justify-center rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-1.5 text-right">
              <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                OpenRouter balance
              </span>
              <span className="text-base font-semibold leading-tight text-neutral-800">
                {fmtCost(credits.balance)}
              </span>
            </div>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-5xl text-xs text-neutral-500">
          Stored in your browser, sent only to OpenRouter via this app. Get it from the{" "}
          <a
            className="text-amber-600 underline"
            href="https://openrouter.ai/settings/keys"
            target="_blank"
            rel="noreferrer"
          >
            OpenRouter dashboard → Keys
          </a>
          .
        </p>
      </div>

      {/* Sidebar + thread */}
      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="flex w-64 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
            <div className="flex items-center gap-2 p-3">
              <button
                type="button"
                onClick={startNew}
                className="flex-1 rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-300"
              >
                + New chat
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                title="Collapse sidebar"
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm text-neutral-500 hover:bg-neutral-100"
              >
                «
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {sorted.length === 0 && (
                <p className="px-2 py-3 text-xs text-neutral-400">No conversations yet.</p>
              )}
              {sorted.map((c) => (
                <div
                  key={c.id}
                  className={`group mb-1 flex items-center gap-1 rounded-lg px-2 py-2 text-sm transition ${
                    c.id === activeId ? "bg-amber-100 text-amber-950" : "text-neutral-700 hover:bg-neutral-100"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className="min-w-0 flex-1 truncate text-left"
                    title={c.title}
                  >
                    {c.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRename(c.id, c.title)}
                    title="Rename"
                    className="shrink-0 px-1 text-neutral-400 opacity-0 hover:text-neutral-700 group-hover:opacity-100"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    title="Delete"
                    className="shrink-0 px-1 text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* Thread + composer */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Conversation toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 bg-white px-4 py-2">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                title="Show conversations"
                className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100"
              >
                »
              </button>
            )}
            <select
              value={active?.model ?? CHAT_MODELS[0].id}
              onChange={(e) => {
                const conv = ensureConversation();
                const model = e.target.value;
                setConversations((list) => setConversationModel(list, conv.id, model));
              }}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-400"
            >
              {CHAT_MODEL_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {CHAT_MODELS.filter((m) => m.group === group).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowSettings((s) => !s)}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              {showSettings ? "Hide settings" : "System & params"}
            </button>
            <div className="ml-auto text-xs text-neutral-500">
              {active && active.costTotalUsd > 0 && (
                <span title="Total cost of this conversation">
                  Conversation total: <b>{fmtCost(active.costTotalUsd)}</b>
                </span>
              )}
            </div>
          </div>

          {/* Settings panel */}
          {showSettings && active && (
            <SettingsPanel
              conversation={active}
              onSystemPrompt={(v) => setConversations((list) => setConversationSystemPrompt(list, active.id, v))}
              onParam={(patch) => setConversations((list) => setConversationParams(list, active.id, patch))}
            />
          )}

          {/* Message thread */}
          <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl px-4 py-6">
              {!active || active.messages.length === 0 ? (
                <EmptyState hasKey={Boolean(orKey)} />
              ) : (
                active.messages.map((m) => (
                  <MessageBubble key={m.id} message={m} streaming={streaming} />
                ))
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="border-t border-neutral-200 bg-white px-4 py-3">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  disabled={!orKey}
                  placeholder={orKey ? "Message… (Enter to send, Shift+Enter for newline)" : "Enter your OpenRouter key above to start chatting"}
                  className="max-h-48 min-h-[2.75rem] flex-1 resize-y rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400"
                />
                {streaming ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="rounded-xl border border-red-300 bg-white px-5 py-2.5 font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={!orKey || !draft.trim()}
                    className="rounded-xl bg-amber-400 px-5 py-2.5 font-semibold text-amber-950 shadow-sm transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                  >
                    Send
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-neutral-400">
                <span>{active ? chatModelLabel(active.model) : ""}</span>
                {canRegenerate && (
                  <button
                    type="button"
                    onClick={() => void regenerate()}
                    className="text-neutral-500 underline hover:text-amber-700"
                  >
                    ↻ Regenerate last reply
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- sub-components -----------------------------------------------------

function EmptyState({ hasKey }: { hasKey: boolean }) {
  return (
    <div className="mt-16 text-center text-sm text-neutral-400">
      {hasKey ? (
        <>
          <p className="text-base font-medium text-neutral-500">Start a conversation</p>
          <p className="mt-1">Pick a model above and type a message below.</p>
        </>
      ) : (
        <>
          <p className="text-base font-medium text-neutral-500">Enter your OpenRouter key to begin</p>
          <p className="mt-1">The composer unlocks once a key is set.</p>
        </>
      )}
    </div>
  );
}

function MessageBubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const isUser = message.role === "user";
  const isEmptyStreaming = !isUser && !message.content && !message.reasoning && !message.error;
  const [showJson, setShowJson] = useState(false);
  const hasJson = message.request != null || message.response != null;
  return (
    <div className={`mb-5 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${isUser ? "" : "w-full"}`}>
        <div
          className={
            isUser
              ? "whitespace-pre-wrap rounded-2xl bg-amber-100 px-4 py-2.5 text-sm text-amber-950"
              : "rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-neutral-800"
          }
        >
          {isUser ? (
            message.content
          ) : isEmptyStreaming ? (
            <span className="inline-flex gap-1 text-neutral-400">
              <span className="animate-pulse">●</span>
              <span className="animate-pulse [animation-delay:150ms]">●</span>
              <span className="animate-pulse [animation-delay:300ms]">●</span>
            </span>
          ) : (
            <>
              {message.reasoning && (
                <div className="mb-2 whitespace-pre-wrap text-[13px] italic leading-relaxed text-neutral-400">
                  {message.reasoning}
                </div>
              )}
              {message.content && <ChatMarkdown content={message.content} />}
            </>
          )}
        </div>
        {message.error && (
          <p className="mt-1 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600">{message.error}</p>
        )}
        {!streaming && (message.usage || hasJson) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-neutral-400">
            {message.usage && (
              <span>
                {fmtTokens(message.usage.totalTokens)} tokens · {fmtCost(message.usage.costUsd)}
                <span className="text-neutral-300">
                  {" "}
                  ({fmtTokens(message.usage.promptTokens)} in / {fmtTokens(message.usage.completionTokens)} out)
                </span>
              </span>
            )}
            {hasJson && (
              <button
                type="button"
                onClick={() => setShowJson((s) => !s)}
                className="font-mono underline hover:text-neutral-700"
              >
                {showJson ? "hide JSON" : "{ } JSON"}
              </button>
            )}
          </div>
        )}
        {showJson && hasJson && (
          <div className="mt-2 space-y-2">
            <JsonBlock title="Request → OpenRouter" value={message.request} />
            <JsonBlock title="Response ← OpenRouter" value={message.response} />
          </div>
        )}
      </div>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  const text = useMemo(() => (value == null ? "" : JSON.stringify(value, null, 2)), [value]);
  if (value == null) return null;
  const copy = () => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{title}</span>
        <button type="button" onClick={copy} className="text-[11px] text-neutral-400 hover:text-neutral-700">
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-neutral-700">
        {text}
      </pre>
    </div>
  );
}

function SettingsPanel({
  conversation,
  onSystemPrompt,
  onParam,
}: {
  conversation: Conversation;
  onSystemPrompt: (v: string) => void;
  onParam: (patch: Partial<Conversation["params"]>) => void;
}) {
  return (
    <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-3">
      <div className="mx-auto max-w-3xl space-y-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
            System prompt
          </label>
          <textarea
            value={conversation.systemPrompt}
            onChange={(e) => onSystemPrompt(e.target.value)}
            rows={2}
            placeholder="e.g. You are a concise senior engineer."
            className="w-full resize-y rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <NumberField
            label="Temperature"
            value={conversation.params.temperature}
            step={0.1}
            min={0}
            max={2}
            onChange={(v) => onParam({ temperature: v })}
          />
          <NumberField
            label="Max tokens"
            value={conversation.params.max_tokens}
            step={256}
            min={1}
            max={200000}
            onChange={(v) => onParam({ max_tokens: Math.round(v) })}
          />
          <NumberField
            label="Top P"
            value={conversation.params.top_p}
            step={0.05}
            min={0}
            max={1}
            onChange={(v) => onParam({ top_p: v })}
          />
        </div>
        {modelSupportsReasoning(conversation.model) && (
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Reasoning effort
            </span>
            <select
              value={conversation.params.reasoningEffort ?? "off"}
              onChange={(e) => onParam({ reasoningEffort: e.target.value as ReasoningEffort })}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-400"
            >
              <option value="off">Off (model default)</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <span className="mt-1 block text-[11px] text-neutral-400">
              Higher effort = more thinking tokens (slower, pricier). Thinking shows in grey above the reply.
            </span>
          </label>
        )}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number.parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
      />
    </label>
  );
}
