"use client";

import type { LivePrice } from "./models";

/** Fetch current Fal pricing for the given endpoint ids via our proxy route. */
export async function fetchLivePrices(
  key: string,
  endpointIds: string[],
): Promise<Record<string, LivePrice>> {
  const res = await fetch("/api/pricing", {
    method: "POST",
    headers: { "content-type": "application/json", "x-fal-key": key },
    body: JSON.stringify({ endpointIds }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Pricing fetch failed (${res.status})`);

  const map: Record<string, LivePrice> = {};
  for (const p of data.prices ?? []) {
    if (p?.endpoint_id) {
      map[p.endpoint_id] = { unit_price: p.unit_price, unit: p.unit, currency: p.currency };
    }
  }
  return map;
}
