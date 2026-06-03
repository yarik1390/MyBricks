import type { Env } from '../types';

// Returns the median completed-sale eBay price for a LEGO set (last 20 sold listings).
// Returns null if <3 results or request fails.
// Cache TTL: 3 days — callers write ebay_value + ebay_cached_at to lego_sets.
export async function fetchEbayPrice(
  setNum: string,
  setName: string,
  env: Env,
): Promise<number | null> {
  const cleanName = setName
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const negativeKeywords = ' -only -instructions -manual -box -empty -custom -replacement -stickers';
  let keywords = `LEGO ${setNum} ${cleanName}`;

  if (keywords.length + negativeKeywords.length <= 100) {
    keywords += negativeKeywords;
  } else {
    const maxCleanNameLen = 100 - `LEGO ${setNum} `.length - negativeKeywords.length;
    if (maxCleanNameLen > 0) {
      keywords = `LEGO ${setNum} ${cleanName.slice(0, maxCleanNameLen)}${negativeKeywords}`;
    } else {
      keywords = `LEGO ${setNum} ${cleanName}`.slice(0, 100);
    }
  }

  if (env.EBAY_APP_ID) {
    // Official API Path
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
      if (!resp.ok) return await fetchRssFallback(keywords);

      const body = await resp.json() as Record<string, unknown>;
      const root = (body['findCompletedItemsResponse'] as Record<string, unknown>[])?.[0];
      const searchResult = (root?.['searchResult'] as Record<string, unknown>[])?.[0];
      const items = searchResult?.['item'] as Record<string, unknown>[] | undefined;
      if (!items || items.length < 3) {
        return await fetchRssFallback(keywords);
      }

      const prices = items
        .map(item => {
          const ss = (item['sellingStatus'] as Record<string, unknown>[])?.[0];
          const price = (ss?.['convertedCurrentPrice'] as Record<string, unknown>[])?.[0];
          return parseFloat(String(price?.['__value__'] ?? ''));
        })
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);

      if (prices.length < 3) return await fetchRssFallback(keywords);

      const median = prices[Math.floor(prices.length / 2)];
      const filtered = prices.filter(p => p <= median * 3);
      return filtered[Math.floor(filtered.length / 2)] ?? null;
    } catch {
      return await fetchRssFallback(keywords);
    }
  } else {
    // Keyless RSS Path
    return await fetchRssFallback(keywords);
  }
}

async function fetchRssFallback(keywords: string): Promise<number | null> {
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Sold=1&LH_Complete=1`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      }
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const prices: number[] = [];
    const itemRegex = /class="s-item__price"[^>]*>([\s\S]*?)<\/span>/g;
    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const priceText = match[1].replace(/<[^>]*>/g, ''); // strip HTML tags
      const numMatch = priceText.match(/(?:\$|£|€|USD|EUR|GBP)\s*([0-9,]+(?:\.[0-9]{2})?)/i);
      if (numMatch) {
        const val = parseFloat(numMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) {
          prices.push(val);
        }
      }
    }

    if (prices.length < 3) return null;

    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];
    const filtered = prices.filter(p => p <= median * 3);
    return filtered[Math.floor(filtered.length / 2)] ?? null;
  } catch (err) {
    console.error('[ebay-scrape] Error parsing eBay HTML completed listings:', err);
    return null;
  }
}
