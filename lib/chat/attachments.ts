// Attachment data shape + pure OpenRouter content-parts builder. No React, no I/O,
// so the wire logic is unit-testable at the module boundary (mirrors openrouter.ts /
// store.ts). Capability comes from models.ts; the UI gates the attach button on it
// and this builder drops anything the chosen model can't ingest.
//
// The one thing easy to get wrong: OpenRouter `content` is a plain string today.
// Attachments force the content-PARTS array form — so a turn with NO attachments
// must still serialize to a plain string (the existing path is untouched).

import { modelSupportsImages, modelSupportsFiles } from "./models";

// --- capability ---------------------------------------------------------

export interface ChatCaps {
  /** Accepts image_url content parts (vision). */
  image: boolean;
  /** Accepts file content parts (PDF input). */
  file: boolean;
}

export const capsFor = (model: string): ChatCaps => ({
  image: modelSupportsImages(model),
  file: modelSupportsFiles(model),
});

// --- attachment data shape ----------------------------------------------

/** Where the attachment came from. Drives whether we carry inline data or a URL. */
export type AttachmentSource = "upload" | "generated-image" | "generated-video";

export interface Attachment {
  id: string;
  name: string;
  /** MIME type, e.g. image/png, application/pdf, video/mp4. */
  mime: string;
  source: AttachmentSource;
  /** Inline base64 data URL — present for local uploads. */
  dataUrl?: string;
  /** Remote Fal URL — present for cross-module (generated) refs. */
  url?: string;
  bytes?: number;
}

/** How an attachment will be sent, derived from its MIME (not its source). */
export type AttKind = "image" | "file" | "video" | "unsupported";

export function kindOf(a: Attachment): AttKind {
  if (a.mime.startsWith("image/")) return "image";
  if (a.mime.startsWith("video/")) return "video";
  if (a.mime === "application/pdf") return "file";
  return "unsupported";
}

/** The URL we'd actually put on the wire: inline data for uploads, remote for refs. */
export const wireUrlOf = (a: Attachment): string | undefined => a.dataUrl ?? a.url;

// --- OpenRouter wire content parts --------------------------------------

export type WirePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

export type WireContent = string | WirePart[];

export interface BuiltContent {
  content: WireContent;
  /** Attachments that could not be sent to this model — surfaced to the user. */
  dropped: { att: Attachment; reason: string }[];
}

/**
 * Build the `content` for one user turn given the chosen model's caps.
 *   - No attachments → plain string (existing path untouched).
 *   - image → image_url part, only if caps.image. Else dropped.
 *   - file  → file part, only if caps.file. Else dropped.
 *   - video → NEVER an image part (no vision model watches video). If it has a URL,
 *     inline a markdown link in the text so the model sees the reference; else dropped.
 *   - anything with no usable URL → dropped.
 */
export function buildUserContent(
  text: string,
  attachments: Attachment[],
  caps: ChatCaps,
): BuiltContent {
  const dropped: BuiltContent["dropped"] = [];
  const mediaParts: WirePart[] = [];
  const videoLinks: string[] = [];

  for (const a of attachments) {
    const url = wireUrlOf(a);
    const kind = kindOf(a);
    if (!url) {
      dropped.push({ att: a, reason: "no URL / not uploaded yet" });
      continue;
    }
    if (kind === "image") {
      if (!caps.image) {
        dropped.push({ att: a, reason: "model has no image input" });
        continue;
      }
      mediaParts.push({ type: "image_url", image_url: { url } });
    } else if (kind === "file") {
      if (!caps.file) {
        dropped.push({ att: a, reason: "model has no file input" });
        continue;
      }
      mediaParts.push({ type: "file", file: { filename: a.name, file_data: url } });
    } else if (kind === "video") {
      // No multimodal chat model ingests video frames; pass it as a reference link.
      videoLinks.push(`[${a.name}](${url})`);
    } else {
      dropped.push({ att: a, reason: `unsupported type ${a.mime}` });
    }
  }

  const textWithLinks = videoLinks.length
    ? [text, "", "Attached video references:", ...videoLinks.map((l) => `- ${l}`)]
        .join("\n")
        .trim()
    : text;

  // Backward-compat: nothing to attach → keep content as a plain string.
  if (mediaParts.length === 0) {
    return { content: textWithLinks, dropped };
  }

  const parts: WirePart[] = [];
  if (textWithLinks) parts.push({ type: "text", text: textWithLinks });
  parts.push(...mediaParts);
  return { content: parts, dropped };
}
