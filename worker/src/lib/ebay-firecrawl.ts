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
 * Fetch eBay US NEW-condition SOLD comps via Firecrawl structured extraction.
 * A drop-in alternative to fetchEbaySoldViaBrightData — same corroboration gate,
 * same return type. Preferred over Bright Data when FIRECRAWL_API_KEY is set.
 */
export async function fetchEbaySoldViaFirecrawl(
  setNum: string,
  setName: string,
  env: Env,
): Promise<EbaySoldScrapeResult> {
  if (!firecrawlEnabled(env)) return { status: 'disabled', new_value: null, new_count: 0 };

  const base = setNum.replace(/-\d+$/, '');
  const q = encodeURIComponent(`LEGO ${base} ${setName || ''}`.trim());
  const url = `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=1000&_ipg=60`;

  const result = await firecrawlScrape<{ listings?: Array<{ title: string; price_usd: number; condition: string; sold_date?: string }> }>(
    {
      url,
      formats: ['json'],
      jsonOptions: {
        schema: LISTING_SCHEMA,
        prompt: `Extract sold LEGO set listings. Only include items where the title contains the set number "${base}" or the set name "${setName}". For each, include title, price in USD, condition, and the sold date in YYYY-MM-DD format.`,
      },
      timeoutMs: 30_000,
    },
    env,
  );

  if (!result) return { status: 'error', new_value: null, new_count: 0, error: 'Firecrawl returned null' };

  const matched = (result.data?.listings ?? [])
    .filter(l => isValidLegoSetSaleTitle(l.title, setNum))
    .filter(l => /new/i.test(l.condition ?? '') || !l.condition);
  const prices = matched
    .map(l => l.price_usd)
    .filter(p => Number.isFinite(p) && p > 0);

  if (!prices.length) return { status: 'no_data', new_value: null, new_count: 0 };

  const summary = summarizeSoldPrices(prices);
  if (summary.value == null) return { status: 'no_data', new_value: null, new_count: 0 };

  // Most-recent sale date among the matched comps so the blend can weight eBay
  // sold by when items ACTUALLY sold, not when we scraped (see market-sources).
  let newLastSold: string | null = null;
  for (const l of matched) {
    const d = normalizeSoldDate(l.sold_date);
    if (d && (!newLastSold || d > newLastSold)) newLastSold = d;
  }

  return { status: 'ok', new_value: summary.value, new_count: summary.sample_count, new_last_sold: newLastSold };
}
