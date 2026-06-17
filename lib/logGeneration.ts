export interface GenerationLog {
  kind: "image" | "video";
  /** The Fal model id the request was sent to. */
  model: string;
  /** Exact JSON sent to Fal (same object stored as `sentInput`). */
  input: unknown;
  /** Raw `result.data` Fal returned — present on success. */
  output?: unknown;
  /** Error message — present instead of `output` when the run failed. */
  error?: string;
}

export function logGeneration(log: GenerationLog): void {
  void fetch("/api/log-generation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...log, ts: new Date().toISOString() }),
    keepalive: true,
  }).catch(() => {});
}
