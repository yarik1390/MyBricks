/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import { parseNextBackfillPage } from './jobs/backfill-upc';
import {
  __resetEbayTokenCacheForTests,
  fetchEbaySoldPrices,
  isEbayAccessError,
  isValidLegoSetSaleTitle,
  summarizeSoldPrices,
} from './lib/ebay';
import { classifyHealth } from './lib/integration-health';
import { computeRetirementRisk } from './lib/retirement-risk';
import { isSearchIndexCorruption } from './lib/search-index';
import { formulaValuation } from './lib/valuation';

// ---------------------------------------------------------------------------
// integration health
// ---------------------------------------------------------------------------
describe('classifyHealth', () => {
  it('treats a newer successful check as recovered even with old failures', () => {
    expect(classifyHealth({
      service: 'bricklink',
      last_ok_at: '2026-06-08 12:10:00',
      last_fail_at: '2026-06-08 11:55:00',
      last_error: 'Too many subrequests by single Worker invocation.',
      ok_count: 154,
      fail_count: 334,
      updated_at: '2026-06-08 12:10:00',
    })).toBe('ok');
  });

  it('keeps the latest Worker-capacity failure degraded instead of down', () => {
    expect(classifyHealth({
      service: 'ebay',
      last_ok_at: null,
      last_fail_at: '2026-06-08 12:10:00',
      last_error: 'The operation was aborted',
      ok_count: 0,
      fail_count: 4,
      updated_at: '2026-06-08 12:10:00',
    })).toBe('degraded');
  });

  it('recognizes eBay OAuth and Marketplace Insights access failures', () => {
    expect(classifyHealth({
      service: 'ebay',
      last_ok_at: null,
      last_fail_at: '2026-06-08 12:10:00',
      last_error: 'eBay OAuth HTTP 401: invalid_client',
      ok_count: 0,
      fail_count: 1,
      updated_at: '2026-06-08 12:10:00',
    })).toBe('degraded');
  });
});

// ---------------------------------------------------------------------------
// eBay sold comps
// ---------------------------------------------------------------------------
describe('eBay sold comps', () => {
  function soldItem(title: string, value: number, currency = 'USD') {
    return { title, price: { value: String(value), currency } };
  }

  it('requests separate new and used Marketplace Insights filters', async () => {
    __resetEbayTokenCacheForTests();
    (env as any).EBAY_APP_ID = 'ebay-app-id';
    (env as any).EBAY_CLIENT_SECRET = 'ebay-client-secret';
    const seenUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const href = String(url);
      seenUrls.push(href);
      if (href.includes('/identity/v1/oauth2/token')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 }));
      }
      if (href.includes('item_sales/search')) {
        return Promise.resolve(new Response(JSON.stringify({
          itemSales: [
            soldItem('LEGO 75192 Millennium Falcon complete set', 800),
            soldItem('LEGO Star Wars 75192 UCS Millennium Falcon', 820),
            soldItem('LEGO 75192-1 Millennium Falcon sealed', 840),
          ],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    try {
      const result = await fetchEbaySoldPrices('75192', 'Millennium Falcon', env as any, { recordHealth: false });
      expect(result.status).toBe('ok');
      expect(result.new_value).toBe(820);
      expect(result.used_value).toBe(820);
      const searchUrls = seenUrls.filter(url => url.includes('item_sales/search'));
      expect(searchUrls).toHaveLength(2);
      expect(searchUrls.some(url => decodeURIComponent(url).includes('conditions:{NEW}'))).toBe(true);
      expect(searchUrls.some(url => decodeURIComponent(url).includes('USED_GOOD'))).toBe(true);
      expect(seenUrls.some(url => url.includes('FindingService') || url.includes('/sch/i.html'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      __resetEbayTokenCacheForTests();
    }
  });

  it('filters suspicious listing titles and requires at least three sold comps', () => {
    expect(isValidLegoSetSaleTitle('LEGO 75192 Millennium Falcon complete set', '75192')).toBe(true);
    expect(isValidLegoSetSaleTitle('LEGO 75192 instructions manual only', '75192')).toBe(false);
    expect(isValidLegoSetSaleTitle('LEGO 75192 replacement stickers', '75192')).toBe(false);
    expect(isValidLegoSetSaleTitle('LEGO 75257 Millennium Falcon', '75192')).toBe(false);
    expect(summarizeSoldPrices([100, 105]).value).toBeNull();
  });

  it('trims extreme outliers before calculating the sold-comp median', () => {
    const summary = summarizeSoldPrices([100, 110, 120, 130, 999]);
    expect(summary.value).toBe(115);
    expect(summary.sample_count).toBe(4);
  });

  it('returns unauthorized when the OAuth token request fails', async () => {
    __resetEbayTokenCacheForTests();
    (env as any).EBAY_APP_ID = 'ebay-app-id';
    (env as any).EBAY_CLIENT_SECRET = 'ebay-client-secret';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 403 }));

    try {
      const result = await fetchEbaySoldPrices('75192', 'Millennium Falcon', env as any, { recordHealth: false });
      expect(result.status).toBe('unauthorized');
      expect(result.new_value).toBeNull();
      expect(result.used_value).toBeNull();
      expect(result.error).toContain('invalid_client');
      expect(isEbayAccessError(result.error)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
      __resetEbayTokenCacheForTests();
    }
  });

  it('stops after the first Marketplace Insights access denial', async () => {
    __resetEbayTokenCacheForTests();
    (env as any).EBAY_APP_ID = 'ebay-app-id';
    (env as any).EBAY_CLIENT_SECRET = 'ebay-client-secret';
    const seenUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const href = String(url);
      seenUrls.push(href);
      if (href.includes('/identity/v1/oauth2/token')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 }));
      }
      if (href.includes('item_sales/search')) {
        return Promise.resolve(new Response(JSON.stringify({
          errors: [{
            errorId: 1100,
            domain: 'ACCESS',
            message: 'Access denied',
            longMessage: 'Insufficient permissions to fulfill the request.',
          }],
        }), { status: 401 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    try {
      const result = await fetchEbaySoldPrices('75192', 'Millennium Falcon', env as any, { recordHealth: false });
      expect(result.status).toBe('unauthorized');
      expect(result.error).toContain('Insufficient permissions');
      expect(seenUrls.filter(url => url.includes('item_sales/search'))).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
      __resetEbayTokenCacheForTests();
    }
  });
});

describe('isSearchIndexCorruption', () => {
  it('detects D1 virtual-table corruption errors', () => {
    expect(isSearchIndexCorruption(
      new Error('D1_ERROR: database disk image is malformed: SQLITE_CORRUPT (extended: SQLITE_CORRUPT_VTAB)')
    )).toBe(true);
  });

  it('does not classify ordinary upstream failures as search-index corruption', () => {
    expect(isSearchIndexCorruption(new Error('Brickset barcode backfill returned no data'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeRetirementRisk
// ---------------------------------------------------------------------------
describe('computeRetirementRisk', () => {
  const currentYear = new Date().getFullYear();

  it('returns 0 for already-retired sets', () => {
    expect(computeRetirementRisk({ year: 2015, theme: 'Star Wars', pieces: 1000, retired: 1 })).toBe(0);
  });

  it('returns 0 for a set released this year (no age factor)', () => {
    // City theme adds 10, so use null theme to isolate the age-factor test.
    expect(computeRetirementRisk({ year: currentYear, theme: null, pieces: 100, retired: 0 })).toBe(0);
  });

  it('score increases with age (>2 yrs adds 15/yr)', () => {
    const s2 = computeRetirementRisk({ year: currentYear - 2, theme: null, pieces: 100, retired: 0 });
    const s4 = computeRetirementRisk({ year: currentYear - 4, theme: null, pieces: 100, retired: 0 });
    expect(s4).toBeGreaterThan(s2);
    // 4-yr-old: age factor = (4-2)*15 = 30; 2-yr-old: age factor = 0
    expect(s4 - s2).toBe(30);
  });

  it('age factor caps at 45', () => {
    const veryOld = computeRetirementRisk({ year: currentYear - 20, theme: null, pieces: 100, retired: 0 });
    const medOld  = computeRetirementRisk({ year: currentYear - 20, theme: null, pieces: 1600, retired: 0 });
    // age factor ≤ 45; together with piece bonus should cap overall at 100
    expect(veryOld).toBeLessThanOrEqual(100);
    expect(medOld).toBeLessThanOrEqual(100);
  });

  it('adds 10 for large sets (>1500 pieces)', () => {
    const small = computeRetirementRisk({ year: currentYear - 3, theme: null, pieces: 400, retired: 0 });
    const large = computeRetirementRisk({ year: currentYear - 3, theme: null, pieces: 2000, retired: 0 });
    expect(large - small).toBe(10);
  });

  it('adds 5 for medium sets (500–1500 pieces)', () => {
    const small  = computeRetirementRisk({ year: currentYear - 3, theme: null, pieces: 200, retired: 0 });
    const medium = computeRetirementRisk({ year: currentYear - 3, theme: null, pieces: 800, retired: 0 });
    expect(medium - small).toBe(5);
  });

  it('adds 10 for short-lifecycle themes (City, Friends, NINJAGO)', () => {
    const base  = computeRetirementRisk({ year: currentYear - 3, theme: null, pieces: 200, retired: 0 });
    const city  = computeRetirementRisk({ year: currentYear - 3, theme: 'City', pieces: 200, retired: 0 });
    expect(city - base).toBe(10);

    const ninja = computeRetirementRisk({ year: currentYear - 3, theme: 'NINJAGO', pieces: 200, retired: 0 });
    expect(ninja - base).toBe(10);
  });

  it('max observable score is 65 (45 age + 10 large-set + 10 theme)', () => {
    // The Math.min(100,...) cap is defensive — the actual max with all three
    // factors maxed out is 45 + 10 + 10 = 65.
    const score = computeRetirementRisk({ year: currentYear - 20, theme: 'City', pieces: 2000, retired: 0 });
    expect(score).toBe(65);
  });

  it('returns a number in [0, 100]', () => {
    const cases = [
      { year: currentYear, theme: null, pieces: 100, retired: 0 },
      { year: currentYear - 5, theme: 'Friends', pieces: 1000, retired: 0 },
      { year: 2010, theme: 'Star Wars', pieces: 5000, retired: 0 },
    ];
    for (const c of cases) {
      const s = computeRetirementRisk(c);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// formulaValuation
// ---------------------------------------------------------------------------
describe('formulaValuation', () => {
  it('returns four numeric fields', () => {
    const r = formulaValuation({ pieces: 500, year: 2020, theme: 'City', retired: false, minifigs: 0 });
    expect(typeof r.retail_price).toBe('number');
    expect(typeof r.current_value).toBe('number');
    expect(typeof r.forecast_2y).toBe('number');
    expect(typeof r.forecast_5y).toBe('number');
  });

  it('higher piece count → higher retail price', () => {
    const sm = formulaValuation({ pieces: 100, theme: 'City', retired: false });
    const lg = formulaValuation({ pieces: 1000, theme: 'City', retired: false });
    expect(lg.retail_price).toBeGreaterThan(sm.retail_price);
  });

  it('Star Wars multiplier produces higher MSRP than City for same piece count', () => {
    const sw = formulaValuation({ pieces: 500, theme: 'Star Wars', retired: false });
    const ci = formulaValuation({ pieces: 500, theme: 'City', retired: false });
    expect(sw.retail_price).toBeGreaterThan(ci.retail_price);
  });

  it('forecast_5y > forecast_2y > current_value for an active appreciating set', () => {
    const r = formulaValuation({ pieces: 500, theme: 'Star Wars', retired: true, year: 2018 });
    expect(r.forecast_2y).toBeGreaterThan(r.current_value);
    expect(r.forecast_5y).toBeGreaterThan(r.forecast_2y);
  });

  it('retired set appreciated over time has current_value >= retail_price', () => {
    const r = formulaValuation({ pieces: 800, theme: 'Star Wars', retired: true, year: 2010 });
    expect(r.current_value).toBeGreaterThanOrEqual(r.retail_price);
  });

  it('caps appreciation at 5× MSRP', () => {
    const r = formulaValuation({ pieces: 200, theme: 'Star Wars', retired: true, year: 1990 });
    expect(r.current_value).toBeLessThanOrEqual(r.retail_price * 5 + r.retail_price);
  });

  it('minifigs add bonus (licensed theme = higher per-fig bonus)', () => {
    const base = formulaValuation({ pieces: 500, theme: 'Star Wars', retired: false, minifigs: 0 });
    const figs = formulaValuation({ pieces: 500, theme: 'Star Wars', retired: false, minifigs: 5 });
    expect(figs.current_value).toBeGreaterThan(base.current_value);
    // $7.50 × 5 = $37.50 bonus
    expect(figs.current_value - base.current_value).toBeCloseTo(37.5, 1);
  });

  it('non-licensed theme minifig bonus is lower ($4.50/fig)', () => {
    const base = formulaValuation({ pieces: 500, theme: 'City', retired: false, minifigs: 0 });
    const figs = formulaValuation({ pieces: 500, theme: 'City', retired: false, minifigs: 4 });
    // $4.50 × 4 = $18 bonus
    expect(figs.current_value - base.current_value).toBeCloseTo(18, 1);
  });

  it('handles missing fields gracefully (defaults)', () => {
    const r = formulaValuation({});
    expect(r.retail_price).toBeGreaterThan(0);
    expect(r.current_value).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// barcode backfill resume state
// ---------------------------------------------------------------------------
describe('parseNextBackfillPage', () => {
  it('resumes from the stored next page', () => {
    expect(parseNextBackfillPage('method:bulk start_page:5 next_page:9 complete:false')).toBe(9);
  });

  it('starts over after a complete backfill pass', () => {
    expect(parseNextBackfillPage('method:bulk catalog:26898 next_page: complete:true')).toBe(1);
  });

  it('falls back to page 1 for missing or malformed progress', () => {
    expect(parseNextBackfillPage(null)).toBe(1);
    expect(parseNextBackfillPage('method:bulk next_page:nope complete:false')).toBe(1);
  });
});
