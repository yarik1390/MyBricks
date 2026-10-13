/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runValuateSets } from './jobs/valuate-sets';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

// Every non-BrickLink source disabled so the run exercises exactly the BrickLink
// path. CACHE_KV off so fetchSetPricing always hits the (stubbed) network.
const blCreds = {
  BRICKLINK_CONSUMER_KEY: 'ck', BRICKLINK_CONSUMER_SECRET: 'cs',
  BRICKLINK_TOKEN: 'tok', BRICKLINK_TOKEN_SECRET: 'ts',
};
const noSources = {
  GEMINI_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '',
  FIRECRAWL_API_KEY: '', FIRECRAWL_API_KEYS: '',
  EBAY_APP_ID: '',
};
const OPTS = {
  scope: 'all' as const,
  includeSupplemental: false,
  includeEbay: false,
  includeEbaySold: false,
  includeAiFallback: false,
  includeMinifigs: false,
  limit: 5,
  sourceRetries: 0,
  sourceTimeoutMs: 2000,
};

async function seedDueSet(over: Record<string, unknown> = {}) {
  const cols = {
    set_num: '99001-1', name: 'Regress Set', year: 2015, pieces: 500, retired: 0,
    valuation_method: 'formula_bulk', be_value_new: null, bl_new_value: null,
    retail_price: null, ebay_ask_value: null, ...over,
  } as Record<string, unknown>;
  const keys = Object.keys(cols);
  await db.prepare(
    `INSERT INTO lego_sets (${keys.join(',')}) VALUES (${keys.map((_, i) => `?${i + 1}`).join(',')})`,
  ).bind(...keys.map(k => cols[k])).run();
}

const blNodataAt = async (setNum: string) =>
  db.prepare(`SELECT bl_nodata_at FROM set_market_ext WHERE set_num=?`).bind(setNum).first<{ bl_nodata_at: string | null }>();

describe('runValuateSets — BrickLink no-data backoff correctness', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health']);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('does NOT stamp bl_nodata_at when BrickLink fails transiently (503)', async () => {
    await seedDueSet();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream boom', { status: 503 })));

    await runValuateSets({ ...env, CACHE_KV: undefined, ...blCreds, ...noSources } as any, OPTS);

    // A transient source outage must be retried next run, never cached as no-data.
    expect(await blNodataAt('99001-1')).toBeNull();
  });

  it('DOES stamp bl_nodata_at on a genuine empty guide (<5 sold lots)', async () => {
    await seedDueSet();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ meta: { code: 200 }, data: { unit_quantity: 2, qty_avg_price: '50.00' } }),
      { status: 200 },
    )));

    await runValuateSets({ ...env, CACHE_KV: undefined, ...blCreds, ...noSources } as any, OPTS);

    const ext = await blNodataAt('99001-1');
    expect(ext?.bl_nodata_at).toBeTruthy(); // real no-data → 90-day backoff stamped
  });

  it('rejects an implausible BrickEconomy value and falls back to the formula', async () => {
    // $10k on a $6 retail set with no corroborator → implausible → must not persist.
    await seedDueSet({ set_num: '99002-1', name: 'Cheap Vintage', pieces: 100, be_value_new: 10000, retail_price: 6 });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // No BrickLink creds → no market source rescues it → formula estimate is written.
    await runValuateSets({ ...env, CACHE_KV: undefined, ...noSources, BRICKLINK_CONSUMER_KEY: '' } as any, OPTS);

    const row = await db.prepare(`SELECT valuation_method, current_value FROM lego_sets WHERE set_num='99002-1'`)
      .first<{ valuation_method: string; current_value: number }>();
    expect(row!.valuation_method).toBe('formula_bulk');
    expect(row!.current_value).toBeGreaterThan(0);
    expect(row!.current_value).toBeLessThan(1000); // formula, NOT the rejected $10k
    expect(fetchSpy).not.toHaveBeenCalled(); // no BL key configured → no network at all
  });
});

describe('runValuateSets — BrickLink lanes call BrickLink even when BrickEconomy answered', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'set_valuation_state', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health']);
  });
  afterEach(() => vi.unstubAllGlobals());

  const guide = () => vi.fn(async () => new Response(
    JSON.stringify({ meta: { code: 200 }, data: { unit_quantity: 12, total_quantity: 12, qty_avg_price: '130.00', avg_price: '130.00', min_price: '110.00', max_price: '150.00' } }),
    { status: 200 },
  ));
  const blRow = async (setNum: string) => db.prepare(`SELECT bl_new_value, bl_cached_at FROM lego_sets WHERE set_num=?`)
    .bind(setNum).first<{ bl_new_value: number | null; bl_cached_at: string | null }>();

  it('conflict tie-break fetches a BrickLink guide for a BrickEconomy-valued set', async () => {
    await seedDueSet({ set_num: '99010-1', be_value_new: 120, retail_price: 99.99, brickset_msrp: 99.99, valuation_method: 'brickeconomy', current_value: 120 });
    await db.prepare(`INSERT INTO set_valuation_state (set_num, condition, flags_json) VALUES ('99010-1','new_sealed','["source_conflict"]')`).run();
    const fetchSpy = guide();
    vi.stubGlobal('fetch', fetchSpy);

    await runValuateSets({ ...env, CACHE_KV: undefined, ...blCreds, ...noSources } as any, { ...OPTS, conflictTiebreak: true });

    expect(fetchSpy).toHaveBeenCalled();
    expect((await blRow('99010-1'))?.bl_cached_at).toBeTruthy();
  });

  it('BrickLink refresh lane refreshes a stale guide for a BrickEconomy-valued set', async () => {
    await seedDueSet({ set_num: '99011-1', be_value_new: 120, retail_price: 99.99, brickset_msrp: 99.99, valuation_method: 'brickeconomy', current_value: 120, bl_new_value: 100, bl_cached_at: '2026-01-01 00:00:00' });
    const fetchSpy = guide();
    vi.stubGlobal('fetch', fetchSpy);

    await runValuateSets({ ...env, CACHE_KV: undefined, ...blCreds, ...noSources } as any, { ...OPTS, blStale: true });

    expect(fetchSpy).toHaveBeenCalled();
    expect((await blRow('99011-1'))?.bl_cached_at).not.toBe('2026-01-01 00:00:00');
  });
});

// The valuation budget is finite (~5,000 BrickLink calls/day), so WHAT the queue
// picks is as consequential as how fast it runs.
describe('selectDueSets queue composition', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health']);
  });

  const seed = (setNum: string, theme: string, value: number, sourced: boolean) =>
    db.prepare(
      `INSERT INTO lego_sets (set_num, name, theme, year, pieces, retired, current_value, blended_value, bl_new_value, valuation_method)
       VALUES (?1, ?1, ?2, 1995, 500, 1, ?3, ?3, ?4, 'formula_bulk')`,
    ).bind(setNum, theme, value, sourced ? value : null).run();

  it('never spends budget on themes that are not priceable sets', async () => {
    // Gear averages ONE piece and Books seven — merchandise, not sets. Together
    // they are half of the catalogue rows with no market evidence, so letting
    // them into the queue burns calls no source could ever satisfy.
    await seed('GEAR-1', 'Gear', 400, false);
    await seed('BOOK-1', 'Books', 400, false);
    await seed('REAL-1', 'Town', 400, false);

    const { selectDueSets } = await import('./jobs/valuate-select');
    const { results } = await selectDueSets(env as any, {
      scope: 'all', options: { limit: 20 },
      includeSupplemental: false, includeEbay: false, includeEbaySold: false, includeAiFallback: false,
    });
    const picked = results.map((r) => r.set_num);
    expect(picked).toContain('REAL-1');
    expect(picked).not.toContain('GEAR-1');
    expect(picked).not.toContain('BOOK-1');
  });

  it('puts a valuable set with NO market evidence ahead of a richer sourced one', async () => {
    // A $100+ set on a formula with nothing corroborating it is the worst state
    // on a page that leads with a price, and without this rank it is perpetually
    // out-competed by fresher, higher-value rows.
    await seed('SOURCED-9000', 'Town', 9000, true);
    await seed('BARE-150', 'Town', 150, false);

    const { selectDueSets } = await import('./jobs/valuate-select');
    const { results } = await selectDueSets(env as any, {
      scope: 'all', options: { limit: 20, prioritizeValue: false },
      includeSupplemental: false, includeEbay: false, includeEbaySold: false, includeAiFallback: false,
    });
    expect(results[0].set_num).toBe('BARE-150');
  });

  it('does not treat Duplo or Universal Building Set as unpriceable', async () => {
    // Old and thinly traded, but real buildable sets — some worth four figures.
    await seed('DUP-1', 'Duplo', 300, false);
    await seed('UBS-1', 'Universal Building Set', 660, false);

    const { selectDueSets } = await import('./jobs/valuate-select');
    const { results } = await selectDueSets(env as any, {
      scope: 'all', options: { limit: 20 },
      includeSupplemental: false, includeEbay: false, includeEbaySold: false, includeAiFallback: false,
    });
    const picked = results.map((r) => r.set_num);
    expect(picked).toContain('DUP-1');
    expect(picked).toContain('UBS-1');
  });
});

describe('runValuateSets — BrickLink discovery fallbacks for thin sets', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'set_valuation_state', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health']);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ext = (setNum: string) => db.prepare(
    `SELECT bl_thin_value, bl_thin_qty, bl_ask_value, bl_ask_qty, bl_fallback_cached_at, bl_nodata_at FROM set_market_ext WHERE set_num=?`,
  ).bind(setNum).first<Record<string, unknown>>();
  // Sold guide with 3 lots; stock guide with four listings, one absurd.
  const guides = () => vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const data = url.includes('guide_type=stock')
      ? { unit_quantity: 4, qty_avg_price: '900.00', price_detail: [
        { unit_price: '140.00', quantity: 1 }, { unit_price: '150.00', quantity: 1 },
        { unit_price: '160.00', quantity: 1 }, { unit_price: '2500.00', quantity: 1 }] }
      : { unit_quantity: 3, qty_avg_price: '120.00', min_price: '100.00', max_price: '135.00' };
    return new Response(JSON.stringify({ meta: { code: 200 }, data }), { status: 200 });
  });

  it('keeps a 1-4 lot sold guide and the median listing for a BrickEconomy-only set', async () => {
    await seedDueSet({ set_num: '99020-1', retired: 1, be_value_new: 130, retail_price: 99.99, brickset_msrp: 99.99, valuation_method: 'brickeconomy', current_value: 130 });
    const fetchSpy = guides();
    vi.stubGlobal('fetch', fetchSpy);

    await runValuateSets({ ...env, CACHE_KV: undefined, ...blCreds, ...noSources } as any, { ...OPTS, blDiscovery: true });

    const urls = fetchSpy.mock.calls.map(([u]) => String(u));
    expect(urls.filter(u => u.includes('guide_type=stock'))).toHaveLength(1);
    // An older set also gets the used guide, the value model's best anchor.
    expect(urls.filter(u => u.includes('new_or_used=U'))).toHaveLength(1);
    const used = await db.prepare(`SELECT used_value, bl_used_qty FROM lego_sets WHERE set_num='99020-1'`).first<Record<string, unknown>>();
    expect(used?.used_value).toBe(120);
    expect(used?.bl_used_qty).toBe(3);
    const row = await ext('99020-1');
    expect(row?.bl_thin_value).toBe(120);
    expect(row?.bl_thin_qty).toBe(3);
    expect(row?.bl_ask_value).toBe(155); // median, not the $900 average
    expect(row?.bl_ask_qty).toBe(4);
    expect(row?.bl_fallback_cached_at).toBeTruthy();
    expect(row?.bl_nodata_at).toBeTruthy(); // still backed off from the sold guide
    // The fallbacks never pose as a NEW sold guide.
    const ls = await db.prepare(`SELECT bl_new_value FROM lego_sets WHERE set_num='99020-1'`).first<Record<string, unknown>>();
    expect(ls?.bl_new_value).toBeNull();
  });

  it('does not stamp no-data when the listings call fails, so the set is retried', async () => {
    await seedDueSet({ set_num: '99021-1', be_value_new: 130, retail_price: 99.99, brickset_msrp: 99.99, valuation_method: 'brickeconomy', current_value: 130 });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('guide_type=stock')
      ? new Response('boom', { status: 503 })
      : new Response(JSON.stringify({ meta: { code: 200 }, data: { unit_quantity: 2, qty_avg_price: '120.00' } }), { status: 200 })));

    await runValuateSets({ ...env, CACHE_KV: undefined, ...blCreds, ...noSources } as any, { ...OPTS, blDiscovery: true });

    const row = await ext('99021-1');
    expect(row?.bl_nodata_at ?? null).toBeNull();
    expect(row?.bl_thin_value ?? null).toBeNull();
  });
});
