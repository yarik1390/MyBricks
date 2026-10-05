/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/lego-stock', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/lego-stock')>(), checkLegoStock: vi.fn(),
}));
import { checkLegoStock } from './lib/lego-stock';
import { runLegoStockRefresh } from './jobs/lego-stock-refresh';
import { QUOTA_CAPS } from './lib/api-quota';

const db = (env as any).DB as D1Database;
const mockStock = vi.mocked(checkLegoStock);
const today = new Date().toISOString().slice(0, 10);
const withKey = { ...env, FIRECRAWL_API_KEY: 'fc', FIRECRAWL_DAILY_CREDITS: '' } as any;

// Only active OWNED/wishlisted sets are eligible.
async function seedOwnedActive(setNum = 'X-1') {
  await db.batch([
    db.prepare(`INSERT INTO lego_sets (set_num, name, retired, lego_checked_at) VALUES (?1,'S', 0, NULL)`).bind(setNum),
    db.prepare(`INSERT INTO user_collection (user_id, set_num) VALUES ('u1', ?1)`).bind(setNum),
  ]);
}
const checkedAt = (setNum: string) =>
  db.prepare(`SELECT lego_in_stock AS s, lego_retiring_soon AS r, retail_price AS p, lego_checked_at AS c FROM lego_sets WHERE set_num=?`).bind(setNum).first<any>();

describe('runLegoStockRefresh', () => {
  beforeEach(async () => {
    mockStock.mockReset();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota']);
  });

  it('skips when Firecrawl is disabled', async () => {
    const r = await runLegoStockRefresh({ ...env, FIRECRAWL_API_KEY: '', FIRECRAWL_API_KEYS: '' } as any);
    expect(r.skipped).toMatch(/ScrapingAnt, Bright Data, and Firecrawl disabled or unconfigured/);
  });

  it('skips when the daily Firecrawl ceiling is reached', async () => {
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('firecrawl', ?1, ?2, ?2)`).bind(today, QUOTA_CAPS.firecrawl).run();
    const r = await runLegoStockRefresh(withKey);
    expect(r.skipped).toMatch(/firecrawl daily ceiling/);
  });

  it('does nothing for sets that are neither owned nor wishlisted', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, retired, lego_checked_at) VALUES ('Z-1','Z', 0, NULL)`).run();
    const r = await runLegoStockRefresh(withKey);
    expect(r).toMatchObject({ processed: 0, updated: 0 });
    expect(mockStock).not.toHaveBeenCalled();
  });

  it('writes stock + retirement + availability + retail on a successful check', async () => {
    await seedOwnedActive();
    mockStock.mockResolvedValue({ in_stock: true, retiring_soon: true, availability: 'in_stock', retail_price_usd: 169.99 } as any);
    const r = await runLegoStockRefresh(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 1, failed: 0, no_data: 0, partial: 0 });
    const row = await checkedAt('X-1');
    expect(row.s).toBe(1);
    expect(row.r).toBe(1);
    expect(row.p).toBe(169.99);
    expect(row.c).toBeTruthy();
  });

  it('leaves lego_checked_at untouched on a transient failure', async () => {
    await seedOwnedActive();
    mockStock.mockResolvedValue(null as any); // runtime failure / protected page
    const r = await runLegoStockRefresh(withKey);
    expect(r).toMatchObject({ processed: 1, updated: 0 });
    expect((await checkedAt('X-1')).c).toBeNull(); // retried next run
  });

  it('preserves prior stock and warning on an unknown result', async () => {
    await seedOwnedActive();
    await db.prepare(`UPDATE lego_sets SET lego_in_stock=1, lego_retiring_soon=1,
      lego_availability='in_stock', lego_checked_at='2020-01-01' WHERE set_num='X-1'`).run();
    mockStock.mockResolvedValue({ in_stock: null, retiring_soon: null });
    expect(await runLegoStockRefresh(withKey)).toMatchObject({ processed: 1, updated: 0, no_data: 1, failed: 0 });
    expect(await checkedAt('X-1')).toMatchObject({ s: 1, r: 1, c: '2020-01-01' });
  });

  it('writes retirement-only data without rejuvenating stock', async () => {
    await seedOwnedActive();
    await db.prepare(`UPDATE lego_sets SET lego_in_stock=1, lego_retiring_soon=1,
      lego_availability='in_stock', lego_checked_at='2020-01-01' WHERE set_num='X-1'`).run();
    mockStock.mockResolvedValue({ in_stock: null, retiring_soon: false });
    expect(await runLegoStockRefresh(withKey)).toMatchObject({ processed: 1, updated: 1, partial: 1 });
    expect(await checkedAt('X-1')).toMatchObject({ s: 1, r: 0, c: '2020-01-01' });
    expect(await db.prepare(`SELECT lego_availability AS a FROM lego_sets WHERE set_num='X-1'`).first()).toEqual({ a: 'in_stock' });
  });

  it('preserves warning when only stock is observed and distinguishes thrown failure', async () => {
    await seedOwnedActive('X-1');
    await seedOwnedActive('Y-1');
    await db.prepare(`UPDATE lego_sets SET lego_retiring_soon=1 WHERE set_num='X-1'`).run();
    mockStock.mockImplementation(async (setNum) => {
      if (setNum === 'Y-1') throw new Error('transport');
      return { in_stock: false, retiring_soon: null, availability: 'sold_out' };
    });
    expect(await runLegoStockRefresh(withKey)).toMatchObject({ processed: 2, updated: 1, partial: 1, failed: 1, no_data: 0 });
    expect(await checkedAt('X-1')).toMatchObject({ s: 0, r: 1 });
    expect((await checkedAt('X-1')).c).toBeTruthy();
  });

  it.each(['unknown', 'partial', 'error'] as const)('rotates %s attempts before LIMIT without fabricating stock freshness', async status => {
    for (const id of ['A-1', 'B-1', 'C-1']) await seedOwnedActive(id);
    mockStock.mockImplementation(async id => {
      if (id === 'C-1') return { in_stock: true, retiring_soon: null, availability: 'in_stock' };
      if (status === 'error') throw new Error('transport');
      return status === 'partial' ? { in_stock: null, retiring_soon: null, retail_price_usd: 50 } : null;
    });
    expect((await runLegoStockRefresh(withKey, { limit: 1 })).processed).toBe(1);
    expect((await runLegoStockRefresh(withKey, { limit: 1 })).processed).toBe(1);
    expect((await runLegoStockRefresh(withKey, { limit: 1 })).updated).toBe(1);
    expect((await checkedAt('A-1')).c).toBeNull();
    expect((await checkedAt('B-1')).c).toBeNull();
    expect((await checkedAt('C-1')).c).toBeTruthy();
    await db.prepare(`UPDATE set_market_ext SET lego_attempted_at=datetime('now','-2 hours') WHERE set_num='A-1'`).run();
    expect((await runLegoStockRefresh(withKey, { limit: 1 })).processed).toBe(status === 'partial' ? 0 : 1);
  });

  it('rotates daily persistent failures even after the short cooldown has elapsed', async () => {
    for (const id of ['A-1', 'B-1', 'C-1']) await seedOwnedActive(id);
    mockStock.mockResolvedValue(null);
    for (const expected of ['A-1', 'B-1', 'C-1']) {
      await db.prepare(`UPDATE set_market_ext SET lego_attempted_at=datetime('now','-25 hours')`).run();
      mockStock.mockClear();
      expect((await runLegoStockRefresh(withKey, { limit: 1 })).processed).toBe(1);
      expect(mockStock.mock.calls[0][0]).toBe(expected);
    }
  });

  it('checks stock in bounded concurrent waves instead of serially', async () => {
    await seedOwnedActive('X-1');
    await seedOwnedActive('Y-1');
    let active = 0;
    let maxActive = 0;
    mockStock.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return null as any;
    });

    const r = await runLegoStockRefresh(withKey, { limit: 2 });

    expect(r).toMatchObject({ processed: 2, updated: 0 });
    expect(maxActive).toBe(2);
  });
});
