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
  BRIGHTDATA_API_TOKEN: '', BRIGHTDATA_API_TOKENS: '', EBAY_APP_ID: '',
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
