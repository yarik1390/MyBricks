/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/http', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/http')>(), fetchWithRetry: vi.fn(),
}));
import { fetchWithRetry } from './lib/http';
import { parseLegoStockHtml } from './lib/brightdata-parsers';
import { legoLocalUrl, refreshLegoLocalPrice } from './lib/lego-local-price';
import app from './index';

const db = (env as { DB: D1Database }).DB;
const ctx = { waitUntil: (p: Promise<unknown>) => { p.catch(() => {}); }, passThroughOnException: () => {} } as any;
const ld = (items: unknown) => `<script type="application/ld+json">${JSON.stringify(items)}</script>`;
const frPage = (price: unknown, availability = 'InStock') => ld({ '@type': 'Product', sku: '21065',
  offers: { availability: `https://schema.org/${availability}`, price, priceCurrency: 'EUR' } });

describe('local LEGO.com page parsing', () => {
  it('reads the euro price from lego.com/fr-fr and never mixes currencies', () => {
    expect(parseLegoStockHtml(frPage(749.99), '21065', 'EUR')).toMatchObject({ in_stock: true, retail_price_usd: 749.99 });
    expect(parseLegoStockHtml(frPage('749,99'), '21065', 'EUR')).toMatchObject({ retail_price_usd: 749.99 });
    // The US reader must not take a euro amount as dollars.
    expect(parseLegoStockHtml(frPage(749.99), '21065')).toMatchObject({ retail_price_usd: null });
    expect(parseLegoStockHtml(`<script>{"products":[{"id":"21065","availabilityStatus":"IN_STOCK","price":{"centAmount":74999,"currencyCode":"EUR"}}]}</script>`, '21065', 'EUR'))
      .toMatchObject({ retail_price_usd: 749.99 });
  });

  it('builds the local product URL', () => {
    expect(legoLocalUrl('21065-1', 'FR')).toBe('https://www.lego.com/fr-fr/product/21065');
    expect(legoLocalUrl('21065-1', 'GB')).toBe('https://www.lego.com/en-gb/product/21065');
  });
});

describe('Compare stores with a local LEGO.com price', () => {
  beforeEach(async () => {
    vi.mocked(fetchWithRetry).mockReset();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'store_offers', 'lego_local_prices', 'api_quota', 'app_settings']);
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired, retail_price, lego_in_stock, lego_checked_at, current_value)
      VALUES ('21065-1', 'Sagrada', CAST(strftime('%Y','now') AS INTEGER), 0, 799.99, 1, datetime('now'), 700),
             ('21066-1', 'Other', CAST(strftime('%Y','now') AS INTEGER), 0, 99.99, 1, datetime('now'), 90),
             ('21067-1', 'Gone', CAST(strftime('%Y','now') AS INTEGER), 0, 49.99, 1, datetime('now'), 50)`).run();
  });

  it('refreshes the local row from the page and stores the euro price', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response(frPage(749.99)));
    expect(await refreshLegoLocalPrice(env as any, '21065-1', 'FR')).toBe(true);
    expect(await db.prepare('SELECT currency, price, in_stock, availability FROM lego_local_prices WHERE set_num = ? AND market = ?')
      .bind('21065-1', 'FR').first()).toEqual({ currency: 'EUR', price: 749.99, in_stock: 1, availability: 'in_stock' });
    expect(vi.mocked(fetchWithRetry).mock.calls[0][0]).toBe('https://www.lego.com/fr-fr/product/21065');
  });

  it('GET ?market=FR shows LEGO.com in euros; US and no market keep the US price', async () => {
    await db.prepare(`INSERT INTO lego_local_prices (set_num, market, currency, price, in_stock, availability, checked_at)
      VALUES ('21065-1', 'FR', 'EUR', 749.99, 1, 'in_stock', datetime('now'))`).run();
    const fr = await (await app.fetch(new Request('https://example.test/api/stores/21065-1?market=FR'), env as any, ctx)).json() as any;
    expect(fr.offers.find((o: any) => o.store === 'lego')).toMatchObject({ price: 749.99, currency: 'EUR', in_stock: true,
      url: 'https://www.lego.com/fr-fr/product/21065' });
    expect(fr.lego_local_due).toBe(false);
    const us = await (await app.fetch(new Request('https://example.test/api/stores/21065-1?market=US'), env as any, ctx)).json() as any;
    expect(us.offers.find((o: any) => o.store === 'lego')).toMatchObject({ price: 799.99 });
    expect(us.offers.find((o: any) => o.store === 'lego').currency).toBeUndefined();
    expect(us.lego_local_due).toBe(false);
  });

  it('asks for a check when the local price is missing, and hides LEGO.com when it is not sold there', async () => {
    const none = await (await app.fetch(new Request('https://example.test/api/stores/21066-1?market=DE'), env as any, ctx)).json() as any;
    expect(none.lego_local_due).toBe(true);
    // The US fallback abroad is flagged as the US price with no stock note
    // (US stock says nothing about lego.com/de-de); a US member keeps both.
    expect(none.offers.find((o: any) => o.store === 'lego')).toMatchObject({ price: 99.99, us_price: true, in_stock: null });
    const usRow = (await (await app.fetch(new Request('https://example.test/api/stores/21066-1?market=US'), env as any, ctx)).json() as any)
      .offers.find((o: any) => o.store === 'lego');
    expect(usRow).toMatchObject({ price: 99.99, in_stock: true });
    expect(usRow.us_price).toBeUndefined();
    await db.prepare(`INSERT INTO lego_local_prices (set_num, market, currency, price, in_stock, availability, checked_at)
      VALUES ('21067-1', 'FR', 'EUR', NULL, 0, 'not_sold', datetime('now'))`).run();
    const gone = await (await app.fetch(new Request('https://example.test/api/stores/21067-1?market=FR'), env as any, ctx)).json() as any;
    expect(gone.offers.some((o: any) => o.store === 'lego')).toBe(false);
  });
});
