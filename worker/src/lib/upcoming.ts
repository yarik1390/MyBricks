import type { Env } from '../types';
import { firecrawlScrape } from './firecrawl';
import { firecrawlEnabled } from './pricing-flags';

// Upcoming / coming-soon LEGO sets via Firecrawl structured extraction of the
// public LEGO.com coming-soon listing (G2b). LEGO official images/info; the
// feed powers a release surface so users can wishlist before launch.

const UPCOMING_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          product_number: { type: 'string', description: 'LEGO set number (digits)' },
          price_usd: { type: 'number', description: 'US price in USD' },
          availability: { type: 'string', description: 'e.g. Coming Soon, Pre-order, Available now' },
        },
      },
    },
  },
};

export interface UpcomingItem {
  set_num: string;
  name: string;
  price_usd: number | null;
  availability: string | null;
}

export async function fetchUpcomingSets(env: Env): Promise<UpcomingItem[]> {
  if (!firecrawlEnabled(env)) return [];

  const result = await firecrawlScrape<{ products?: Array<{ name?: string; product_number?: string; price_usd?: number; availability?: string }> }>(
    {
      url: 'https://www.lego.com/en-us/categories/coming-soon',
      formats: ['json'],
      jsonOptions: {
        schema: UPCOMING_SCHEMA,
        prompt: 'Extract every upcoming/coming-soon LEGO product on this page: name, product number (the LEGO set number), US price in USD, and availability (e.g. "Coming Soon", "Pre-order", "Available now").',
      },
      waitFor: 2500,
      timeoutMs: 35_000,
    },
    env,
  );
  if (!result) return [];

  const out: UpcomingItem[] = [];
  const seen = new Set<string>();
  for (const p of result.data?.products ?? []) {
    const num = String(p.product_number || '').trim();
    const name = String(p.name || '').trim();
    if (!/^\d{4,7}$/.test(num) || !name) continue; // valid LEGO set number + name
    const setNum = `${num}-1`;
    if (seen.has(setNum)) continue;
    seen.add(setNum);
    const price = typeof p.price_usd === 'number' && p.price_usd > 0 && p.price_usd < 2000 ? p.price_usd : null;
    const avail = String(p.availability || '').trim().slice(0, 40) || null;
    out.push({ set_num: setNum, name, price_usd: price, availability: avail });
  }
  return out;
}
