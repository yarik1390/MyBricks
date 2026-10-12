import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { edgeCached } from '../lib/edge-cache';
import { STORES, STORE_LABEL, STORE_OFFER_MAX_AGE_DAYS, storeSearchUrl } from '../lib/store-offers';

// Compare stores (mounted at /api/stores). Public and identical for every
// caller, so it is edge-cached.
//
// GET /api/stores/:setnum   live store prices we hold for the set (LEGO.com,
//                           Walmart, Target), cheapest first, plus links to
//                           check the price anywhere else. Resale marketplaces
//                           get a link only: their asking prices stay inside
//                           the anonymized deal signal.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

export interface StoreRow { store: string; label: string; price: number; in_stock: boolean; url: string; checked_at: string }

app.get('/:setnum', (c) => edgeCached(c, 1800, async () => {
  const setNum = c.req.param('setnum');
  const set = await c.env.DB.prepare(
    `SELECT set_num, retired, retail_price, brickset_msrp, lego_in_stock, lego_checked_at,
            COALESCE(NULLIF(blended_value, 0), current_value) AS value
       FROM lego_sets WHERE set_num = ?`,
  ).bind(setNum).first<{ set_num: string; retired: number | null; retail_price: number | null; brickset_msrp: number | null;
    lego_in_stock: number | null; lego_checked_at: string | null; value: number | null }>();
  if (!set) return c.json({ error: 'Not found' }, 404);

  const offers: StoreRow[] = [];
  if (Number(set.lego_in_stock) === 1 && Number(set.retail_price) > 0) {
    offers.push({ store: 'lego', label: STORE_LABEL.lego, price: Number(set.retail_price), in_stock: true,
      url: storeSearchUrl('lego', setNum), checked_at: set.lego_checked_at || '' });
  }
  const { results } = await c.env.DB.prepare(
    `SELECT store, price, in_stock, url, checked_at FROM store_offers
      WHERE set_num = ? AND price > 0 AND checked_at >= datetime('now', ?)`,
  ).bind(setNum, `-${STORE_OFFER_MAX_AGE_DAYS} days`).all<{ store: string; price: number; in_stock: number; url: string | null; checked_at: string }>()
    .catch(() => ({ results: [] as { store: string; price: number; in_stock: number; url: string | null; checked_at: string }[] }));
  for (const r of results || []) {
    offers.push({ store: r.store, label: STORE_LABEL[r.store] || r.store, price: r.price, in_stock: Number(r.in_stock) === 1,
      url: r.url || storeSearchUrl(r.store, setNum), checked_at: r.checked_at });
  }
  offers.sort((a, b) => Number(b.in_stock) - Number(a.in_stock) || a.price - b.price);

  const priced = new Set(offers.map((o) => o.store));
  const linkStores = [...(set.retired ? [] : ['lego', ...STORES]), 'ebay', 'bricklink', 'brickowl'].filter((s) => !priced.has(s));
  const links = linkStores.map((s) => ({ store: s, label: STORE_LABEL[s], url: storeSearchUrl(s, setNum) }));

  return c.json({
    set_num: setNum,
    msrp: Number(set.retail_price) > 0 ? Number(set.retail_price) : Number(set.brickset_msrp) > 0 ? Number(set.brickset_msrp) : null,
    value: Number(set.value) > 0 ? Number(set.value) : null,
    offers,
    links,
  });
}));

export { app as storesRoute };
