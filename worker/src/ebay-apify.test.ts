/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchEbaySoldViaApifyBatch } from './lib/ebay-apify';

const liveEnv = { APIFY_API_TOKEN: 'apify-test-token' } as any;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockSucceededRun(rows: unknown[]) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }))
    .mockResolvedValueOnce(jsonResponse({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'dataset-1' } }))
    .mockResolvedValueOnce(jsonResponse(rows));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchEbaySoldViaApifyBatch', () => {
  it('parses sold chains, computes per-set medians, and rejects MOC/wrong-set noise', async () => {
    // Real memo23 output shape (verified 2026-08-11): ALL listing rows first
    // (chains complete in arbitrary order, here 75313 then 75192), then ALL
    // sold-price-summary rows at the end with plain-keyword queries and counts.
    // Each chain's RAW row count (valid + malformed + noise) equals the
    // summary `count`; the parser preserves every row during slicing and only
    // filters MOC/wrong-set/noise AFTER the chain boundary is fixed.
    mockSucceededRun([
      // Chain 1: 75313. 5 valid + 1 malformed row (count: 6).
      { itemId: '1', title: 'LEGO Star Wars 75313 AT-AT UCS New Sealed', priceValue: 1300, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-01' },
      { itemId: '2', title: 'LEGO 75313 AT-AT Imperial Walker Factory Sealed', priceValue: 1500, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-03T12:00:00Z' },
      { itemId: '3', title: 'LEGO 75313 UCS AT-AT Brand New', priceValue: 1700, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-07-20' },
      { itemId: 'noise-moc', title: 'MOC display stand for LEGO 75313', priceValue: 40, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-04' },
      { itemId: 'noise-other', title: 'LEGO 75054 AT-AT Brand New', priceValue: 200, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-05' },
      // A malformed/raw actor row still counts toward chain 1. The parser must
      // preserve it during slicing and only filter it after the boundary is set.
      { itemId: 'malformed', currency: 'USD', sold: true },
      // Chain 2: 75192. 3 valid rows (count: 3).
      { itemId: '4', title: 'LEGO Star Wars 75192 Millennium Falcon New Sealed', priceValue: 700, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-01' },
      { itemId: '5', title: 'LEGO 75192 Millennium Falcon Factory Sealed', priceValue: 800, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-03T12:00:00Z' },
      { itemId: '6', title: 'LEGO 75192 UCS Falcon Brand New', priceValue: 900, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-07-20' },
      // Chain 3: R2-D2 (75379). 3 valid rows (count: 3). Its plain summary
      // query contains a SECOND digit run (R2-D2) that must not confuse
      // set-number matching.
      { itemId: '7', title: 'LEGO 75379 R2-D2 New Sealed', priceValue: 80, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-02' },
      { itemId: '8', title: 'LEGO 75379 R2-D2 Factory Sealed', priceValue: 90, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-04' },
      { itemId: '9', title: 'LEGO 75379 R2-D2 Brand New', priceValue: 100, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-07-30' },
      // A noise row in its own chain slot (count: 1) — wrong-set noise with no
      // summary would otherwise break chain boundaries.
      { itemId: 'noise-requested-other', title: 'LEGO 10307 Eiffel Tower New Sealed', priceValue: 100, currency: 'USD', condition: 'New', sold: true, soldDate: '2026-08-06' },
      // Summaries at the END, one per chain, in the same completion order.
      { type: 'sold-price-summary', query: 'LEGO 75313 AT-AT', count: 6, medianPrice: 1500, totalSold: 193 },
      { type: 'sold-price-summary', query: 'LEGO 75192 Millennium Falcon', count: 3, medianPrice: 800, totalSold: 177 },
      { type: 'sold-price-summary', query: 'LEGO 75379 R2-D2', count: 3, medianPrice: 90, totalSold: 12 },
      { type: 'sold-price-summary', query: 'LEGO 10307 Eiffel Tower', count: 1, medianPrice: 100, totalSold: 5 },
    ]);

    const result = await fetchEbaySoldViaApifyBatch(['75313-1', '75192-1', '75379-1'], liveEnv);

    expect(result['75313-1']).toMatchObject({
      status: 'ok', new_value: 1500, new_count: 3, new_last_sold: '2026-08-03',
    });
    expect(result['75192-1']).toMatchObject({
      status: 'ok', new_value: 800, new_count: 3, new_last_sold: '2026-08-03',
    });
    expect(result['75379-1']).toMatchObject({
      status: 'ok', new_value: 90, new_count: 3, new_last_sold: '2026-08-04',
    });
  });

  it('returns disabled for every requested set when the token is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchEbaySoldViaApifyBatch(['75192-1', '10307-1'], {} as any);

    expect(result['75192-1']).toMatchObject({ status: 'disabled', new_value: null, new_count: 0 });
    expect(result['10307-1']).toMatchObject({ status: 'disabled', new_value: null, new_count: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error for every requested set when the actor run fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'run-1', defaultDatasetId: 'dataset-1' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'run-1', status: 'FAILED', statusMessage: 'actor crashed' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchEbaySoldViaApifyBatch(['75192-1', '10307-1'], liveEnv);

    expect(result['75192-1']).toMatchObject({ status: 'error', error: expect.stringMatching(/FAILED/) });
    expect(result['10307-1']).toMatchObject({ status: 'error', error: expect.stringMatching(/FAILED/) });
  });

  it('returns no_data when sold rows do not match the requested set', async () => {
    mockSucceededRun([
      { itemId: 'noise', title: 'LEGO 75313 AT-AT Brand New', priceValue: 600, currency: 'USD', sold: true, soldDate: '2026-08-01' },
      { type: 'sold-price-summary', query: 'https://www.ebay.com/sch/i.html?_nkw=LEGO+75192&LH_ItemCondition=1000', count: 1 },
    ]);

    const result = await fetchEbaySoldViaApifyBatch(['75192-1'], liveEnv);

    expect(result['75192-1']).toMatchObject({ status: 'no_data', new_value: null, new_count: 0 });
  });

  it('starts one batched sold run with condition-filtered search URLs', async () => {
    const fetchMock = mockSucceededRun([]);

    await fetchEbaySoldViaApifyBatch(['75192-1', '10307-1'], liveEnv);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.apify.com/v2/acts/memo23~ebay-search-scraper-ppe/runs');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${liveEnv.APIFY_API_TOKEN}` });
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ mode: 'sold', marketplace: 'ebay.com', detailedItems: false, maxItems: 5 });
    expect(body.startUrls).toEqual([
      { url: 'https://www.ebay.com/sch/i.html?_nkw=LEGO+75192&LH_ItemCondition=1000' },
      { url: 'https://www.ebay.com/sch/i.html?_nkw=LEGO+10307&LH_ItemCondition=1000' },
    ]);
  });
});
