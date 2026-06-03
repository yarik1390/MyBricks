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

  if (env.EBAY_APP_ID && env.EBAY_CLIENT_SECRET) {
    try {
      const credentials = btoa(`${env.EBAY_APP_ID}:${env.EBAY_CLIENT_SECRET}`);
      const tokenResp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${credentials}`,
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope/buy.browse',
      });

      if (!tokenResp.ok) {
        const errText = await tokenResp.text();
        console.error('[ebay-oauth] token request failed:', errText);
        return await fetchRssFallback(keywords);
      }

      const tokenData = await tokenResp.json() as { access_token?: string };
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        console.error('[ebay-oauth] access_token missing in response');
        return await fetchRssFallback(keywords);
      }

      const searchResp = await fetch(
        `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(keywords)}&limit=15`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          },
        }
      );

      if (!searchResp.ok) {
        const errText = await searchResp.text();
        console.error('[ebay-browse] search request failed:', errText);
        return await fetchRssFallback(keywords);
      }

      const searchData = await searchResp.json() as { itemSummaries?: Array<{ price?: { value?: string } }> };
      const items = searchData.itemSummaries;
      if (!items || items.length < 3) {
        return await fetchRssFallback(keywords);
      }

      const prices = items
        .map(item => parseFloat(item.price?.value ?? ''))
        .filter(p => !isNaN(p) && p > 0)
        .sort((a, b) => a - b);

      if (prices.length < 3) return await fetchRssFallback(keywords);

      const median = prices[Math.floor(prices.length / 2)];
      const filtered = prices.filter(p => p <= median * 3);
      return filtered[Math.floor(filtered.length / 2)] ?? null;
    } catch (e) {
      console.error('[ebay-api] REST flow failed:', e);
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
