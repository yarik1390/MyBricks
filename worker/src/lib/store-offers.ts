// Store prices beyond LEGO.com and Amazon (table store_offers): the price a set
// sells for right now at big US retailers, read from each store's own search
// page through Firecrawl's structured extraction.
//
// The cheapest fresh in-stock offer is mirrored into set_market_ext.pa_* — the
// live-retail layer the deal signal, the "In stock at …" line and the wishlist
// target alerts already read — so those light up for every store at once.
// Naming the store is fine (it is a buy destination, not a valuation source),
// and store prices never feed the market value.

export const STORES = ['walmart', 'target'] as const;
export type Store = typeof STORES[number];

export const STORE_LABEL: Record<string, string> = {
  lego: 'LEGO.com',
  amazon: 'Amazon',
  walmart: 'Walmart',
  target: 'Target',
  ebay: 'eBay',
  bricklink: 'BrickLink',
  brickowl: 'Brick Owl',
};

/** Store search pages, scoped to the set number (also the "check price" links). */
export function storeSearchUrl(store: string, setNum: string): string {
  const num = setNum.replace(/-\d+$/, '');
  const q = encodeURIComponent(`LEGO ${num}`);
  switch (store) {
    case 'lego': return `https://www.lego.com/en-us/product/${num}`;
    case 'amazon': return `https://www.amazon.com/s?k=${q}`;
    case 'walmart': return `https://www.walmart.com/search?q=${q}`;
    case 'target': return `https://www.target.com/s?searchTerm=${q}`;
    case 'ebay': return `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_ItemCondition=1000`;
    case 'bricklink': return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(setNum)}#T=P`;
    case 'brickowl': return `https://www.brickowl.com/search/catalog?query=${encodeURIComponent(num)}`;
    default: return '';
  }
}

export interface ExtractedProduct {
  title?: unknown;
  price?: unknown;
  in_stock?: unknown;
  url?: unknown;
}

export interface StoreOffer {
  price: number;
  in_stock: boolean;
  url: string | null;
  title: string;
}

// Accessories sold "for" a set name the set number too; none of them is the set.
const NOT_THE_SET = /\b(compatible|light(ing)? kit|led|display (case|stand|box)|acrylic|case for|stand for|frame for|lights? for|sticker|decal|book|magazine|keychain|key chain|magnet|poster|puzzle|replacement|instructions only|minifig(ure)?s? only|bricks? only|parts? only|used|pre-?owned|refurbished)\b/i;

/**
 * Pick the store's listing of this set from the extracted search results, or
 * null. The title must say LEGO and carry the set number as its own token, and
 * the price must be plausible against the set's retail price when we know it
 * (a $9 keychain or a $900 bundle is not the set).
 */
export function pickOffer(products: ExtractedProduct[], setNum: string, msrp: number | null): StoreOffer | null {
  const num = setNum.replace(/-\d+$/, '');
  const token = new RegExp(`(^|[^0-9])${num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`);
  const candidates: StoreOffer[] = [];
  for (const p of products || []) {
    const title = typeof p.title === 'string' ? p.title.trim() : '';
    const price = typeof p.price === 'number' ? p.price : Number(String(p.price ?? '').replace(/[^0-9.]/g, ''));
    if (!title || !Number.isFinite(price) || price <= 0) continue;
    if (!/\blego\b/i.test(title) || !token.test(title) || NOT_THE_SET.test(title)) continue;
    if (msrp && msrp > 0 && (price < msrp * 0.4 || price > msrp * 2.5)) continue;
    const url = typeof p.url === 'string' && /^https:\/\//.test(p.url) ? p.url : null;
    candidates.push({ price: Math.round(price * 100) / 100, in_stock: p.in_stock !== false, url, title: title.slice(0, 200) });
  }
  if (!candidates.length) return null;
  // Prefer an in-stock listing, then the cheapest.
  candidates.sort((a, b) => Number(b.in_stock) - Number(a.in_stock) || a.price - b.price);
  return candidates[0];
}

export const STORE_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Product title exactly as listed' },
          price: { type: 'number', description: 'Current price in USD shown for the product (the sale price when discounted)' },
          in_stock: { type: 'boolean', description: 'false when the listing says out of stock, sold out or unavailable' },
          url: { type: 'string', description: 'Absolute URL of the product page' },
        },
      },
    },
  },
};

export function storeExtractPrompt(setNum: string): string {
  const num = setNum.replace(/-\d+$/, '');
  return `List the products in these search results whose title contains the LEGO set number ${num}. `
    + 'Include each product title, its current price in USD, whether it is in stock, and its product URL. '
    + 'Skip ads for unrelated products. Return an empty list when none match.';
}

/** Offers older than this are treated as gone (prices move, stock runs out). */
export const STORE_OFFER_MAX_AGE_DAYS = 4;

/**
 * Mirror the cheapest fresh in-stock store offer into set_market_ext.pa_* —
 * or clear it when there is none, so a stale price can never drive a deal call
 * or an alert.
 */
export async function syncBestStoreOffer(db: D1Database, setNum: string): Promise<void> {
  const best = await db.prepare(
    `SELECT store, price, (SELECT COUNT(*) FROM store_offers o2 WHERE o2.set_num = o.set_num AND o2.in_stock = 1
              AND o2.checked_at >= datetime('now', ?)) AS n
       FROM store_offers o
      WHERE set_num = ? AND in_stock = 1 AND price > 0 AND checked_at >= datetime('now', ?)
      ORDER BY price ASC LIMIT 1`,
  ).bind(`-${STORE_OFFER_MAX_AGE_DAYS} days`, setNum, `-${STORE_OFFER_MAX_AGE_DAYS} days`)
    .first<{ store: string; price: number; n: number }>();
  if (best) {
    await db.prepare(
      `INSERT INTO set_market_ext (set_num, pa_lowest_offer, pa_in_stock, pa_best_merchant, pa_offer_count, pa_market, pa_cached_at)
       VALUES (?, ?, 1, ?, ?, 'US', datetime('now'))
       ON CONFLICT(set_num) DO UPDATE SET pa_lowest_offer = excluded.pa_lowest_offer, pa_in_stock = 1,
         pa_best_merchant = excluded.pa_best_merchant, pa_offer_count = excluded.pa_offer_count,
         pa_market = 'US', pa_cached_at = excluded.pa_cached_at`,
    ).bind(setNum, best.price, STORE_LABEL[best.store] || best.store, best.n).run();
  } else {
    await db.prepare(
      `UPDATE set_market_ext SET pa_lowest_offer = NULL, pa_in_stock = NULL, pa_best_merchant = NULL,
         pa_offer_count = NULL, pa_cached_at = datetime('now')
       WHERE set_num = ? AND pa_lowest_offer IS NOT NULL`,
    ).bind(setNum).run();
  }
}
