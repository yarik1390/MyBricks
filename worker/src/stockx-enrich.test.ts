/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';
vi.mock('./lib/stockx', () => ({ fetchStockXViaFirecrawl: vi.fn() }));
vi.mock('./lib/market-sources', () => ({ recomputeBlendedValues: vi.fn() }));
import { fetchStockXViaFirecrawl } from './lib/stockx';
import { runStockXEnrich } from './jobs/stockx-enrich';
import { recomputeBlendedValues } from './lib/market-sources';

const db = (env as any).DB as D1Database;
const withKey = { ...env, STOCKX_ENABLED: '1', FIRECRAWL_API_KEY: 'fc-test' } as any;
const mockFetch = vi.mocked(fetchStockXViaFirecrawl);

describe('StockX quote and attempt clocks', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health']);
    await db.prepare(`INSERT INTO lego_sets (set_num,name,year,bl_new_value,current_value) VALUES ('10307-1','Tower',2022,700,700)`).run();
    await db.prepare(`INSERT INTO set_market_ext (set_num,stockx_ask,stockx_cached_at) VALUES ('10307-1',750,'2020-01-01')`).run();
  });

  it.each(['error', 'no_data', 'rejected'] as const)('does not freshen the retained quote on %s', async status => {
    mockFetch.mockResolvedValue(status === 'rejected'
      ? { status: 'ok', ask: 99999, url: 'https://stockx.com/wrong' }
      : { status, ask: null, url: null });
    const result = await runStockXEnrich(withKey);
    expect(result.updated).toBe(0);
    expect(await db.prepare(`SELECT stockx_ask,stockx_cached_at,stockx_attempt_status FROM set_market_ext`).first())
      .toMatchObject({ stockx_ask: 750, stockx_cached_at: '2020-01-01', stockx_attempt_status: status });
    expect((await runStockXEnrich(withKey)).processed).toBe(0);
    expect(recomputeBlendedValues).not.toHaveBeenCalled();
    await db.prepare(`UPDATE set_market_ext SET stockx_attempted_at=datetime('now','-2 hours')`).run();
    expect((await runStockXEnrich(withKey)).processed).toBe(status === 'error' ? 1 : 0);
  });

  it('rotates daily provider failures after their hourly cooldown', async () => {
    await db.prepare(`INSERT INTO lego_sets(set_num,name,year,bl_new_value,current_value) VALUES('10308-1','Other',2022,700,700)`).run();
    mockFetch.mockResolvedValue({ status: 'error', ask: null, url: null });
    await runStockXEnrich(withKey, { limit: 1 });
    expect(mockFetch.mock.calls[0][0]).toBe('10307-1');
    await db.prepare(`UPDATE set_market_ext SET stockx_attempted_at=datetime('now','-25 hours')`).run();
    mockFetch.mockClear();
    await runStockXEnrich(withKey, { limit: 1 });
    expect(mockFetch.mock.calls[0][0]).toBe('10308-1');
  });

  it('stores an accepted quote with its own observation time and reblends', async () => {
    mockFetch.mockResolvedValue({ status: 'ok', ask: 800, url: 'https://stockx.com/lego-tower' });
    expect(await runStockXEnrich(withKey)).toMatchObject({ processed: 1, updated: 1, failed: 0 });
    const row = await db.prepare(`SELECT stockx_ask,stockx_cached_at,stockx_attempt_status FROM set_market_ext`).first<any>();
    expect(row.stockx_ask).toBe(800);
    expect(row.stockx_cached_at).not.toBe('2020-01-01');
    expect(row.stockx_attempt_status).toBe('ok');
    expect(vi.mocked(recomputeBlendedValues).mock.calls.map(call => call[1])).toEqual([['10307-1']]);
  });
});
