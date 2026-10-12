/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/firecrawl', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/firecrawl')>(), firecrawlScrape: vi.fn(),
}));
vi.mock('./lib/market-sources', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/market-sources')>(), recomputeBlendedValues: vi.fn(async () => 0),
}));
import { firecrawlScrape } from './lib/firecrawl';
import { recomputeBlendedValues } from './lib/market-sources';
import { pickOffer, syncBestStoreOffer } from './lib/store-offers';
import { runStoreOffers } from './jobs/store-offers';
import app from './index';

const db = (env as { DB: D1Database }).DB;
const withKey = { ...env, FIRECRAWL_API_KEY: 'fc', FIRECRAWL_DAILY_CREDITS: '' } as any;
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException: () => {} } as any;
const scrape = vi.mocked(firecrawlScrape);

describe('pickOffer', () => {
  it('takes the set itself, not accessories, other sets or implausible prices', () => {
    const offer = pickOffer([
      { title: 'LED Light Kit for LEGO 75313 AT-AT', price: 49.99, in_stock: true },
      { title: 'LEGO Star Wars AT-AT 753130 Bundle', price: 700, in_stock: true },
      { title: 'LEGO Star Wars UCS AT-AT 75313 Building Set', price: 849.99, in_stock: false, url: 'https://www.walmart.com/ip/1' },
      { title: 'LEGO Star Wars AT-AT 75313', price: '$799.99', in_stock: true, url: 'https://www.walmart.com/ip/2' },
      { title: 'LEGO Star Wars AT-AT 75313 keychain', price: 9.99 },
      { title: 'LEGO 75313 AT-AT', price: 99, in_stock: true },
    ], '75313-1', 849.99);
    expect(offer).toEqual({ price: 799.99, in_stock: true, url: 'https://www.walmart.com/ip/2', title: 'LEGO Star Wars AT-AT 75313' });
    expect(pickOffer([{ title: 'Building blocks 75313 compatible', price: 50 }], '75313-1', null)).toBeNull();
  });
});

describe('store offers', () => {
  beforeEach(async () => {
    scrape.mockReset();
    vi.mocked(recomputeBlendedValues).mockClear();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'store_offers', 'user_wishlist', 'user_collection', 'api_quota', 'app_settings']);
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired, retail_price, lego_in_stock, lego_checked_at, current_value)
      VALUES ('10001-1', 'Fresh', CAST(strftime('%Y','now') AS INTEGER), 0, 100, 1, datetime('now'), 120),
             ('10002-1', 'Old', 2015, 1, 50, 0, NULL, 300)`).run();
    await db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('u1', '10001-1'), ('u1', '10002-1')`).run();
  });

  it('mirrors the cheapest fresh in-stock offer into the live-offer layer and clears it when gone', async () => {
    await db.prepare(`INSERT INTO store_offers (set_num, store, price, in_stock, checked_at) VALUES
      ('10001-1', 'walmart', 89.99, 1, datetime('now')), ('10001-1', 'target', 79.99, 0, datetime('now'))`).run();
    await syncBestStoreOffer(db, '10001-1');
    expect(await db.prepare('SELECT pa_lowest_offer AS p, pa_best_merchant AS m, pa_in_stock AS s FROM set_market_ext WHERE set_num = ?').bind('10001-1').first())
      .toEqual({ p: 89.99, m: 'Walmart', s: 1 });
    await db.prepare(`UPDATE store_offers SET checked_at = datetime('now', '-10 days')`).run();
    await syncBestStoreOffer(db, '10001-1');
    expect(await db.prepare('SELECT pa_lowest_offer AS p FROM set_market_ext WHERE set_num = ?').bind('10001-1').first()).toEqual({ p: null });
  });

  it('checks current sets at both stores, records misses, and clears stale offers', async () => {
    await db.prepare(`INSERT INTO set_market_ext (set_num, pa_lowest_offer, pa_in_stock, pa_best_merchant, pa_cached_at)
      VALUES ('10002-1', 40, 1, 'Somewhere', '2026-08-23 17:00:32')`).run();
    scrape.mockImplementation(async (opts: any) => (opts.url.includes('walmart')
      ? { data: { products: [{ title: 'LEGO Icons 10001 Fresh', price: 84.5, in_stock: true, url: 'https://www.walmart.com/ip/9' }] } }
      : { data: { products: [] } }) as any);
    const out = await runStoreOffers(withKey, { limit: 5 });
    expect(out).toMatchObject({ processed: 2, found: 1, cleared: 1 });
    expect(scrape).toHaveBeenCalledTimes(2); // the retired set is never checked
    const rows = await db.prepare('SELECT store, price, in_stock FROM store_offers ORDER BY store').all();
    expect(rows.results).toEqual([{ store: 'target', price: null, in_stock: 0 }, { store: 'walmart', price: 84.5, in_stock: 1 }]);
    expect(await db.prepare('SELECT pa_lowest_offer AS p FROM set_market_ext WHERE set_num = ?').bind('10002-1').first()).toEqual({ p: null });
    expect(await db.prepare('SELECT pa_lowest_offer AS p, pa_best_merchant AS m FROM set_market_ext WHERE set_num = ?').bind('10001-1').first())
      .toEqual({ p: 84.5, m: 'Walmart' });
    expect(vi.mocked(recomputeBlendedValues).mock.calls.map((call) => call[1])).toEqual([['10002-1'], ['10001-1']]);

    // Checked today: the next run skips it.
    scrape.mockClear();
    await runStoreOffers(withKey, { limit: 5 });
    expect(scrape).not.toHaveBeenCalled();
  });

  it('GET /api/stores lists priced stores cheapest first and links the rest', async () => {
    await db.prepare(`INSERT INTO store_offers (set_num, store, price, in_stock, url, checked_at) VALUES
      ('10001-1', 'walmart', 89.99, 1, 'https://www.walmart.com/ip/1', datetime('now')),
      ('10001-1', 'target', NULL, 0, NULL, datetime('now'))`).run();
    const res = await app.fetch(new Request('https://example.test/api/stores/10001-1'), env as any, ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.offers.map((o: any) => [o.store, o.price])).toEqual([['walmart', 89.99], ['lego', 100]]);
    expect(body.links.map((l: any) => l.store)).toEqual(['target', 'ebay', 'bricklink', 'brickowl']);
    expect(body.value).toBe(120);
  });
});
