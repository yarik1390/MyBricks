/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/lego-stock', () => ({ checkLegoStock: vi.fn() }));
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
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'api_quota']);
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
    expect(r).toMatchObject({ processed: 1, updated: 1 });
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
});
