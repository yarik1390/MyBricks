/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let responder: (url: URL) => unknown = () => ({ itemSummaries: [] });

vi.mock('./lib/http', () => ({
  fetchWithRetry: vi.fn(),
  fetchTracked: vi.fn(async (_env: unknown, _svc: string, url: string) => {
    if (url.includes('/oauth2/token')) return new Response(JSON.stringify({ access_token: 't', expires_in: 7200 }));
    calls.push(url);
    return new Response(JSON.stringify(responder(new URL(url))));
  }),
}));
vi.mock('./lib/source-config', async (orig) => ({ ...(await orig<any>()), sourceEnabled: vi.fn(async () => true) }));

import { __resetEbayTokenCacheForTests, fetchEbayActiveListings, validGtin } from './lib/ebay';

const env = { EBAY_APP_ID: 'app', EBAY_CLIENT_SECRET: 'secret' } as any;
const item = (title: string, value: number) => ({ title, price: { value: String(value), currency: 'USD' } });

describe('fetchEbayActiveListings', () => {
  beforeEach(() => { calls.length = 0; __resetEbayTokenCacheForTests(); });

  it('validates barcodes', () => {
    expect(validGtin('673419281614')).toBe('673419281614');
    expect(validGtin('5702016914313')).toBe('5702016914313');
    expect(validGtin('12345')).toBeNull();
    expect(validGtin('67341928161X')).toBeNull();
    expect(validGtin(null)).toBeNull();
  });

  it('searches the LEGO Complete Sets category by barcode first', async () => {
    responder = () => ({ itemSummaries: [
      item('LEGO 75192 Millennium Falcon', 800), item('LEGO 75192 UCS Falcon', 820), item('LEGO Star Wars 75192', 790),
    ] });
    const out = await fetchEbayActiveListings('75192-1', 'Falcon', env, { upc: '673419281614' });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.searchParams.get('gtin')).toBe('673419281614');
    expect(url.searchParams.get('q')).toBeNull();
    expect(url.searchParams.get('category_ids')).toBe('19006');
    expect(out?.ask_qty).toBe(3);
  });

  it('falls back to the keyword search once when the barcode finds too few listings', async () => {
    responder = (url) => url.searchParams.get('gtin')
      ? { itemSummaries: [item('LEGO 75192 Millennium Falcon', 800)] }
      : { itemSummaries: [item('LEGO 75192 Falcon', 810), item('LEGO 75192 sealed', 790), item('LEGO 75192 new', 800)] };
    const out = await fetchEbayActiveListings('75192-1', 'Falcon', env, { upc: '673419281614' });
    expect(calls).toHaveLength(2);
    const fallback = new URL(calls[1]);
    expect(fallback.searchParams.get('q')).toBeTruthy();
    expect(fallback.searchParams.get('category_ids')).toBe('19006');
    expect(out?.ask_qty).toBe(3);
  });

  it('uses only the keyword search (still in the sets category) without a valid barcode', async () => {
    responder = () => ({ itemSummaries: [] });
    await fetchEbayActiveListings('75192-1', 'Falcon', env, { upc: 'n/a' });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.searchParams.get('gtin')).toBeNull();
    expect(url.searchParams.get('category_ids')).toBe('19006');
  });
});
