import type { Env } from '../types';
import { firecrawlScrape } from './firecrawl';
import { firecrawlEnabled } from './pricing-flags';
import { summarizeSoldPrices, isValidLegoSetSaleTitle } from './ebay';
import type { EbaySoldScrapeResult } from './brightdata';

const LISTING_SCHEMA = {
  type: 'object',
  properties: {
    listings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          price_usd: { type: 'number' },
          condition: { type: 'string' },
          sold_date: { type: 'string', description: 'Date the item sold, in YYYY-MM-DD format' },
        },
      },
    },
  },
};

// Normalise a scraped sold-date to YYYY-MM-DD, rejecting junk / future / pre-2000
// values. Accepts the prompt's YYYY-MM-DD directly; tolerates other parseable
// formats (e.g. "Dec 15, 2025") as a fallback.
function normalizeSoldDate(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const iso = trimmed.slice(0, 10);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(iso) : Date.parse(trimmed);
  if (!Number.isFinite(t)) return null;
  const dt = new Date(t);
  if (dt.getUTCFullYear() < 2000 || t > Date.now() + 86_400_000) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Fetch eBay US SOLD comps via Firecrawl structured extraction, separated into
 * new/sealed and used/complete condition buckets.
 * A drop-in alternative to fetchEbaySoldViaBrightData — same corroboration gate,
 * same return type. Preferred over Bright Data when FIRECRAWL_API_KEY is set.
 */
export async function fetchEbaySoldViaFirecrawl(
  setNum: string,
  setName: string,
  env: Env,
  options: { includeNew?: boolean; includeUsed?: boolean } = {},
): Promise<EbaySoldScrapeResult> {
  if (!firecrawlEnabled(env)) return { status: 'disabled', new_value: null, new_count: 0 };

  const base = setNum.replace(/-\d+$/, '');
  const q = encodeURIComponent(`LEGO ${base} ${setName || ''}`.trim());
  const includeNew = options.includeNew !== false;
  const includeUsed = options.includeUsed !== false;
  const conditionFilter = includeNew === includeUsed ? '' : `&LH_ItemCondition=${includeNew ? 1000 : 3000}`;
  const url = `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1${conditionFilter}&_ipg=60`;

  const result = await firecrawlScrape<{ listings?: Array<{ title: string; price_usd: number; condition: string; sold_date?: string }> }>(
    {
      url,
      formats: ['json'],
      // eBay heavily bot-protects its sold-search: the default (basic) proxy gets
      // thin/blocked pages, so the extraction found comps only ~7% of the time.
      // The mobile/residential ENHANCED proxy renders it (the same lesson as StockX).
      proxy: 'enhanced',
      jsonOptions: {
        schema: LISTING_SCHEMA,
        prompt: `Extract sold LEGO set listings. Only include items where the title contains the set number "${base}" or the set name "${setName}". Normalize condition to either "new" for new/sealed items or "used" for used/pre-owned complete sets. Exclude incomplete sets, loose parts, boxes, manuals and minifigure-only listings. For each, include title, price in USD, condition, and the sold date in YYYY-MM-DD format.`,
      },
      timeoutMs: 40_000,
    },
    env,
  );

  if (!result) return { status: 'error', new_value: null, new_count: 0, error: 'Firecrawl returned null' };

  const matched = (result.data?.listings ?? []).filter(l => isValidLegoSetSaleTitle(l.title, setNum));
  const bucket = (listing: { title: string; condition: string }): 'new' | 'used' | null => {
    if (includeNew && !includeUsed) return 'new';
    if (includeUsed && !includeNew) return 'used';
    const condition = `${listing.condition || ''} ${listing.title || ''}`.toLowerCase();
    if (/\b(new|sealed|misb|nib|bnib)\b/.test(condition)) return 'new';
    if (/\b(used|pre[ -]?owned|prebuilt|built|complete)\b/.test(condition)) return 'used';
    return null;
  };
  const newListings = includeNew ? matched.filter((listing) => bucket(listing) === 'new') : [];
  const usedListings = includeUsed ? matched.filter((listing) => bucket(listing) === 'used') : [];
  const summarize = (listings: typeof matched) => summarizeSoldPrices(
    listings.map(l => l.price_usd).filter(p => Number.isFinite(p) && p > 0),
  );
  const newSummary = summarize(newListings);
  const usedSummary = summarize(usedListings);
  if (newSummary.value == null && usedSummary.value == null) {
    return { status: 'no_data', new_value: null, new_count: 0, used_value: null, used_count: 0 };
  }

  const latestDate = (listings: typeof matched): string | null => {
    let latest: string | null = null;
    for (const listing of listings) {
      const date = normalizeSoldDate(listing.sold_date);
      if (date && (!latest || date > latest)) latest = date;
    }
    return latest;
  };

  return {
    status: 'ok',
    new_value: newSummary.value,
    new_count: newSummary.sample_count,
    new_last_sold: latestDate(newListings),
    used_value: usedSummary.value,
    used_count: usedSummary.sample_count,
    used_last_sold: latestDate(usedListings),
  };
}

// A sold-listing title is a plausible match for this minifig if it reads as a
// minifigure listing AND mentions the fig number or a significant name token.
// Deliberately loose — minifig titles vary wildly — because the real protection
// is the caller's corroboration gate (accept only within 3x of the BrickLink
// value), which rejects the noisy collisions a loose match lets through.
function isLikelyMinifigSaleTitle(title: string | undefined, figName: string, figNum: string): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  if (!/minifig|mini\s?fig|minifigure/.test(t)) return false;
  if (figNum && t.includes(figNum.toLowerCase())) return true;
  const tokens = String(figName || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  return tokens.length > 0 && tokens.some((w) => t.includes(w));
}

export interface MinifigEbaySold {
  status: 'ok' | 'no_data' | 'error' | 'disabled';
  value: number | null;
  count: number;
  last_sold?: string | null;
}

/**
 * eBay US sold comps for a single minifigure via Firecrawl (G1b — multi-source
 * minifig valuation). Mirrors the set sold-comp scraper; the caller corroborates
 * the returned median against the BrickLink value before blending, so a noisy
 * name collision can never set a minifig's value on its own.
 */
export async function fetchMinifigEbaySoldViaFirecrawl(
  figNum: string,
  figName: string,
  env: Env,
): Promise<MinifigEbaySold> {
  if (!firecrawlEnabled(env)) return { status: 'disabled', value: null, count: 0 };

  const q = encodeURIComponent(`LEGO ${figName || figNum} minifigure`.trim());
  const url = `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&_ipg=60`;

  const result = await firecrawlScrape<{ listings?: Array<{ title: string; price_usd: number; condition: string; sold_date?: string }> }>(
    {
      url,
      formats: ['json'],
      // Same anti-bot lesson as the set scraper above: eBay's sold search returns
      // a thin/blocked page through the default proxy, so this extraction almost
      // never found comps. The mobile/residential ENHANCED proxy renders it.
      proxy: 'enhanced',
      jsonOptions: {
        schema: LISTING_SCHEMA,
        prompt: `Extract sold LEGO MINIFIGURE listings matching "${figName}" (${figNum}). Only individual minifigures — exclude full sets and lots. For each, include title, price in USD, condition, and the sold date in YYYY-MM-DD format.`,
      },
      timeoutMs: 30_000,
    },
    env,
  );

  if (!result) return { status: 'error', value: null, count: 0 };

  const matched = (result.data?.listings ?? []).filter((l) => isLikelyMinifigSaleTitle(l.title, figName, figNum));
  const prices = matched.map((l) => l.price_usd).filter((p) => Number.isFinite(p) && p > 0);
  if (!prices.length) return { status: 'no_data', value: null, count: 0 };

  const summary = summarizeSoldPrices(prices);
  if (summary.value == null) return { status: 'no_data', value: null, count: 0 };

  let lastSold: string | null = null;
  for (const l of matched) {
    const d = normalizeSoldDate(l.sold_date);
    if (d && (!lastSold || d > lastSold)) lastSold = d;
  }
  return { status: 'ok', value: summary.value, count: summary.sample_count, last_sold: lastSold };
}
