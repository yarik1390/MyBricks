import type { Env } from '../types';
import { fetchWithRetry } from './http';

// Returns the median completed-sale eBay price for a LEGO set.
// When EBAY_APP_ID is set, uses the Finding API findCompletedItems (actual sold
// prices). Falls back to HTML scraping of completed listings when no key is set.
// Returns null if <3 results or request fails.
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

  // Finding API supports up to 350 chars; RSS fallback uses the same string.
  if (keywords.length + negativeKeywords.length <= 350) {
    keywords += negativeKeywords;
  } else {
    const maxCleanNameLen = 350 - `LEGO ${setNum} `.length - negativeKeywords.length;
    if (maxCleanNameLen > 0) {
      keywords = `LEGO ${setNum} ${cleanName.slice(0, maxCleanNameLen)}${negativeKeywords}`;
    } else {
      keywords = `LEGO ${setNum} ${cleanName}`.slice(0, 350);
    }
  }

  if (env.EBAY_APP_ID) {
    // Finding API — returns actual completed/sold prices, not active listings.
    // Only requires App ID (no OAuth token exchange needed).
    try {
      const params = new URLSearchParams({
        'OPERATION-NAME': 'findCompletedItems',
        'SERVICE-VERSION': '1.0.0',
        'SECURITY-APPNAME': env.EBAY_APP_ID,
        'RESPONSE-DATA-FORMAT': 'JSON',
        'keywords': keywords,
        'itemFilter(0).name': 'SoldItemsOnly',
        'itemFilter(0).value': 'true',
        'sortOrder': 'StartTimeNewest',
        'paginationInput.entriesPerPage': '20',
      });

      const resp = await fetchWithRetry(
        `https://svcs.ebay.com/services/search/FindingService/v1?${params}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!resp.ok) {
        console.error('[ebay-finding] HTTP error:', resp.status);
        return await fetchRssFallback(keywords);
      }

      const data = await resp.json() as Record<string, unknown>;
      const searchRes = (data['findCompletedItemsResponse'] as Record<string, unknown>[])?.[0];
      const items = ((searchRes?.['searchResult'] as Record<string, unknown>[])?.[0]?.['item']) as Record<string, unknown>[] | undefined;

      if (!items || items.length < 3) return await fetchRssFallback(keywords);

      const prices = items
        .map(item => {
          const sp = (item['sellingStatus'] as Record<string, unknown>[])?.[0];
          const priceStr = (sp?.['convertedCurrentPrice'] as Record<string, unknown>[])?.[0]?.['__value__'];
          return parseFloat(String(priceStr ?? ''));
        })
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);

      if (prices.length < 3) return await fetchRssFallback(keywords);

      const median = prices[Math.floor(prices.length / 2)];
      const filtered = prices.filter(p => p <= median * 3);
      return filtered[Math.floor(filtered.length / 2)] ?? null;
    } catch (e) {
      console.error('[ebay-finding] failed:', e);
      return await fetchRssFallback(keywords);
    }
  }

  return await fetchRssFallback(keywords);
}

async function fetchRssFallback(keywords: string): Promise<number | null> {
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Sold=1&LH_Complete=1`;
    const resp = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      }
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    const prices: number[] = [];
    // eBay periodically renames its price class (s-item__price, su-styled-text…).
    // Try the known selectors in order, then fall back to scanning currency-prefixed
    // numbers across the whole document so a class rename degrades instead of breaking.
    const priceBlockPatterns = [
      /class="s-item__price"[^>]*>([\s\S]*?)<\/span>/g,
      /class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/g,
      /class="[^"]*--price[^"]*"[^>]*>([\s\S]*?)<\/span>/g,
    ];
    const collect = (text: string) => {
      const numMatch = text.match(/(?:\$|£|€|USD|EUR|GBP)\s*([0-9,]+(?:\.[0-9]{2})?)/i);
      if (numMatch) {
        const val = parseFloat(numMatch[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0) prices.push(val);
      }
    };
    for (const re of priceBlockPatterns) {
      let match;
      while ((match = re.exec(html)) !== null) collect(match[1].replace(/<[^>]*>/g, ''));
      if (prices.length >= 3) break;
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
