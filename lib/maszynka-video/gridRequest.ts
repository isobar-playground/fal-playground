// Grid generation request helpers (issue #27). Pure on purpose: the view composes
// these around lib/models.ts's buildInput (the existing image-catalog request
// builder), so this module stays runnable under plain `node` for its check. The
// gridGenerationPayload is authored by the planner prompt, not by app code — the
// app only decides what becomes the FAL prompt string and how the operator's raw
// model parameters merge into the request.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The FAL prompt for a grid: the payload's own `prompt` when the planner emitted
 *  one, otherwise the whole payload serialized verbatim — the payload IS the grid
 *  instruction; the app never rewrites it. */
export function gridPromptFromPayload(payload: Record<string, unknown>): string {
  return typeof payload.prompt === "string" && payload.prompt.trim() !== "" ? payload.prompt : JSON.stringify(payload);
}

/** Parses the raw-model-parameters pass-through field. "" is a valid "no extras". */
export function parseRawParams(text: string): { params: Record<string, unknown>; error: string | null } {
  if (text.trim() === "") return { params: {}, error: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { params: {}, error: `Raw model parameters are not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isPlainObject(parsed)) return { params: {}, error: "Raw model parameters must be a JSON object." };
  return { params: parsed, error: null };
}

/** Raw params merge LAST — they are the operator's explicit override of anything
 *  the catalog builder produced (issue #27: "raw model parameters merge into the
 *  FAL request"). */
export function mergeRawParams(
  base: Record<string, unknown>,
  rawParams: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...rawParams };
}

/** Display label for the payload's canvasSize (issue #27: canvasSize is READ from
 *  the payload — display only; actual output size stays under the operator's raw
 *  params / model settings). Accepts {width,height} or a plain string. */
export function canvasSizeLabel(payload: Record<string, unknown>): string | null {
  const cs = payload.canvasSize;
  if (typeof cs === "string" && cs.trim() !== "") return cs;
  if (isPlainObject(cs) && typeof cs.width === "number" && typeof cs.height === "number") {
    return `${cs.width}×${cs.height}`;
  }
  return null;
}
