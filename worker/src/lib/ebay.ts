import type { Env } from '../types';

// Returns the median completed-sale eBay price for a LEGO set (last 20 sold listings).
// Returns null if <3 results, EBAY_APP_ID not set, or request fails.
// Cache TTL: 3 days — callers write ebay_value + ebay_cached_at to lego_sets.
export async function fetchEbayPrice(
  setNum: string,
  setName: string,
  env: Env,
): Promise<number | null> {
  if (!env.EBAY_APP_ID) return null;

  const keywords = `LEGO ${setNum} ${setName}`.trim().slice(0, 100);
  const params = new URLSearchParams({
    'OPERATION-NAME': 'findCompletedItems',
    'SERVICE-NAME': 'FindingService',
    'SERVICE-VERSION': '1.0.0',
    'SECURITY-APPNAME': env.EBAY_APP_ID,
    'RESPONSE-DATA-FORMAT': 'JSON',
    'keywords': keywords,
    'itemFilter(0).name': 'SoldItemsOnly',
    'itemFilter(0).value': 'true',
    'sortOrder': 'StartTimeNewest',
    'paginationInput.entriesPerPage': '20',
  });

  try {
    const resp = await fetch(
      `https://svcs.ebay.com/services/search/FindingService/v1?${params}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (!resp.ok) return null;

    const body = await resp.json() as Record<string, unknown>;
    const root = (body['findCompletedItemsResponse'] as Record<string, unknown>[])?.[0];
    const searchResult = (root?.['searchResult'] as Record<string, unknown>[])?.[0];
    const items = searchResult?.['item'] as Record<string, unknown>[] | undefined;
    if (!items || items.length < 3) return null;

    const prices = items
      .map(item => {
        const ss = (item['sellingStatus'] as Record<string, unknown>[])?.[0];
        const price = (ss?.['convertedCurrentPrice'] as Record<string, unknown>[])?.[0];
        return parseFloat(String(price?.['__value__'] ?? ''));
      })
      .filter(p => !isNaN(p) && p > 0)
      .sort((a, b) => a - b);

    if (prices.length < 3) return null;

    // Remove outliers beyond 3× the median, then return the median.
    const median = prices[Math.floor(prices.length / 2)];
    const filtered = prices.filter(p => p <= median * 3);
    return filtered[Math.floor(filtered.length / 2)] ?? null;
  } catch {
    return null;
  }
}
