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
import { formulaValuation, isLikelyRetired, isPlausibleMarketValue } from './lib/valuation';
import { blendMarketValue } from './lib/market-sources';

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
    (env as any).EBAY_SOLD_COMPS_ENABLED = '1';
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

  it('requires both eBay secrets and does not fall back to legacy APIs', async () => {
    __resetEbayTokenCacheForTests();
    (env as any).EBAY_APP_ID = 'ebay-app-id';
    (env as any).EBAY_SOLD_COMPS_ENABLED = '1';
    (env as any).EBAY_CLIENT_SECRET = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();

    try {
      const result = await fetchEbaySoldPrices('75192', 'Millennium Falcon', env as any, { recordHealth: false });
      expect(result.source).toBe('marketplace_insights');
      expect(result.status).toBe('unconfigured');
      expect(result.error).toContain('EBAY_APP_ID and EBAY_CLIENT_SECRET');
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      __resetEbayTokenCacheForTests();
    }
  });

  it('returns unauthorized when the OAuth token request fails', async () => {
    __resetEbayTokenCacheForTests();
    (env as any).EBAY_APP_ID = 'ebay-app-id';
    (env as any).EBAY_SOLD_COMPS_ENABLED = '1';
    (env as any).EBAY_CLIENT_SECRET = 'ebay-client-secret';
    const seenUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      seenUrls.push(String(url));
      return Promise.resolve(new Response(JSON.stringify({ error: 'invalid_client' }), { status: 403 }));
    });

    try {
      const result = await fetchEbaySoldPrices('75192', 'Millennium Falcon', env as any, { recordHealth: false });
      expect(result.status).toBe('unauthorized');
      expect(result.new_value).toBeNull();
      expect(result.used_value).toBeNull();
      expect(result.error).toContain('invalid_client');
      expect(isEbayAccessError(result.error)).toBe(true);
      expect(seenUrls.some(url => url.includes('FindingService') || url.includes('/sch/i.html'))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      __resetEbayTokenCacheForTests();
    }
  });

  it('stops after the first Marketplace Insights access denial', async () => {
    __resetEbayTokenCacheForTests();
    (env as any).EBAY_APP_ID = 'ebay-app-id';
    (env as any).EBAY_SOLD_COMPS_ENABLED = '1';
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
      expect(seenUrls.some(url => url.includes('FindingService') || url.includes('/sch/i.html'))).toBe(false);
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

  it('high-appreciation theme outgrows a budget theme over time (equal pieces+age)', () => {
    // Post-calibration, the premium lives in appreciation, not retail MSRP:
    // a retired Star Wars set ends up worth more than a retired Friends set
    // of identical pieces and age. (Holds under both old and new constants.)
    const sw = formulaValuation({ pieces: 500, theme: 'Star Wars', retired: true, year: 2012, minifigs: 0 });
    const fr = formulaValuation({ pieces: 500, theme: 'Friends', retired: true, year: 2012, minifigs: 0 });
    expect(sw.current_value).toBeGreaterThan(fr.current_value);
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
// isLikelyRetired — age-based retirement inference for the bulk catalog
// ---------------------------------------------------------------------------
describe('isLikelyRetired', () => {
  const yr = new Date().getFullYear();
  it('treats sets past the ~2-year shelf life as retired', () => {
    expect(isLikelyRetired(yr - 3)).toBe(true);
    expect(isLikelyRetired(yr - 10)).toBe(true);
  });
  it('treats current/recent sets as still on shelf', () => {
    expect(isLikelyRetired(yr)).toBe(false);
    expect(isLikelyRetired(yr - 1)).toBe(false);
  });
  it('returns false for missing/zero year', () => {
    expect(isLikelyRetired(undefined)).toBe(false);
    expect(isLikelyRetired(null)).toBe(false);
    expect(isLikelyRetired(0)).toBe(false);
  });
  it('drives appreciation: an aged set out-values an identical brand-new one', () => {
    // The bug fix: the bulk import used to pin every set to MSRP (retired:false).
    // Inferring retirement from age lets the formula apply appreciation.
    const aged = formulaValuation({ pieces: 800, theme: 'Star Wars', year: yr - 12, retired: isLikelyRetired(yr - 12) });
    const fresh = formulaValuation({ pieces: 800, theme: 'Star Wars', year: yr, retired: isLikelyRetired(yr) });
    expect(aged.current_value).toBeGreaterThan(fresh.current_value);
  });
});

// ---------------------------------------------------------------------------
// barcode backfill resume state
// ---------------------------------------------------------------------------
describe('blendMarketValue (valuation v2)', () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 200 * 86_400_000).toISOString();

  it('returns null when there is no market data', () => {
    const r = blendMarketValue({ valuation_method: 'formula_bulk', current_value: 20 });
    expect(r.value).toBeNull();
    expect(r.confidence).toBeNull();
  });

  it('uses a single fresh BrickLink sold value with its lot range as the band', () => {
    const r = blendMarketValue({ valuation_method: 'market', bl_new_value: 100, bl_new_qty: 12, bl_cached_at: now, bl_new_min: 90, bl_new_max: 115 });
    expect(r.value).toBe(100);
    expect(r.low).toBe(90);
    expect(r.high).toBe(115);
    expect(r.confidence).toBe('medium');
  });

  it('blends two fresh sold sources and rates confidence high', () => {
    const r = blendMarketValue({ valuation_method: 'market', bl_new_value: 100, bl_new_qty: 10, bl_cached_at: now, ebay_new_value: 120, ebay_new_qty: 10, ebay_new_cached_at: now });
    expect(r.value).toBeGreaterThan(100);
    expect(r.value).toBeLessThan(120);
    expect(r.confidence).toBe('high');
    expect(r.low).toBe(100);
    expect(r.high).toBe(120);
  });

  it('drops a gross outlier source', () => {
    const r = blendMarketValue({ valuation_method: 'market', bl_new_value: 100, bl_new_qty: 10, bl_cached_at: now, ebay_new_value: 105, ebay_new_qty: 10, ebay_new_cached_at: now, bo_new_value: 900, bo_cached_at: now });
    expect(r.value).toBeLessThanOrEqual(106);
    expect(r.high).toBeLessThanOrEqual(120);
  });

  it('includes eBay asking as a discounted, low-confidence soft signal', () => {
    const r = blendMarketValue({ valuation_method: 'formula_bulk', ebay_ask_value: 200, ebay_ask_qty: 5, ebay_ask_cached_at: now });
    expect(r.value).toBe(170);          // 200 × 0.85 haircut
    expect(r.confidence).toBe('low');   // asks never count as a sold source
    expect(r.basis.some(b => b.id === 'ebay_ask')).toBe(true);
  });

  it('ignores asking prices entirely when real comps exist (fallback only)', () => {
    const r = blendMarketValue({
      valuation_method: 'market',
      bl_new_value: 100, bl_new_qty: 10, bl_cached_at: now,
      ebay_new_value: 104, ebay_new_qty: 10, ebay_new_cached_at: now,
      ebay_ask_value: 200, ebay_ask_qty: 5, ebay_ask_cached_at: now,
    });
    expect(r.confidence).toBe('high');                              // two fresh sold sources
    expect(r.basis.some(b => b.id === 'ebay_ask')).toBe(false);    // ask dropped — comps present
    expect(r.value).toBeLessThanOrEqual(104);                      // no upward drag from the ask
  });

  it('treats a stale-only source as low confidence', () => {
    const r = blendMarketValue({ valuation_method: 'market', bl_new_value: 50, bl_new_qty: 3, bl_cached_at: old });
    expect(r.value).toBe(50);
    expect(r.confidence).toBe('low');
  });

  it('uses BrickEconomy current_value when it is the method', () => {
    const r = blendMarketValue({ valuation_method: 'brickeconomy', current_value: 300, be_cached_at: now });
    expect(r.value).toBe(300);
    expect(r.confidence).toBe('medium');
  });
});

describe('isPlausibleMarketValue (BrickEconomy mismatch guard)', () => {
  it('rejects a value that grossly exceeds a corroborating ask (UNICEF Van case)', () => {
    expect(isPlausibleMarketValue(10153, { retailPrice: 6.49, pieces: 59, corroborators: [13.62] })).toBe(false);
  });
  it('trusts a high value confirmed by a comp (UCS rare: ask agrees)', () => {
    expect(isPlausibleMarketValue(3052, { retailPrice: 39.99, pieces: 188, corroborators: [3000] })).toBe(true);
  });
  it('rejects a value far above even its asking price (Cloud City case)', () => {
    expect(isPlausibleMarketValue(15878, { retailPrice: 99.99, pieces: 707, corroborators: [3907] })).toBe(false);
  });
  it('rejects a value far above retail when nothing corroborates it', () => {
    expect(isPlausibleMarketValue(4800, { retailPrice: 29.99, pieces: 169 })).toBe(false);
  });
  it('applies a tighter ceiling to large sets', () => {
    expect(isPlausibleMarketValue(15878, { retailPrice: 99.99, pieces: 707 })).toBe(false);
  });
  it('accepts a normal market value', () => {
    expect(isPlausibleMarketValue(140, { retailPrice: 100, pieces: 300 })).toBe(true);
  });
  it('does not block when neither retail nor a comp is known', () => {
    expect(isPlausibleMarketValue(9999, {})).toBe(true);
  });
});

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

// ---------------------------------------------------------------------------
// integration circuit breaker
// ---------------------------------------------------------------------------
describe('integration circuit breaker', () => {
  it('opens, reports blocked, and clears', async () => {
    const db = (env as any).DB as D1Database;
    await db.prepare('DROP TABLE IF EXISTS integration_health').run();
    await db.prepare(`CREATE TABLE integration_health (
      service TEXT PRIMARY KEY, last_ok_at TEXT, last_fail_at TEXT, last_error TEXT,
      ok_count INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
      blocked_until TEXT
    )`).run();
    const { setIntegrationBlock, clearIntegrationBlock, isIntegrationBlocked } = await import('./lib/integration-health');

    expect(await isIntegrationBlocked(env as any, 'ebay')).toBe(false);

    await setIntegrationBlock(env as any, 'ebay', 6);
    expect(await isIntegrationBlocked(env as any, 'ebay')).toBe(true);

    await clearIntegrationBlock(env as any, 'ebay');
    expect(await isIntegrationBlocked(env as any, 'ebay')).toBe(false);
  });

  it('treats an expired block as not blocked', async () => {
    const db = (env as any).DB as D1Database;
    await db.prepare('DROP TABLE IF EXISTS integration_health').run();
    await db.prepare(`CREATE TABLE integration_health (
      service TEXT PRIMARY KEY, last_ok_at TEXT, last_fail_at TEXT, last_error TEXT,
      ok_count INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
      blocked_until TEXT
    )`).run();
    await db.prepare(
      `INSERT INTO integration_health (service, blocked_until) VALUES ('ebay', datetime('now', '-1 hour'))`
    ).run();
    const { isIntegrationBlocked } = await import('./lib/integration-health');
    expect(await isIntegrationBlocked(env as any, 'ebay')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tiered valuation expiry
// ---------------------------------------------------------------------------
describe('valuationExpiryModifier', () => {
  it('holds market-backed valuations for a day', async () => {
    const { valuationExpiryModifier } = await import('./lib/valuation');
    expect(valuationExpiryModifier('brickeconomy')).toBe('+1 day');
    expect(valuationExpiryModifier('market')).toBe('+1 day');
  });

  it('keeps slow-moving eBay sold comps for a week', async () => {
    const { valuationExpiryModifier } = await import('./lib/valuation');
    expect(valuationExpiryModifier('ebay_sold')).toBe('+7 days');
    expect(valuationExpiryModifier('ebay_rss')).toBe('+7 days');
  });

  it('retries low-confidence estimates within hours', async () => {
    const { valuationExpiryModifier } = await import('./lib/valuation');
    expect(valuationExpiryModifier('ai')).toBe('+12 hours');
    expect(valuationExpiryModifier('formula_bulk')).toBe('+12 hours');
  });

  it('defaults unknown methods to a day', async () => {
    const { valuationExpiryModifier } = await import('./lib/valuation');
    expect(valuationExpiryModifier('something_new')).toBe('+1 day');
  });
});
