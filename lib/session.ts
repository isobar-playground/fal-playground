"use client";

import type { SessionExport } from "./types";

// UTF-8-safe base64 (handles non-ASCII prompts and large payloads without
// blowing the call stack). This is obfuscation, not encryption — anyone can decode it.

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export function encodeSession(data: SessionExport): string {
  return toBase64(JSON.stringify(data));
}

/** Decodes a session file. Accepts base64 or legacy plain JSON. Throws on garbage. */
export function decodeSession(text: string): Partial<SessionExport> {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t); // legacy plain-JSON export
  return JSON.parse(fromBase64(t));
}
