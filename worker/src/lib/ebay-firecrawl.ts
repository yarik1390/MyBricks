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
        },
      },
    },
  },
};

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

  const result = await firecrawlScrape<{ listings?: Array<{ title: string; price_usd: number; condition: string }> }>(
    {
      url,
      formats: ['json'],
      jsonOptions: {
        schema: LISTING_SCHEMA,
        prompt: `Extract sold LEGO set listings. Only include items where the title contains the set number "${base}" or the set name "${setName}". Include title, price in USD, and condition.`,
      },
      timeoutMs: 30_000,
    },
    env,
  );

  if (!result) return { status: 'error', new_value: null, new_count: 0, error: 'Firecrawl returned null' };

  const listings = result.data?.listings ?? [];
  const prices = listings
    .filter(l => isValidLegoSetSaleTitle(l.title, setNum))
    .filter(l => /new/i.test(l.condition ?? '') || !l.condition)
    .map(l => l.price_usd)
    .filter(p => Number.isFinite(p) && p > 0);

  if (!prices.length) return { status: 'no_data', new_value: null, new_count: 0 };

  const summary = summarizeSoldPrices(prices);
  if (summary.value == null) return { status: 'no_data', new_value: null, new_count: 0 };
  return { status: 'ok', new_value: summary.value, new_count: summary.sample_count };
}
