import type { Env } from '../types';
import { firecrawlScrape } from './firecrawl';
import { firecrawlEnabled } from './pricing-flags';
import { sourceEnabled } from './source-config';
import { rawPageAvailable, fetchRawPage, harvestProducts, llmExtractJson, pageText } from './page-extract';

// Upcoming / coming-soon LEGO sets via Firecrawl structured extraction of the
// public LEGO.com coming-soon listing (G2b), or Bright Data when Firecrawl
// can't serve it. LEGO official images/info; the
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

const UPCOMING_URL = 'https://www.lego.com/en-us/categories/coming-soon';
const UPCOMING_PROMPT = 'Extract every upcoming/coming-soon LEGO product on this page: name, product number (the LEGO set number), US price in USD, and availability (e.g. "Coming Soon", "Pre-order", "Available now").';

type RawUpcoming = { name?: string; product_number?: string; price_usd?: number | null; availability?: string | null };

export async function upcomingScrapersAvailable(env: Env): Promise<boolean> {
  if (firecrawlEnabled(env) && (await sourceEnabled(env, 'firecrawl'))) return true;
  return rawPageAvailable(env);
}

async function viaFirecrawl(env: Env): Promise<RawUpcoming[] | null> {
  if (!firecrawlEnabled(env) || !(await sourceEnabled(env, 'firecrawl'))) return null;
  const result = await firecrawlScrape<{ products?: RawUpcoming[] }>(
    {
      url: UPCOMING_URL,
      formats: ['json'],
      jsonOptions: { schema: UPCOMING_SCHEMA, prompt: UPCOMING_PROMPT },
      waitFor: 2500,
      timeoutMs: 35_000,
    },
    env,
  );
  return result ? (result.data?.products ?? []) : null;
}

/** Product number from LEGO.com product data or its /product/<slug>-<num> URL. */
function legoProductNumber(code: string | null, url: string | null): string | null {
  const c = (code ?? '').trim();
  if (/^\d{4,7}$/.test(c)) return c;
  return url?.match(/\/product\/(?:[^/?#]*-)?(\d{4,7})(?:[/?#]|$)/)?.[1] ?? null;
}

async function viaBrightData(env: Env): Promise<RawUpcoming[] | null> {
  const html = await fetchRawPage(env, UPCOMING_URL, 35_000);
  if (!html) return null;
  const harvested: RawUpcoming[] = [];
  for (const p of harvestProducts(html, UPCOMING_URL)) {
    const productNumber = legoProductNumber(p.code, p.url);
    if (productNumber) harvested.push({ name: p.title, product_number: productNumber, price_usd: p.price, availability: p.availability });
  }
  if (harvested.length) return harvested;
  const extracted = await llmExtractJson<{ products?: RawUpcoming[] }>(env, pageText(html), UPCOMING_PROMPT, UPCOMING_SCHEMA);
  return extracted && Array.isArray(extracted.products) ? extracted.products : null;
}

export async function fetchUpcomingSets(env: Env): Promise<UpcomingItem[]> {
  // Firecrawl first, Bright Data when Firecrawl can't serve the page.
  const products = (await viaFirecrawl(env)) ?? (await viaBrightData(env));
  if (!products) return [];

  const out: UpcomingItem[] = [];
  const seen = new Set<string>();
  for (const p of products) {
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
