import { LEGO_LOCAL_MARKETS } from './lego-local-price';

// LEGO promotions calendar (table promotions): gifts with purchase, double
// Insiders points, sales. Read daily from each country's LEGO.com offers pages
// (Bright Data first, Firecrawl as fallback); the admin can add, fix or hide
// entries. Every row belongs to one LEGO.com store (market) and keeps that
// store's own minimum spend in its own currency, never a converted dollar one.

export const PROMO_KINDS = ['gwp', 'double_points', 'sale', 'other'] as const;
export type PromoKind = typeof PROMO_KINDS[number];

export interface PromoInput {
  kind: PromoKind;
  title: string;
  details: string | null;
  starts_on: string | null;
  ends_on: string | null;
  min_spend: number | null;
  gift_set_num: string | null;
  url: string | null;
  market: string;
  currency: string;
}

/** LEGO.com stores we read promotions from (same country list as local prices). */
export const PROMO_MARKETS: Record<string, { locale: string; currency: string }> = {
  US: { locale: 'en-us', currency: 'USD' },
  ...LEGO_LOCAL_MARKETS,
};

export function promoMarket(raw: unknown): string | null {
  const m = String(raw || '').trim().toUpperCase();
  return PROMO_MARKETS[m] ? m : null;
}

export function promoPages(market: string): string[] {
  const locale = (PROMO_MARKETS[market] || PROMO_MARKETS.US).locale;
  return [
    `https://www.lego.com/${locale}/offers`,
    `https://www.lego.com/${locale}/categories/sales-and-deals`,
  ];
}

/** The US pages, kept for callers that predate per-country stores. */
export const PROMO_PAGES = promoPages('US');

export const PROMO_SCHEMA = {
  type: 'object',
  properties: {
    promotions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short name of the offer as shown' },
          kind: { type: 'string', description: 'gift_with_purchase | double_points | sale | other' },
          details: { type: 'string', description: 'One sentence of conditions (what you get, for what)' },
          start_date: { type: 'string', description: 'YYYY-MM-DD when the offer starts, if shown' },
          end_date: { type: 'string', description: 'YYYY-MM-DD when the offer ends, if shown' },
          min_spend: { type: 'number', description: "Minimum spend to qualify, as the plain number shown on this page in the page's own currency (no conversion), if any" },
          gift_set_number: { type: 'string', description: 'LEGO set number of the free gift, if a gift with purchase names one' },
          url: { type: 'string', description: 'Absolute URL of the offer details, if linked' },
        },
      },
    },
  },
};

export function promoPrompt(today: string, currency = 'USD'): string {
  return `Today is ${today}. List the current and upcoming promotions on this LEGO.com page: gifts with purchase, `
    + 'double (or bonus) LEGO Insiders points, and store-wide sales or discounts. Skip individual discounted products, '
    + 'newsletter sign-ups and generic banners. Use YYYY-MM-DD dates and leave out anything not shown. '
    + `Prices on this page are in ${currency}: give min_spend exactly as shown there, never converted. `
    + 'Keep titles and details in the page\'s own language, as plain text without Markdown (no underscores, asterisks or links). '
    + 'kind must be one of gift_with_purchase, double_points, sale, other.';
}

/** Markdown that page-to-text extraction leaves in offer text (_Star Wars_, **bold**, [link](url)). */
export function stripMarkdown(v: string): string {
  return v
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])([*_])(?=\S)([^*_\n]*?\S)\2(?!\w)/g, '$1$3')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\([*_`\[\]])/g, '$1')
    .replace(/\s+([™®])/g, '$1');
}

const isoDate = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const clean = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? stripMarkdown(v.replace(/\s+/g, ' ')).replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, max) : null;
};

/** Normalize one extracted or admin-entered promotion; null when unusable. */
export function normalizePromo(raw: Record<string, unknown>, marketHint?: string): PromoInput | null {
  const title = clean(raw.title, 140);
  if (!title) return null;
  const k = String(raw.kind || '').toLowerCase();
  const text = `${title} ${raw.details || ''}`.toLowerCase();
  const kind: PromoKind = k === 'gwp' || k.includes('gift') ? 'gwp'
    : k === 'double_points' || k.includes('point') ? 'double_points'
    : k === 'sale' ? 'sale'
    : /\bfree\b.*\bwith purchase|gift with purchase|\bgwp\b/.test(text) ? 'gwp'
    : /double|2x|bonus\b.*points|points\b.*bonus/.test(text) ? 'double_points'
    : /\bsale\b|% off|save \$/.test(text) ? 'sale' : 'other';
  let startsOn = isoDate(raw.starts_on ?? raw.start_date);
  let endsOn = isoDate(raw.ends_on ?? raw.end_date);
  if (startsOn && endsOn && endsOn < startsOn) [startsOn, endsOn] = [endsOn, startsOn];
  const spend = Number(raw.min_spend ?? raw.min_spend_usd);
  const gift = clean(raw.gift_set_num ?? raw.gift_set_number, 20);
  const giftNum = gift && /^\d{3,7}(-\d+)?$/.test(gift) ? (gift.includes('-') ? gift : `${gift}-1`) : null;
  const url = clean(raw.url, 400);
  const market = promoMarket(marketHint ?? raw.market) || 'US';
  return {
    kind,
    title,
    details: clean(raw.details, 400),
    starts_on: startsOn,
    ends_on: endsOn,
    min_spend: Number.isFinite(spend) && spend > 0 && spend < 10_000 ? Math.round(spend * 100) / 100 : null,
    gift_set_num: giftNum,
    url: url && /^https:\/\/[^\s]+$/i.test(url) ? url : null,
    market,
    currency: PROMO_MARKETS[market].currency,
  };
}

/** Same offer seen twice (or on both pages) collapses to one row. */
export function promoKey(p: PromoInput): string {
  const t = p.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const key = `${p.kind}|${t}|${p.starts_on || p.ends_on || ''}`;
  // US keys predate per-country stores and stay as they were.
  return p.market && p.market !== 'US' ? `${p.market}|${key}` : key;
}
