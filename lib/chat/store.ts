// Conversation data model + pure CRUD/derivations over the conversations array.
// No React, no network, no localStorage access here — the React layer holds the
// array in a useLocalStorage hook and delegates to these functions. This keeps
// the store unit-testable at the module boundary (see PRD "Testing Decisions").

import { DEFAULT_CHAT_MODEL } from "./models";

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Streamed reasoning / thinking text, when the model emits it (assistant turns). */
  reasoning?: string;
  /** Set on assistant messages once the stream's terminal usage arrives. */
  usage?: ChatUsage;
  /** Inline error text (e.g. OpenRouter 401/402) attached to an assistant turn. */
  error?: string;
  /** Exact request body posted to OpenRouter for this turn (assistant turns). */
  request?: unknown;
  /** Response object reassembled from the streamed chunks (assistant turns). */
  response?: unknown;
  ts: number;
}

/** "off" = omit the reasoning param (model default); otherwise the OpenRouter effort level. */
export type ReasoningEffort = "off" | "low" | "medium" | "high";

export interface ChatParams {
  temperature: number;
  max_tokens: number;
  top_p: number;
  /** Reasoning effort; sent only when not "off" and the model supports reasoning. */
  reasoningEffort: ReasoningEffort;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  /** Prepended as a system message at request time; not stored as a message. */
  systemPrompt: string;
  params: ChatParams;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  /** Sum of per-message costUsd (incl. the folded auto-title cost). */
  costTotalUsd: number;
}

export const DEFAULT_CHAT_PARAMS: ChatParams = {
  temperature: 1,
  max_tokens: 4096,
  top_p: 1,
  reasoningEffort: "off",
};

const uid = (): string =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

export const newMessage = (role: ChatMessage["role"], content: string): ChatMessage => ({
  id: uid(),
  role,
  content,
  ts: Date.now(),
});

export function newConversation(model: string = DEFAULT_CHAT_MODEL): Conversation {
  const now = Date.now();
  return {
    id: uid(),
    title: "New chat",
    model,
    systemPrompt: "",
    params: { ...DEFAULT_CHAT_PARAMS },
    messages: [],
    createdAt: now,
    updatedAt: now,
    costTotalUsd: 0,
  };
}

/** Most-recent-first ordering, derived from updatedAt. */
export const sortConversations = (list: Conversation[]): Conversation[] =>
  [...list].sort((a, b) => b.updatedAt - a.updatedAt);

const recomputeTotal = (c: Conversation): number =>
  c.messages.reduce((sum, m) => sum + (m.usage?.costUsd ?? 0), 0);

/** Apply a patch to one conversation, bump updatedAt, and recompute the cost total. */
function updateConversation(
  list: Conversation[],
  id: string,
  patch: (c: Conversation) => Conversation,
): Conversation[] {
  return list.map((c) => {
    if (c.id !== id) return c;
    const next = patch(c);
    return { ...next, updatedAt: Date.now(), costTotalUsd: recomputeTotal(next) };
  });
}

export const addConversation = (list: Conversation[], c: Conversation): Conversation[] => [c, ...list];

export const deleteConversation = (list: Conversation[], id: string): Conversation[] =>
  list.filter((c) => c.id !== id);

export const renameConversation = (list: Conversation[], id: string, title: string): Conversation[] =>
  updateConversation(list, id, (c) => ({ ...c, title: title.trim() || c.title }));

export const setConversationModel = (list: Conversation[], id: string, model: string): Conversation[] =>
  updateConversation(list, id, (c) => ({ ...c, model }));

export const setConversationSystemPrompt = (
  list: Conversation[],
  id: string,
  systemPrompt: string,
): Conversation[] => updateConversation(list, id, (c) => ({ ...c, systemPrompt }));

export const setConversationParams = (
  list: Conversation[],
  id: string,
  params: Partial<ChatParams>,
): Conversation[] =>
  updateConversation(list, id, (c) => ({ ...c, params: { ...c.params, ...params } }));

export const setConversationTitle = renameConversation;

export const appendMessage = (
  list: Conversation[],
  id: string,
  message: ChatMessage,
): Conversation[] => updateConversation(list, id, (c) => ({ ...c, messages: [...c.messages, message] }));

/** Patch a single message in a conversation (e.g. append a streamed delta, attach usage/error). */
export const patchMessage = (
  list: Conversation[],
  conversationId: string,
  messageId: string,
  patch: Partial<ChatMessage>,
): Conversation[] =>
  updateConversation(list, conversationId, (c) => ({
    ...c,
    messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
  }));

/** Remove a single message (used to drop the prior assistant turn before regenerate). */
export const removeMessage = (
  list: Conversation[],
  conversationId: string,
  messageId: string,
): Conversation[] =>
  updateConversation(list, conversationId, (c) => ({
    ...c,
    messages: c.messages.filter((m) => m.id !== messageId),
  }));

export const getConversation = (list: Conversation[], id: string | null): Conversation | undefined =>
  id == null ? undefined : list.find((c) => c.id === id);
