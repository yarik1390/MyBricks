import type { Env } from '../types';
import { fetchWithRetry } from './http';
import { firecrawlScrape } from './firecrawl';
import { firecrawlEnabled } from './pricing-flags';
import { sourceEnabled } from './source-config';
import { brightDataUnlock } from './brightdata';
import { backupFetch } from './backup-scrapers';
import { parseLegoStockHtml } from './brightdata-parsers';

export interface LegoStockResult {
  in_stock: boolean | null;
  retiring_soon: boolean | null;
  // Normalized fine-grained status from the same page (already fetched, free):
  // in_stock | out_of_stock | pre_order | back_order | coming_soon | sold_out | retiring | null.
  availability?: string | null;
  retail_price_usd?: number | null;
}

/** Treat absent/invalid extraction fields as unknown, never as false. */
export function normalizeLegoStockResult(data: unknown): LegoStockResult | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const availability = typeof d.availability === 'string' ? d.availability.trim().toLowerCase() : '';
  const result: LegoStockResult = {
    in_stock: typeof d.in_stock === 'boolean' ? d.in_stock : null,
    retiring_soon: typeof d.retiring_soon === 'boolean' ? d.retiring_soon : null,
    availability: ['in_stock', 'out_of_stock', 'pre_order', 'back_order', 'coming_soon', 'sold_out', 'retiring'].includes(availability) ? availability : null,
    retail_price_usd: typeof d.retail_price_usd === 'number' && Number.isFinite(d.retail_price_usd) && d.retail_price_usd > 0 ? d.retail_price_usd : null,
  };
  return Object.values(result).some((value) => value != null) ? result : null;
}

// Shared by scheduled and on-demand writers: an unknown field is not a deletion
// and retirement/price-only evidence cannot refresh the stock observation clock.
export function legoStockUpdate(db: D1Database, setNum: string, stock: LegoStockResult): D1PreparedStatement {
  const observedStock = stock.in_stock != null || stock.availability != null;
  // lego_retiring_since records when the flag first flipped on, so Pro members
  // can get the retiring alert a day before everyone else (wishlist-alerts).
  // SQLite evaluates every SET expression against the old row.
  const retiring = stock.retiring_soon == null ? null : Number(stock.retiring_soon);
  return db.prepare(`UPDATE lego_sets SET lego_in_stock=COALESCE(?, lego_in_stock),
    lego_retiring_since=CASE WHEN ? = 1 AND COALESCE(lego_retiring_soon, 0) = 0 THEN datetime('now')
      WHEN ? = 0 THEN NULL ELSE lego_retiring_since END,
    lego_retiring_soon=COALESCE(?, lego_retiring_soon),
    lego_checked_at=CASE WHEN ? THEN datetime('now') ELSE lego_checked_at END,
    lego_availability=COALESCE(?, lego_availability),
    retail_price=COALESCE(?, retail_price) WHERE set_num=?`)
    .bind(stock.in_stock == null ? null : Number(stock.in_stock), retiring, retiring,
      retiring, observedStock ? 1 : 0,
      stock.availability ?? null, stock.retail_price_usd ?? null, setNum);
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
        prompt: `Extract stock availability, retirement status, and US retail price ONLY for LEGO product ${num}. Ignore recommendations and navigation. Omit any field whose value is not observed; unknown is not false.`,
      },
      waitFor: 1500,
      timeoutMs: 25_000,
    },
    env,
  );
  return normalizeLegoStockResult(result?.data);
}

// Fallback: the same product-scoped deterministic parser as paid HTML lanes.
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

    return parseLegoStockHtml(await resp.text(), num);
  } catch {
    return null;
  }
}

/**
 * Fetch LEGO.com product page and extract stock/retirement status + retail price.
 * Uses Firecrawl when available (handles Cloudflare bot-protection); falls back to
 * Bright Data, then plain fetch, with product-scoped parsing when Firecrawl is
 * unconfigured OR fails at runtime (a block, timeout, no credits) — so a
 * Firecrawl miss doesn't leave the set unchecked.
 */
export async function checkLegoStock(setNum: string, env?: Env): Promise<LegoStockResult | null> {
  return notRetiringIfUnreleased(await checkLegoStockRaw(setNum, env));
}

// LEGO.com product pages carry "Retiring soon" in site navigation and
// merchandising, so the HTML parsers can flag a set that hasn't even launched.
// A coming-soon / pre-order product cannot be retiring.
export function notRetiringIfUnreleased(stock: LegoStockResult | null): LegoStockResult | null {
  if (!stock) return stock;
  const avail = (stock.availability ?? '').toLowerCase();
  if (avail !== 'coming_soon' && avail !== 'pre_order') return stock;
  return { ...stock, retiring_soon: false };
}

async function checkLegoStockRaw(setNum: string, env?: Env): Promise<LegoStockResult | null> {
  // Bright Data first for LEGO.com (its monthly allowance expires, Firecrawl
  // credits don't; Iaroslav, 2026-10-27), Firecrawl when Bright Data can't serve
  // the page, then the free plain fetch. Each lane honors the admin
  // source-tuning kill switches.
  const num = setNum.replace(/-\d+$/, '');
  // Bright Data, then Decodo/ZenRows (all raw HTML, same parser).
  const productUrl = `https://www.lego.com/en-us/product/${num}`;
  if (env && (await sourceEnabled(env, 'brightdata'))) {
    const html = await brightDataUnlock(productUrl, env, { timeoutMs: 25_000 });
    // Pass the numeric set id so the parser scopes JSON-LD/state to THIS
    // product — recommendation blocks for other sets must never be persisted.
    const parsed = html ? parseLegoStockHtml(html, num) : null;
    if (parsed) return parsed;
  }
  if (env) {
    const { html, missing } = await backupFetch(productUrl, env, { timeoutMs: 25_000 });
    // LEGO.com has no page for this set (usually retired): Firecrawl and the
    // plain fetch would only hit the same 404.
    if (missing) return null;
    const parsed = html ? parseLegoStockHtml(html, num) : null;
    if (parsed) return parsed;
  }
  if (env && (await sourceEnabled(env, 'firecrawl')) && firecrawlEnabled(env)) {
    const viaFirecrawl = await checkLegoStockViaFirecrawl(setNum, env);
    if (viaFirecrawl) return viaFirecrawl;
  }
  // LEGO.com is Cloudflare-protected so this may also miss, but it costs
  // nothing and occasionally succeeds.
  return checkLegoStockFallback(setNum);
}
