"use client";

import { memo, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          void navigator.clipboard.writeText(getText());
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="absolute right-2 top-2 rounded-md border border-neutral-700 bg-neutral-800/80 px-2 py-0.5 text-[11px] font-medium text-neutral-200 opacity-0 transition hover:bg-neutral-700 group-hover:opacity-100"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Recursively flatten a react-markdown <pre> subtree into raw code text. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    return textOf((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function Pre({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900 text-neutral-100">
      <CopyButton getText={() => textOf(children)} />
      <pre {...props}>{children}</pre>
    </div>
  );
}

function ChatMarkdownInner({ content }: { content: string }) {
  return (
    <div className="chat-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{ pre: Pre }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Memoize so streaming a long reply doesn't re-render already-settled messages.
export const ChatMarkdown = memo(ChatMarkdownInner);
