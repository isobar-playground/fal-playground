"use client";

// Grid Split — standalone PoC tool, independent from the Maszynka Video
// pipeline's own grid/crop machinery (lib/maszynka-video/crop.ts). Upload any
// image containing an unknown-size grid of sub-images (2x2, 3x3, 4x4, ...)
// and it's split into individual crops entirely in the browser via OpenCV.js
// (see lib/gridSplit/gridSplit.ts) — no server round-trip, no upload. The
// ~13MB OpenCV WASM runtime is fetched lazily on first use, not bundled.

import { useCallback, useEffect, useRef, useState } from "react";
import { detectGrid, type GridCell, type GridResult } from "@/lib/gridSplit/gridSplit";
import { createZip } from "@/lib/gridSplit/zip";
import { useImageLightbox } from "./ImageLightbox";

type CellPreview = GridCell & { url: string; blob: Blob };

function DownloadIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-4 ${className}`}
      aria-hidden
    >
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load the image"));
    img.src = url;
  });
}

export default function GridSplitView() {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GridResult | null>(null);
  const [previews, setPreviews] = useState<CellPreview[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Latest object-URL values, kept outside React state so they can be
  // revoked as a side effect (in processFile, and on unmount below)
  // without reaching into a state updater -- updaters must stay pure.
  const sourceUrlRef = useRef<string | null>(null);
  const previewsRef = useRef<CellPreview[]>([]);

  useEffect(() => {
    return () => {
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      previewsRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, []);

  const processFile = useCallback(async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    previewsRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    previewsRef.current = [];
    setPreviews([]);

    try {
      const url = URL.createObjectURL(file);
      if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
      sourceUrlRef.current = url;
      setSourceUrl(url);

      const img = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D context unavailable");
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const detected = await detectGrid(imageData);
      setResult(detected);

      const nonEmpty = detected.cells.filter((c) => !c.isEmpty);
      const built = await Promise.all(
        nonEmpty.map(async (cell) => {
          const cellCanvas = document.createElement("canvas");
          cellCanvas.width = cell.width;
          cellCanvas.height = cell.height;
          cellCanvas
            .getContext("2d")!
            .drawImage(canvas, cell.x, cell.y, cell.width, cell.height, 0, 0, cell.width, cell.height);
          const blob = await new Promise<Blob>((resolve, reject) =>
            cellCanvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas produced no blob"))), "image/png"),
          );
          return { ...cell, url: URL.createObjectURL(blob), blob };
        }),
      );
      previewsRef.current = built;
      setPreviews(built);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process the image");
    } finally {
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void processFile(file);
    },
    [processFile],
  );

  const onFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void processFile(file);
      e.target.value = "";
    },
    [processFile],
  );

  const skipped = result ? result.cells.length - previews.length : 0;
  const lightbox = useImageLightbox();
  const [zipping, setZipping] = useState(false);

  const downloadAllAsZip = useCallback(async () => {
    if (previews.length === 0) return;
    setZipping(true);
    try {
      const entries = await Promise.all(
        previews.map(async (cell) => ({
          name: `cell_r${cell.row}_c${cell.col}.png`,
          data: new Uint8Array(await cell.blob.arrayBuffer()),
        })),
      );
      const zipBlob = createZip(entries);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "grid-split-cells.zip";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  }, [previews]);

  return (
    <div className="mx-auto max-w-4xl">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-800">Grid Split</h2>
        <p className="mt-1 text-sm text-neutral-500">
          Drop an image containing a grid of sub-images (2x2, 3x3, 4x4, ... — any size, no
          layout config needed) and it&apos;s split into individual crops in your browser.
          Near-blank/placeholder cells are detected by color uniformity and skipped
          automatically.
        </p>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition ${
            dragOver ? "border-amber-400 bg-amber-50" : "border-neutral-300 hover:bg-neutral-50"
          }`}
        >
          <input type="file" accept="image/*" className="sr-only" onChange={onFileInputChange} />
          <p className="text-sm text-neutral-600">
            {busy ? "Processing… (first run also loads the OpenCV engine, ~13MB)" : "Click or drop a grid image here"}
          </p>
        </label>

        {error && (
          <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        {sourceUrl && (
          <div className="mt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sourceUrl} alt="Source grid" className="max-h-80 w-full rounded-lg border border-neutral-200 object-contain" />
          </div>
        )}
      </section>

      {result && (
        <section className="mt-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-neutral-100 px-3 py-1 font-medium text-neutral-700">
              {result.method}
            </span>
            <span className="text-neutral-500">confidence {result.confidence.toFixed(2)}</span>
            <span className="text-neutral-500">
              {result.rows}×{result.cols} grid ({result.cells.length} candidate cells)
            </span>
            {skipped > 0 && (
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-neutral-500">
                {skipped} skipped (near-empty)
              </span>
            )}
            {previews.length > 0 && (
              <button
                type="button"
                onClick={() => void downloadAllAsZip()}
                disabled={zipping}
                className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <DownloadIcon className="text-neutral-500" />
                {zipping ? "Zipping…" : "Download all as ZIP"}
              </button>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {previews.map((cell, i) => (
              <div
                key={`${cell.row}-${cell.col}`}
                className="group relative rounded-xl border border-neutral-200 p-2 hover:border-amber-300"
              >
                <button
                  type="button"
                  onClick={() => lightbox.open(previews.map((p) => p.url), i)}
                  className="block w-full"
                  title="Click to preview"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cell.url} alt={`r${cell.row} c${cell.col}`} className="w-full rounded-lg" />
                </button>
                <a
                  href={cell.url}
                  download={`cell_r${cell.row}_c${cell.col}.png`}
                  title="Download"
                  className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
                >
                  <DownloadIcon />
                </a>
                <p className="mt-1 text-center text-xs text-neutral-500">
                  r{cell.row}c{cell.col} · {cell.width}×{cell.height} · std {cell.stdDev.toFixed(0)}
                </p>
              </div>
            ))}
          </div>

          {previews.length === 0 && (
            <p className="mt-3 text-sm text-neutral-500">No non-empty cells detected.</p>
          )}
        </section>
      )}

      {lightbox.node}
    </div>
  );
}
