import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { edgeCached } from '../lib/edge-cache';
import { requireMember } from '../auth';
import { STORES, STORE_LABEL, STORE_OFFER_MAX_AGE_DAYS, storeSearchUrl } from '../lib/store-offers';
import { checkSetStores } from '../jobs/store-offers';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { sourceEnabled } from '../lib/source-config';

// Compare stores (mounted at /api/stores). Public and identical for every
// caller, so it is edge-cached.
//
// GET  /api/stores/:setnum        live store prices we hold for the set (LEGO.com,
//                                 Walmart, Target), cheapest first, what each
//                                 store check found (`stores`), plus links to
//                                 check the price anywhere else. Resale
//                                 marketplaces get a link only: their asking
//                                 prices stay inside the anonymized deal signal.
// POST /api/stores/:setnum/check  members: check Walmart and Target now when the
//                                 set has no recent check (shares the daily
//                                 'stores' cap with the 07:30 job), then return
//                                 the same body as the GET.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

export interface StoreRow { store: string; label: string; price: number; in_stock: boolean; url: string; checked_at: string }

export interface StoreStatus { store: string; label: string; status: 'priced' | 'not_listed' | 'unchecked'; checked_at: string | null; url: string }

async function storesBody(env: Env, setNum: string) {
  const set = await env.DB.prepare(
    `SELECT set_num, retired, retail_price, brickset_msrp, lego_in_stock, lego_checked_at,
            COALESCE(NULLIF(blended_value, 0), current_value) AS value
       FROM lego_sets WHERE set_num = ?`,
  ).bind(setNum).first<{ set_num: string; retired: number | null; retail_price: number | null; brickset_msrp: number | null;
    lego_in_stock: number | null; lego_checked_at: string | null; value: number | null }>();
  if (!set) return null;

  const offers: StoreRow[] = [];
  if (Number(set.lego_in_stock) === 1 && Number(set.retail_price) > 0) {
    offers.push({ store: 'lego', label: STORE_LABEL.lego, price: Number(set.retail_price), in_stock: true,
      url: storeSearchUrl('lego', setNum), checked_at: set.lego_checked_at || '' });
  }
  const { results } = await env.DB.prepare(
    `SELECT store, price, in_stock, url, checked_at FROM store_offers
      WHERE set_num = ? AND checked_at >= datetime('now', ?)`,
  ).bind(setNum, `-${STORE_OFFER_MAX_AGE_DAYS} days`).all<{ store: string; price: number; in_stock: number; url: string | null; checked_at: string }>()
    .catch(() => ({ results: [] as { store: string; price: number; in_stock: number; url: string | null; checked_at: string }[] }));
  const fresh = new Map((results || []).map((r) => [r.store, r]));
  for (const r of results || []) {
    if (!(Number(r.price) > 0)) continue;
    offers.push({ store: r.store, label: STORE_LABEL[r.store] || r.store, price: r.price, in_stock: Number(r.in_stock) === 1,
      url: r.url || storeSearchUrl(r.store, setNum), checked_at: r.checked_at });
  }
  offers.sort((a, b) => Number(b.in_stock) - Number(a.in_stock) || a.price - b.price);

  const priced = new Set(offers.map((o) => o.store));
  // Walmart and Target appear under `stores` instead.
  const linkStores = [...(set.retired ? [] : ['lego']), 'ebay', 'bricklink', 'brickowl'].filter((s) => !priced.has(s));
  const links = linkStores.map((s) => ({ store: s, label: STORE_LABEL[s], url: storeSearchUrl(s, setNum) }));

  // What each store check found, so the card can say "not sold there" or
  // "not checked yet" instead of showing a bare link.
  const stores: StoreStatus[] = set.retired ? [] : STORES.map((st) => {
    const r = fresh.get(st);
    return {
      store: st,
      label: STORE_LABEL[st],
      status: r ? (Number(r.price) > 0 ? 'priced' : 'not_listed') : 'unchecked',
      checked_at: r?.checked_at || null,
      url: storeSearchUrl(st, setNum),
    };
  });

  return {
    set_num: setNum,
    retired: !!Number(set.retired),
    msrp: Number(set.retail_price) > 0 ? Number(set.retail_price) : Number(set.brickset_msrp) > 0 ? Number(set.brickset_msrp) : null,
    value: Number(set.value) > 0 ? Number(set.value) : null,
    offers,
    stores,
    links,
  };
}

app.get('/:setnum', (c) => edgeCached(c, 1800, async () => {
  const body = await storesBody(c.env, c.req.param('setnum') || '');
  return body ? c.json(body) : c.json({ error: 'Not found' }, 404);
}));

app.post('/:setnum/check', requireMember, async (c) => {
  const setNum = c.req.param('setnum') || '';
  const before = await storesBody(c.env, setNum);
  if (!before) return c.json({ error: 'Not found' }, 404);
  const due = before.stores.some((s) => s.status === 'unchecked');
  let checked = false;
  if (due && firecrawlEnabled(c.env) && (await sourceEnabled(c.env, 'firecrawl'))) {
    const r = await checkSetStores(c.env, setNum, before.msrp);
    checked = r.processed > 0;
  }
  if (!checked) return c.json({ ...before, checked: false });
  // Drop this colo's cached GET so the next page load shows the fresh check.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  await cache?.delete(new Request(new URL(`/api/stores/${encodeURIComponent(setNum)}`, c.req.url).toString(), { method: 'GET' })).catch(() => false);
  return c.json({ ...(await storesBody(c.env, setNum)), checked: true });
});

export { app as storesRoute };
