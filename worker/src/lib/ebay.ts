import type { Env } from '../types';
import { fetchTracked, fetchWithRetry } from './http';

const EBAY_SCOPE_MARKETPLACE_INSIGHTS = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

let tokenCache: { token: string; expiresAt: number; scope: string } | null = null;

function medianFiltered(prices: number[]): number | null {
  const sorted = prices.filter(p => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length < 3) return null;
  const median = sorted[Math.floor(sorted.length / 2)];
  const filtered = sorted.filter(p => p <= median * 3);
  return filtered[Math.floor(filtered.length / 2)] ?? null;
}

async function getEbayApplicationToken(
  env: Env,
  scope: string,
  options: { recordHealth?: boolean } = {},
): Promise<string | null> {
  if (!env.EBAY_APP_ID || !env.EBAY_CLIENT_SECRET) return null;
  if (tokenCache && tokenCache.scope === scope && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const credentials = btoa(`${env.EBAY_APP_ID}:${env.EBAY_CLIENT_SECRET}`);
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope });
  const resp = await fetchTracked(env, 'ebay', 'https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  }, { retries: 1, timeoutMs: 8000, record: options.recordHealth !== false });

  if (!resp.ok) return null;
  const data = await resp.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  tokenCache = {
    token: data.access_token,
    scope,
    expiresAt: Date.now() + Math.max(60, data.expires_in ?? 7200) * 1000,
  };
  return tokenCache.token;
}

async function fetchMarketplaceInsightsPrice(
  keywords: string,
  env: Env,
  options: { recordHealth?: boolean } = {},
): Promise<number | null> {
  const token = await getEbayApplicationToken(env, EBAY_SCOPE_MARKETPLACE_INSIGHTS, options);
  if (!token) return null;

  const params = new URLSearchParams({
    q: keywords,
    limit: '25',
  });
  const resp = await fetchTracked(
    env,
    'ebay',
    `https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    },
    { retries: 1, timeoutMs: 10000, record: options.recordHealth !== false },
  );

  if (!resp.ok) return null;
  const data = await resp.json() as { itemSales?: Array<Record<string, unknown>> };
  const prices = (data.itemSales ?? [])
    .map(item => {
      const price = item.price as { value?: string | number } | undefined;
      return Number(price?.value ?? NaN);
    });
  return medianFiltered(prices);
}

// Returns the median completed-sale eBay price for a LEGO set.
// When EBAY_APP_ID is set, uses the Finding API findCompletedItems (actual sold
// prices). Falls back to HTML scraping of completed listings when no key is set.
// Returns null if <3 results or request fails.
export async function fetchEbayPrice(
  setNum: string,
  setName: string,
  env: Env,
  options: { recordHealth?: boolean } = {},
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

  const marketplaceInsightsPrice = await fetchMarketplaceInsightsPrice(keywords, env, options).catch((e) => {
    console.warn('[ebay-marketplace-insights] failed:', (e as Error).message);
    return null;
  });
  if (marketplaceInsightsPrice !== null) return marketplaceInsightsPrice;

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

      const resp = await fetchTracked(
        env,
        'ebay',
        `https://svcs.ebay.com/services/search/FindingService/v1?${params}`,
        { headers: { Accept: 'application/json' } },
        { record: options.recordHealth !== false }
      );

      if (!resp.ok) {
        console.error('[ebay-finding] HTTP error:', resp.status);
          return await fetchRssFallback(keywords, env);
      }

      const data = await resp.json() as Record<string, unknown>;
      const searchRes = (data['findCompletedItemsResponse'] as Record<string, unknown>[])?.[0];
      const items = ((searchRes?.['searchResult'] as Record<string, unknown>[])?.[0]?.['item']) as Record<string, unknown>[] | undefined;

      if (!items || items.length < 3) return await fetchRssFallback(keywords, env);

      const prices = items
        .map(item => {
          const sp = (item['sellingStatus'] as Record<string, unknown>[])?.[0];
          const priceStr = (sp?.['convertedCurrentPrice'] as Record<string, unknown>[])?.[0]?.['__value__'];
          return parseFloat(String(priceStr ?? ''));
        });

      return medianFiltered(prices) ?? await fetchRssFallback(keywords, env);
    } catch (e) {
      console.error('[ebay-finding] failed:', e);
      return await fetchRssFallback(keywords, env);
    }
  }

  return await fetchRssFallback(keywords, env);
}

async function fetchRssFallback(keywords: string, env: Env): Promise<number | null> {
  try {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Sold=1&LH_Complete=1`;
    const resp = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8'
      }
    }, { retries: 1, timeoutMs: 8000 });
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

    return medianFiltered(prices);
  } catch (err) {
    console.error('[ebay-scrape] Error parsing eBay HTML completed listings:', err);
    return null;
  }
}
