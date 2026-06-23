"use client";

import { useCallback, useEffect, useState } from "react";

/** Simple URL-based lightbox for reference / attachment images (no metadata). */
export function ImageLightbox({
  urls,
  index,
  onIndex,
  onClose,
}: {
  urls: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const len = urls.length;
  const go = useCallback((i: number) => onIndex(((i % len) + len) % len), [len, onIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, onClose]);

  const cur = urls[index];
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div className="flex items-center justify-end gap-3 p-3 text-sm text-white" onClick={stop}>
        {len > 1 && <span className="text-white/70">{index + 1} / {len}</span>}
        <a href={cur} target="_blank" rel="noreferrer" className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/20">
          open
        </a>
        <button type="button" onClick={onClose} className="rounded-md bg-white/10 px-2 py-1 hover:bg-white/20" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-12" onClick={stop}>
        {len > 1 && (
          <button
            type="button"
            onClick={() => go(index - 1)}
            className="absolute left-2 flex size-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
            aria-label="Previous"
          >
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cur} alt="image" className="max-h-full max-w-full object-contain" />
        {len > 1 && (
          <button
            type="button"
            onClick={() => go(index + 1)}
            className="absolute right-2 flex size-11 items-center justify-center rounded-full bg-white/10 text-2xl text-white hover:bg-white/20"
            aria-label="Next"
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
}

/** State + open/close helpers for ImageLightbox. */
export function useImageLightbox() {
  const [state, setState] = useState<{ urls: string[]; index: number } | null>(null);
  const open = useCallback((urls: string[], index = 0) => setState({ urls, index }), []);
  const node = state ? (
    <ImageLightbox
      urls={state.urls}
      index={state.index}
      onIndex={(i) => setState((s) => (s ? { ...s, index: i } : s))}
      onClose={() => setState(null)}
    />
  ) : null;
  return { open, node };
}
