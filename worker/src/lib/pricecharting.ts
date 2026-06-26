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
  'console-name'?: string;
  'new-price'?: number;
  'cib-price'?: number;
  'loose-price'?: number;
  'sales-volume'?: number;
}

export interface PriceChartingResult {
  pc_id: string;
  new_value: number | null;
  complete_value: number | null;
  // Loose = item only, without box/manual (a used-condition corroborator).
  loose_value: number | null;
  // Yearly units sold — a liquidity signal (how fast the set turns over).
  sales_volume: number | null;
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

// Fetch a product by UPC. Brickvault stores UPCs (Brickset backfill), so this is
// the cleanest join: one call returns the id + all prices, skipping the search
// discovery step entirely. Returns a LEGO product or null.
async function fetchPCByUpc(upc: string, token: string): Promise<PCPrice | null> {
  try {
    const resp = await fetch(
      `${PC_BASE}/product?upc=${encodeURIComponent(upc)}&t=${token}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!resp.ok) return null;
    const price = (await resp.json()) as PCPrice & { status?: string };
    if (price.status === 'error' || !price.id) return null;
    // Guard against a UPC collision with a non-LEGO product.
    if (price['console-name'] && !price['console-name'].toLowerCase().includes('lego')) return null;
    return price;
  } catch {
    return null;
  }
}

// Map a raw PCPrice (pennies) into the normalized result, applying the shared
// plausibility gate. PriceCharting returns 0 for conditions with no recent sales.
function toResult(pcId: string, price: PCPrice): PriceChartingResult {
  const cents = (v: number | undefined) => (v && v > 0 ? v / 100 : null);
  const newValue = cents(price['new-price']);
  const completeValue = cents(price['cib-price']);
  const looseValue = cents(price['loose-price']);
  const vol = Number(price['sales-volume']);
  return {
    pc_id: pcId,
    new_value: newValue && isPlausibleMarketValue(newValue, {}) ? newValue : null,
    complete_value: completeValue && isPlausibleMarketValue(completeValue, {}) ? completeValue : null,
    loose_value: looseValue && isPlausibleMarketValue(looseValue, {}) ? looseValue : null,
    sales_volume: Number.isFinite(vol) && vol > 0 ? Math.round(vol) : null,
  };
}

/**
 * Look up PriceCharting data for a LEGO set.
 *
 * Resolution order (cheapest/most-exact first):
 *   1. Known pc_id → fetch its price directly (no discovery).
 *   2. Known UPC → /api/product?upc= returns the id + all prices in one call.
 *   3. Search by set number to discover the id, then fetch the price.
 *
 * Prices come from aggregated eBay closed-auction data (integer pennies):
 *   "new-price"   → sealed / factory-new
 *   "cib-price"   → complete-in-box (opened, with box + manual)
 *   "loose-price" → item only, without box/manual (used corroborator)
 *   "sales-volume"→ yearly units sold (liquidity)
 *
 * Returns null when the set is not in PriceCharting's catalog or on any error.
 */
export async function fetchPriceChartingData(
  setNum: string,
  _setName: string,
  existingPcId: string | null | undefined,
  env: Env,
  upc?: string | null,
): Promise<PriceChartingResult | null> {
  const token = env.PRICECHARTING_TOKEN;
  if (!token) return null;

  // 1. Known id → direct price fetch.
  if (existingPcId) {
    const price = await fetchPCPrice(existingPcId, token);
    return price ? toResult(existingPcId, price) : null;
  }

  // 2. Known UPC → exact one-call lookup (id + prices together).
  if (upc) {
    const byUpc = await fetchPCByUpc(upc, token);
    if (byUpc) return toResult(byUpc.id, byUpc);
    // fall through to search if the UPC isn't in PriceCharting
  }

  // 3. Discover the id via search.
  // Strip the Rebrickable suffix ("-1", "-2") so "42115-1" searches as "42115".
  const baseNum = setNum.replace(/-\d+$/, '');
  const products = await searchPriceCharting(`${baseNum} lego`, token);
  if (!products?.length) return null;

  const legoProducts = products.filter(
    (p) => p['console-name']?.toLowerCase().includes('lego'),
  );
  if (!legoProducts.length) return null;

  const matched =
    legoProducts.find((p) => p['product-name']?.includes(baseNum)) ??
    legoProducts[0];

  const price = await fetchPCPrice(matched.id, token);
  return price ? toResult(matched.id, price) : null;
}
