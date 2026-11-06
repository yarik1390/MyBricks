import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { edgeCached } from '../lib/edge-cache';
import { requireMember } from '../auth';
import { STORES, STORE_LABEL, STORE_OFFER_MAX_AGE_DAYS, storeSearchUrl } from '../lib/store-offers';
import { checkSetStores, storeScrapersAvailable } from '../jobs/store-offers';
import { bricklinkDisplayable } from '../lib/market-sources';
import { plausibleAskValue } from '../lib/valuation';
import { legoLocalMarket, legoLocalStale, legoLocalUrl, readLegoLocalPrice, refreshLegoLocalPrice } from '../lib/lego-local-price';

// Compare stores (mounted at /api/stores). Public and identical for every
// caller, so it is edge-cached.
//
// GET  /api/stores/:setnum        live store prices we hold for the set (LEGO.com,
//                                 Walmart, Target), cheapest first, what each
//                                 store check found (`stores`), plus links to
//                                 check the price anywhere else. eBay and
//                                 BrickLink get a `market` row when we hold a
//                                 recent figure for them: the median eBay asking
//                                 price (7 days) and BrickLink's average new sale
//                                 (only inside its 24h display window).
// POST /api/stores/:setnum/check  members: check Walmart and Target now when the
//                                 set has no recent check (shares the daily
//                                 'stores' cap with the 07:30 job), and the
//                                 local LEGO.com page for ?market= (FR, GB, ...)
//                                 when its price is over a day old ('lego_local'
//                                 cap), then return the same body as the GET.
// ?market=FR on both: LEGO.com's row uses lego.com/fr-fr's own euro price.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// `currency` is set only on a local LEGO.com row (price in that currency, not USD).
// `in_stock` is null when nobody has read LEGO.com's stock for the set yet: the
// card then shows LEGO's list price without an "out of stock" note.
// `us_price` marks LEGO.com's US list price shown to a member outside the US
// (no local price held yet, or the local page could not be read): its stock is
// left unknown, since US stock says nothing about lego.com/fr-fr.
export interface StoreRow { store: string; label: string; price: number; in_stock: boolean | null; url: string; checked_at: string; currency?: string; us_price?: boolean }

export interface MarketRow { store: 'ebay' | 'bricklink'; label: string; kind: 'ask' | 'sold'; price: number; count: number | null; checked_at: string; url: string }

// eBay asks are refreshed when a set page is opened and they are over 7 days old
// (set-detail-refresh.ts), so older ones are not shown.
const EBAY_ASK_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
// The GET is edge-cached for 30 minutes; a BrickLink figure must still be inside
// its 24h display window when the last cached copy is served.
const EDGE_TTL_SECONDS = 1800;

const ageMs = (ts: string | null | undefined, now: number) => {
  const t = Date.parse(String(ts || '').replace(' ', 'T') + (String(ts || '').includes('Z') ? '' : 'Z'));
  return Number.isFinite(t) ? now - t : Infinity;
};

export function marketRows(row: Record<string, unknown>, setNum: string, now = Date.now()): MarketRow[] {
  const rows: MarketRow[] = [];
  const ask = plausibleAskValue(row);
  if (ask && ageMs(row.ebay_ask_cached_at as string, now) <= EBAY_ASK_MAX_AGE_MS) {
    rows.push({ store: 'ebay', label: STORE_LABEL.ebay, kind: 'ask', price: Math.round(ask * 100) / 100,
      count: Number(row.ebay_ask_qty) > 0 ? Number(row.ebay_ask_qty) : null, checked_at: String(row.ebay_ask_cached_at), url: storeSearchUrl('ebay', setNum) });
  }
  const bl = Number(row.bl_new_value);
  if (bl > 0 && bricklinkDisplayable(row, now + EDGE_TTL_SECONDS * 1000)) {
    rows.push({ store: 'bricklink', label: STORE_LABEL.bricklink, kind: 'sold', price: Math.round(bl * 100) / 100,
      count: Number(row.bl_new_qty) > 0 ? Number(row.bl_new_qty) : null, checked_at: String(row.bl_cached_at), url: storeSearchUrl('bricklink', setNum) });
  }
  return rows;
}

export interface StoreStatus { store: string; label: string; status: 'priced' | 'not_listed' | 'unchecked'; checked_at: string | null; url: string }

async function storesBody(env: Env, setNum: string, marketRaw?: string | null) {
  const localMarket = legoLocalMarket(marketRaw);
  // Any member whose shop country is not the US (FR, GB, ... or one LEGO.com
  // local pages are not read for).
  const abroad = !!marketRaw && String(marketRaw).toUpperCase() !== 'US';
  const set = await env.DB.prepare(
    `SELECT s.set_num, s.retired, s.retail_price, s.brickset_msrp, s.lego_in_stock, s.lego_checked_at,
            COALESCE(NULLIF(s.blended_value, 0), s.current_value) AS value,
            s.ebay_ask_value, s.ebay_ask_qty, s.ebay_ask_cached_at, s.ebay_new_value, s.pc_new_value, s.be_retail,
            s.bl_new_value, s.bl_new_qty, s.bl_cached_at
       FROM lego_sets s LEFT JOIN set_market_ext ext ON ext.set_num = s.set_num
      WHERE s.set_num = ?`,
  ).bind(setNum).first<{ set_num: string; retired: number | null; retail_price: number | null; brickset_msrp: number | null;
    lego_in_stock: number | null; lego_checked_at: string | null; value: number | null } & Record<string, unknown>>();
  if (!set) return null;

  const offers: StoreRow[] = [];
  // Outside the US, LEGO.com's own local price (lego.com/fr-fr ...) when we
  // hold one; the US price converted is only the fallback.
  const local = localMarket && !set.retired ? await readLegoLocalPrice(env, setNum, localMarket) : null;
  const localPriced = !!local && Number(local.price) > 0;
  const notSoldLocally = !!local && local.availability === 'not_sold';
  if (localPriced && local) {
    offers.push({ store: 'lego', label: STORE_LABEL.lego, price: Number(local.price), currency: local.currency,
      in_stock: Number(local.in_stock) === 1, url: legoLocalUrl(setNum, localMarket!), checked_at: local.checked_at });
  } else if (!notSoldLocally && !set.retired && Number(set.retail_price) > 0) {
    // LEGO.com's US list price, in stock or not: a sold-out or never-checked
    // set still has a LEGO.com price, and a bare "Check the price at" link
    // hid it (21061 Notre-Dame, 2026-11-04).
    // Outside the US it is labelled as the US price, converted, with no stock
    // note: Sagrada Família showed "€712.38, out of stock" (US $799.99, sold
    // out there) while lego.com/fr-fr had it in stock at €749.99 (2026-11-06).
    offers.push({ store: 'lego', label: STORE_LABEL.lego, price: Number(set.retail_price),
      in_stock: abroad || set.lego_in_stock == null ? null : Number(set.lego_in_stock) === 1,
      url: storeSearchUrl('lego', setNum), checked_at: set.lego_checked_at || '', ...(abroad ? { us_price: true } : {}) });
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
  // A local-currency row sorts on the client, which holds exchange rates.
  offers.sort((a, b) => Number(b.in_stock === true) - Number(a.in_stock === true) || a.price - b.price);

  const market = marketRows(set, setNum);
  const priced = new Set([...offers.map((o) => o.store), ...market.map((m) => m.store)]);
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
    local_market: localMarket,
    // Members' set pages check the local LEGO.com page when this is true.
    lego_local_due: !!localMarket && !set.retired && legoLocalStale(local),
    retired: !!Number(set.retired),
    msrp: Number(set.retail_price) > 0 ? Number(set.retail_price) : Number(set.brickset_msrp) > 0 ? Number(set.brickset_msrp) : null,
    value: Number(set.value) > 0 ? Number(set.value) : null,
    offers,
    stores,
    market,
    links,
  };
}

app.get('/:setnum', (c) => edgeCached(c, EDGE_TTL_SECONDS, async () => {
  const body = await storesBody(c.env, c.req.param('setnum') || '', c.req.query('market'));
  return body ? c.json(body) : c.json({ error: 'Not found' }, 404);
}));

app.post('/:setnum/check', requireMember, async (c) => {
  const setNum = c.req.param('setnum') || '';
  const market = c.req.query('market');
  const before = await storesBody(c.env, setNum, market);
  if (!before) return c.json({ error: 'Not found' }, 404);
  const due = before.stores.some((s) => s.status === 'unchecked');
  const scrapers = (due || before.lego_local_due) && (await storeScrapersAvailable(c.env));
  // Walmart/Target and the local LEGO.com page are read side by side: one
  // after the other took longer than the app waits, so the card never
  // showed what the check found.
  const [storesChecked, localChecked] = await Promise.all([
    scrapers && due
      ? checkSetStores(c.env, setNum, before.msrp).then((r) => r.processed > 0).catch(() => false)
      : Promise.resolve(false),
    scrapers && before.lego_local_due && before.local_market
      ? refreshLegoLocalPrice(c.env, setNum, before.local_market).catch(() => false)
      : Promise.resolve(false),
  ]);
  const checked = storesChecked || localChecked;
  if (!checked) return c.json({ ...before, checked: false });
  // Drop this colo's cached GETs so the next page load shows the fresh check.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const base = new URL(`/api/stores/${encodeURIComponent(setNum)}`, c.req.url);
  const keys = [base.toString()];
  if (market) keys.push(`${base.toString()}?market=${encodeURIComponent(market)}`);
  await Promise.all(keys.map((k) => cache?.delete(new Request(k, { method: 'GET' })).catch(() => false)));
  return c.json({ ...(await storesBody(c.env, setNum, market)), checked: true });
});

export { app as storesRoute };
