import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('./lib/http', () => ({ fetchWithRetry: vi.fn() }));
import { fetchWithRetry } from './lib/http';
import { checkLegoStock, normalizeLegoStockResult, notRetiringIfUnreleased } from './lib/lego-stock';
import { parseLegoStockHtml } from './lib/brightdata-parsers';

const ld = (items: unknown) => `<script type="application/ld+json">${JSON.stringify(items)}</script>`;
const product = (sku: string, availability: string) => ({ '@type': 'Product', sku, offers: { availability: `https://schema.org/${availability}`, price: 99.99, priceCurrency: 'USD' } });

afterEach(() => vi.resetAllMocks());
describe('LEGO stock observation integrity', () => {
  it('keeps unknowns and accepts only strict boolean, positive finite price and allowed status', () => {
    expect(normalizeLegoStockResult({ in_stock: 'false', retiring_soon: 1, retail_price_usd: Infinity, availability: 'banana' })).toBeNull();
    expect(normalizeLegoStockResult({})).toBeNull();
    expect(normalizeLegoStockResult({ retail_price_usd: 0 })).toBeNull();
    expect(normalizeLegoStockResult({ in_stock: false, availability: ' SOLD_OUT ' })).toEqual({ in_stock: false, retiring_soon: null, retail_price_usd: null, availability: 'sold_out' });
    expect(normalizeLegoStockResult({ retiring_soon: false })).toMatchObject({ in_stock: null, retiring_soon: false });
  });

  it('ignores irrelevant recommendation and navigation HTML in the free fallback', async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue(new Response(`<nav>Retiring soon AddToCart</nav>${ld(product('99999', 'InStock'))}`));
    expect(await checkLegoStock('12345-1')).toBeNull();
    expect(parseLegoStockHtml('<nav>AddToCart Retiring soon</nav>', '12345')).toBeNull();
    expect(parseLegoStockHtml(`<script>{"recommendations":[{"id":"99999","availabilityStatus":"IN_STOCK"}]}</script>`, '12345')).toBeNull();
  });

  it('scopes each JSON-LD product node even when recommendations share the script', () => {
    expect(parseLegoStockHtml(`<nav>Retiring soon</nav>${ld([product('99999', 'InStock'), product('12345', 'OutOfStock')])}`, '12345')).toMatchObject({ in_stock: false, retiring_soon: null, availability: 'out_of_stock', retail_price_usd: 99.99 });
  });

  it('scopes inline state to the requested product and rejects unrelated or invalid status', () => {
    const page = `<script>${JSON.stringify({ products: [{ id: '12345', availabilityStatus: 'BACK_ORDER', price: { centAmount: 12345, currencyCode: 'USD' } }, { id: '99999', availabilityStatus: 'RETIRING' }] })}</script>`;
    expect(parseLegoStockHtml(page, '12345')).toMatchObject({ availability: 'back_order', retail_price_usd: 123.45, retiring_soon: null });
    expect(parseLegoStockHtml(`<script>{"id":"12345","availabilityStatus":"NOT_PRE_ORDER"}</script>`, '12345')).toBeNull();
  });

  it('does not invent a retirement observation from a price-only product and keeps prerelease clearing', () => {
    expect(parseLegoStockHtml(ld({ '@type': 'Product', sku: '12345', offers: { price: 20, priceCurrency: 'USD' } }), '12345')).toMatchObject({ in_stock: null, retiring_soon: null, retail_price_usd: 20 });
    expect(notRetiringIfUnreleased({ in_stock: null, retiring_soon: true, availability: 'pre_order' })).toMatchObject({ retiring_soon: false });
  });
});
