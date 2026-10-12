// LEGO promotions calendar (table promotions): gifts with purchase, double
// Insiders points, sales. Read daily from LEGO.com's offers pages through
// Firecrawl's structured extraction; the admin can add, fix or hide entries.

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
}

export const PROMO_PAGES = [
  'https://www.lego.com/en-us/offers',
  'https://www.lego.com/en-us/categories/sales-and-deals',
];

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
          min_spend_usd: { type: 'number', description: 'Minimum spend in USD to qualify, if any' },
          gift_set_number: { type: 'string', description: 'LEGO set number of the free gift, if a gift with purchase names one' },
          url: { type: 'string', description: 'Absolute URL of the offer details, if linked' },
        },
      },
    },
  },
};

export function promoPrompt(today: string): string {
  return `Today is ${today}. List the current and upcoming promotions on this LEGO.com page: gifts with purchase, `
    + 'double (or bonus) LEGO Insiders points, and store-wide sales or discounts. Skip individual discounted products, '
    + 'newsletter sign-ups and generic banners. Use YYYY-MM-DD dates and leave out anything not shown.';
}

const isoDate = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
};
const clean = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, max) : null;
};

/** Normalize one extracted or admin-entered promotion; null when unusable. */
export function normalizePromo(raw: Record<string, unknown>): PromoInput | null {
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
  return {
    kind,
    title,
    details: clean(raw.details, 400),
    starts_on: startsOn,
    ends_on: endsOn,
    min_spend: Number.isFinite(spend) && spend > 0 && spend < 10_000 ? Math.round(spend * 100) / 100 : null,
    gift_set_num: giftNum,
    url: url && /^https:\/\/[^\s]+$/i.test(url) ? url : null,
  };
}

/** Same offer seen twice (or on both pages) collapses to one row. */
export function promoKey(p: PromoInput): string {
  const t = p.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${p.kind}|${t}|${p.starts_on || p.ends_on || ''}`;
}
