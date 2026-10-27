/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/firecrawl', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/firecrawl')>(), firecrawlScrape: vi.fn(),
}));
vi.mock('./lib/brightdata', () => ({ brightDataUnlock: vi.fn() }));
vi.mock('./lib/market-sources', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/market-sources')>(), recomputeBlendedValues: vi.fn(async () => 0),
}));
import { firecrawlScrape } from './lib/firecrawl';
import { brightDataUnlock } from './lib/brightdata';
import { harvestProducts, pageText } from './lib/page-extract';
import { runStoreOffers } from './jobs/store-offers';
import { fetchUpcomingSets } from './lib/upcoming';
import { checkLegoStock } from './lib/lego-stock';

const db = (env as { DB: D1Database }).DB;
const scrape = vi.mocked(firecrawlScrape);
const unlock = vi.mocked(brightDataUnlock);
const both = { ...env, FIRECRAWL_API_KEY: 'fc', FIRECRAWL_DAILY_CREDITS: '', BRIGHTDATA_API_TOKEN: 'bd' } as any;

const nextData = (data: unknown) => `<html><body><div>Results</div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></body></html>`;

const walmartPage = nextData({
  props: { pageProps: { initialData: { searchResult: { itemStacks: [{ items: [
    { name: 'LEGO Icons Fresh 10001 Building Set', canonicalUrl: '/ip/LEGO-Fresh/123', priceInfo: { currentPrice: { price: 84.5, priceString: '$84.50' } }, availabilityStatusV2: { value: 'IN_STOCK' } },
    { name: 'LED Light Kit for LEGO 10001', canonicalUrl: '/ip/kit/9', priceInfo: { currentPrice: { price: 29.99 } } },
  ] }] } } } },
});

describe('harvestProducts', () => {
  it('reads Walmart search state, LEGO.com product state and JSON-LD', () => {
    expect(harvestProducts(walmartPage, 'https://www.walmart.com/search?q=LEGO%2010001')).toEqual([
      { title: 'LEGO Icons Fresh 10001 Building Set', price: 84.5, in_stock: true, availability: 'IN_STOCK', url: 'https://www.walmart.com/ip/LEGO-Fresh/123', code: null },
      { title: 'LED Light Kit for LEGO 10001', price: 29.99, in_stock: null, availability: null, url: 'https://www.walmart.com/ip/kit/9', code: null },
    ]);
    const lego = nextData({ products: [
      { name: 'Future Castle', productCode: '10399', slug: '/en-us/product/future-castle-10399', variant: { price: { centAmount: 19999, currencyCode: 'USD' }, attributes: { availabilityStatus: 'E_COMING_SOON' } } },
    ] });
    expect(harvestProducts(lego, 'https://www.lego.com/en-us/categories/coming-soon')).toEqual([
      { title: 'Future Castle', price: 199.99, in_stock: false, availability: 'E_COMING_SOON', url: 'https://www.lego.com/en-us/product/future-castle-10399', code: '10399' },
    ]);
    const ld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'LEGO 75313 AT-AT', sku: 'A1', offers: { price: '799.99', priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' } })}</script>`;
    expect(harvestProducts(ld, 'https://www.target.com/')[0]).toMatchObject({ price: 799.99, in_stock: false, code: 'A1' });
  });

  it('keeps visible text only', () => {
    expect(pageText('<style>a{}</style><p>Double&nbsp;points</p><script>var x=1</script><div>Ends Nov 3</div>')).toBe('Double points\nEnds Nov 3');
  });
});

describe('Bright Data fallback', () => {
  beforeEach(async () => {
    scrape.mockReset();
    unlock.mockReset();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'store_offers', 'user_wishlist', 'user_collection', 'api_quota', 'app_settings', 'brightdata_keys']);
  });

  it('prices store offers through Bright Data when Firecrawl has no credits', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, year, retired, retail_price)
      VALUES ('10001-1', 'Fresh', CAST(strftime('%Y','now') AS INTEGER), 0, 100)`).run();
    await db.prepare(`INSERT INTO user_wishlist (user_id, set_num) VALUES ('u1', '10001-1')`).run();
    scrape.mockResolvedValue(null);
    unlock.mockImplementation(async (url: string) => (url.includes('walmart') ? walmartPage : null));
    const out = await runStoreOffers(both, { limit: 5 });
    expect(out).toMatchObject({ processed: 2, found: 1 });
    expect(scrape).toHaveBeenCalledTimes(2); // Firecrawl is still asked first
    const rows = await db.prepare('SELECT store, price, in_stock, url FROM store_offers ORDER BY store').all();
    // Target's page couldn't be read: no row is written, so nothing reads as "not listed".
    expect(rows.results).toEqual([{ store: 'walmart', price: 84.5, in_stock: 1, url: 'https://www.walmart.com/ip/LEGO-Fresh/123' }]);
  });

  it('does not call Bright Data when Firecrawl answers', async () => {
    scrape.mockResolvedValue({ data: { products: [{ name: 'Future Castle', product_number: '10399', price_usd: 199.99, availability: 'Coming Soon' }] } } as any);
    expect(await fetchUpcomingSets(both)).toEqual([{ set_num: '10399-1', name: 'Future Castle', price_usd: 199.99, availability: 'Coming Soon' }]);
    expect(unlock).not.toHaveBeenCalled();
  });

  it('reads Coming soon through Bright Data when Firecrawl fails', async () => {
    scrape.mockResolvedValue(null);
    unlock.mockResolvedValue(nextData({ items: [
      { name: 'Future Castle', productCode: '10399', variant: { price: { centAmount: 19999, currencyCode: 'USD' }, attributes: { availabilityText: 'Coming Soon' } } },
      { name: 'Gift card', productCode: 'GC-1', price: 25 },
    ] }));
    expect(await fetchUpcomingSets(both)).toEqual([{ set_num: '10399-1', name: 'Future Castle', price_usd: 199.99, availability: 'Coming Soon' }]);
  });

  it('checks LEGO.com stock with Firecrawl first, then Bright Data', async () => {
    scrape.mockResolvedValue({ data: { in_stock: true, availability: 'in_stock', retail_price_usd: 99.99 } } as any);
    expect(await checkLegoStock('10001-1', both)).toMatchObject({ in_stock: true, retail_price_usd: 99.99 });
    expect(unlock).not.toHaveBeenCalled();

    scrape.mockResolvedValue(null);
    unlock.mockResolvedValue(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', sku: '10001', url: 'https://www.lego.com/en-us/product/fresh-10001', offers: { price: '89.99', priceCurrency: 'USD', availability: 'https://schema.org/OutOfStock' } })}</script>`);
    expect(await checkLegoStock('10001-1', both)).toMatchObject({ in_stock: false, retail_price_usd: 89.99 });
    expect(unlock).toHaveBeenCalledTimes(1);
  });
});
