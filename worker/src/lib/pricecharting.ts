import type { Env } from '../types';
import { isPlausibleMarketValue } from './valuation';

const PC_BASE = 'https://www.pricecharting.com/api';

interface PCProduct {
  id: string;
  'product-name': string;
  'console-name': string;
}

interface PCPrice {
  id: string;
  'product-name'?: string;
  'new-price'?: number;
  'cib-price'?: number;
  'loose-price'?: number;
}

export interface PriceChartingResult {
  pc_id: string;
  new_value: number | null;
  complete_value: number | null;
}

// Fetch products matching the search query. Returns null on any network error.
async function searchPriceCharting(
  query: string,
  token: string,
): Promise<PCProduct[] | null> {
  try {
    const resp = await fetch(
      `${PC_BASE}/products?q=${encodeURIComponent(query)}&t=${token}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { status?: string; products?: PCProduct[] };
    return data.products ?? null;
  } catch {
    return null;
  }
}

// Fetch price data for a known PriceCharting product ID.
async function fetchPCPrice(pcId: string, token: string): Promise<PCPrice | null> {
  try {
    const resp = await fetch(
      `${PC_BASE}/product?id=${encodeURIComponent(pcId)}&t=${token}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!resp.ok) return null;
    return (await resp.json()) as PCPrice;
  } catch {
    return null;
  }
}

/**
 * Look up PriceCharting data for a LEGO set.
 *
 * Two-step when pc_id is unknown: search for the set number to discover the
 * PriceCharting product ID, then fetch its price. When pc_id is already stored,
 * skip the search and go directly to the price endpoint (no quota wasted).
 *
 * Prices from PriceCharting are sourced from aggregated eBay closed-auction data:
 *   "new-price"  → sealed / factory-new condition
 *   "cib-price"  → complete-in-box (opened but with box and manual)
 *
 * Returns null when the set is not in PriceCharting's catalog or on any error.
 */
export async function fetchPriceChartingData(
  setNum: string,
  setName: string,
  existingPcId: string | null | undefined,
  env: Env,
): Promise<PriceChartingResult | null> {
  const token = env.PRICECHARTING_TOKEN;
  if (!token) return null;

  let pcId = existingPcId ?? null;

  if (!pcId) {
    // Strip the Rebrickable suffix ("-1", "-2") so "42115-1" searches as "42115".
    const baseNum = setNum.replace(/-\d+$/, '');
    const products = await searchPriceCharting(`${baseNum} lego`, token);
    if (!products?.length) return null;

    // Filter to LEGO products; prefer one whose name contains the base set number.
    const legoProducts = products.filter(
      (p) => p['console-name']?.toLowerCase().includes('lego'),
    );
    if (!legoProducts.length) return null;

    const matched =
      legoProducts.find((p) => p['product-name']?.includes(baseNum)) ??
      legoProducts[0];
    pcId = matched.id;
  }

  const price = await fetchPCPrice(pcId, token);
  if (!price) return null;

  const rawNew = price['new-price'];
  const rawCib = price['cib-price'];

  // Prices are in cents — convert to USD. Treat 0 as absent (PC returns 0 for
  // conditions with no recent sales, not null).
  const newValue = rawNew && rawNew > 0 ? rawNew / 100 : null;
  const completeValue = rawCib && rawCib > 0 ? rawCib / 100 : null;

  // Plausibility gate: reject values that look like data errors.
  const filtered = {
    new_value: newValue && isPlausibleMarketValue(newValue, {}) ? newValue : null,
    complete_value: completeValue && isPlausibleMarketValue(completeValue, {}) ? completeValue : null,
  };

  return { pc_id: pcId, ...filtered };
}
