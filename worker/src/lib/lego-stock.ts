import type { Env } from '../types';
import { fetchWithRetry } from './http';
import { firecrawlScrape } from './firecrawl';
import { firecrawlEnabled } from './pricing-flags';

export interface LegoStockResult {
  in_stock: boolean | null;
  retiring_soon: boolean;
  // Normalized fine-grained status from the same page (already fetched, free):
  // in_stock | out_of_stock | pre_order | back_order | coming_soon | sold_out | retiring | null.
  availability?: string | null;
  retail_price_usd?: number | null;
}

const STOCK_SCHEMA = {
  type: 'object',
  properties: {
    in_stock: {
      type: 'boolean',
      description: 'true if the product is available to add to cart and purchase right now',
    },
    retiring_soon: {
      type: 'boolean',
      description: 'true if the page shows a "Retiring Soon" banner, notice, or similar retirement indication',
    },
    availability: {
      type: 'string',
      description: 'Normalized status: in_stock | out_of_stock | pre_order | back_order | coming_soon | sold_out | retiring',
    },
    retail_price_usd: {
      type: 'number',
      description: 'Current US retail price in USD as shown on the page, null if not visible',
    },
  },
};

// Firecrawl path: JS-rendered + bot-protected scrape with structured extraction.
async function checkLegoStockViaFirecrawl(setNum: string, env: Env): Promise<LegoStockResult | null> {
  const num = setNum.replace(/-\d+$/, '');
  const url = `https://www.lego.com/en-us/product/${num}`;
  const result = await firecrawlScrape<LegoStockResult>(
    {
      url,
      formats: ['json'],
      jsonOptions: {
        schema: STOCK_SCHEMA,
        prompt: 'Extract stock availability, retirement status, and US retail price from this LEGO product page.',
      },
      waitFor: 1500,
      timeoutMs: 25_000,
    },
    env,
  );
  if (!result) return null;
  const d = result.data;
  return {
    in_stock: typeof d.in_stock === 'boolean' ? d.in_stock : null,
    retiring_soon: !!d.retiring_soon,
    availability: typeof d.availability === 'string' ? d.availability : null,
    retail_price_usd: typeof d.retail_price_usd === 'number' ? d.retail_price_usd : null,
  };
}

// Fallback: plain fetch + regex (same as the previous implementation).
async function checkLegoStockFallback(setNum: string): Promise<LegoStockResult | null> {
  const num = setNum.replace(/-\d+$/, '');
  const url = `https://www.lego.com/en-us/product/${num}`;
  try {
    const resp = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Brickvault/1.0)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    }, { retries: 0, timeoutMs: 8000 });
    if (!resp.ok) return null;

    const html = await resp.text();
    const retiringSoon = /retiring\s+soon/i.test(html)
      || /retirement\s+immin/i.test(html)
      || /"availabilityStatus"\s*:\s*"(?:RETIRING|RETIRING_SOON)"/i.test(html);

    let inStock: boolean | null = null;
    const availMatch = html.match(/"availability"\s*:\s*"([^"]+)"/);
    if (availMatch) {
      const val = availMatch[1].toLowerCase();
      if (val.includes('instock') || val.includes('in_stock')) inStock = true;
      else if (val.includes('outofstock') || val.includes('out_of_stock') || val.includes('discontinued')) inStock = false;
    }
    if (inStock === null && /add-to-cart|AddToCart/i.test(html)) inStock = true;

    // Fine-grained status (free — same HTML). LEGO exposes richer states than a
    // bare in/out boolean; surface them so buyers can time pre-orders/back-orders.
    const statusMatch = html.match(/"availabilityStatus"\s*:\s*"([^"]+)"/i);
    const rawStatus = (statusMatch?.[1] || availMatch?.[1] || '').toUpperCase();
    let availability: string | null = null;
    if (/PRE.?ORDER/.test(rawStatus)) availability = 'pre_order';
    else if (/BACK.?ORDER/.test(rawStatus)) availability = 'back_order';
    else if (/COMING.?SOON/.test(rawStatus)) availability = 'coming_soon';
    else if (retiringSoon) availability = 'retiring';
    else if (/SOLD.?OUT/.test(rawStatus)) availability = 'sold_out';
    else if (/OUT.?OF.?STOCK|DISCONTINUED/.test(rawStatus)) availability = 'out_of_stock';
    else if (/IN.?STOCK/.test(rawStatus)) availability = 'in_stock';
    else if (inStock === true) availability = 'in_stock';
    else if (inStock === false) availability = 'out_of_stock';

    return { in_stock: inStock, retiring_soon: retiringSoon, availability };
  } catch {
    return null;
  }
}

/**
 * Fetch LEGO.com product page and extract stock/retirement status + retail price.
 * Uses Firecrawl when available (handles Cloudflare bot-protection); falls back to
 * plain fetch+regex when no FIRECRAWL_API_KEY is set.
 */
export async function checkLegoStock(setNum: string, env?: Env): Promise<LegoStockResult | null> {
  if (env && firecrawlEnabled(env)) {
    return checkLegoStockViaFirecrawl(setNum, env);
  }
  return checkLegoStockFallback(setNum);
}
