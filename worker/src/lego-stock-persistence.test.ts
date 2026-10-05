/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./lib/lego-stock', async original => ({
  ...await original<typeof import('./lib/lego-stock')>(), checkLegoStock: vi.fn(),
}));
vi.mock('./routes/set-detail-refresh', () => ({ scheduleSetDetailRefresh: vi.fn(), pushEbaySoldUpdate: vi.fn() }));
import { applyTestTables } from './test-schema';
import { checkLegoStock, legoStockUpdate, normalizeLegoStockResult } from './lib/lego-stock';
import { setsRoute as sets } from './routes/sets';
import { invalidateSetDetail } from './lib/edge-cache';
const db = (env as any).DB as D1Database;
beforeEach(async () => {
  vi.clearAllMocks();
  await invalidateSetDetail('12345-1');
  await applyTestTables(db, ['lego_sets', 'set_minifigs', 'set_market_ext', 'set_value_history']);
  await db.prepare(`INSERT INTO lego_sets (set_num,name,lego_in_stock,lego_retiring_soon,lego_availability,lego_checked_at,retail_price)
    VALUES ('12345-1','Set',1,1,'in_stock','2020-01-01',100)`).run();
  await db.prepare(`UPDATE lego_sets SET retired=0, brickset_enriched_at=datetime('now')`).run();
});
it.each([{ retail_price_usd: 90 }, { retiring_soon: false }])('set-detail waitUntil writer preserves unknown stock on %j', async observed => {
  vi.mocked(checkLegoStock).mockResolvedValue(normalizeLegoStockResult(observed));
  const ctx = createExecutionContext();
  const response = await sets.fetch(new Request('http://localhost/12345-1'), env as any, ctx);
  expect(response.status).toBe(200);
  await waitOnExecutionContext(ctx);
  expect(checkLegoStock).toHaveBeenCalled();
  const row = await db.prepare(`SELECT lego_in_stock,lego_retiring_soon,lego_availability,lego_checked_at FROM lego_sets`).first();
  expect(row).toEqual({ lego_in_stock: 1, lego_retiring_soon: 'retiring_soon' in observed ? 0 : 1, lego_availability: 'in_stock', lego_checked_at: '2020-01-01' });
});
it('shared on-demand and scheduled writer preserves unknown stock and its clock on a price-only observation', async () => {
  const stock = normalizeLegoStockResult({ retail_price_usd: 90 })!;
  await legoStockUpdate(db, '12345-1', stock).run();
  expect(await db.prepare(`SELECT lego_in_stock,lego_retiring_soon,lego_availability,lego_checked_at,retail_price FROM lego_sets`).first())
    .toEqual({ lego_in_stock: 1, lego_retiring_soon: 1, lego_availability: 'in_stock', lego_checked_at: '2020-01-01', retail_price: 90 });
});
it('shared writer clears only an explicitly observed warning without rejuvenating old stock', async () => {
  await legoStockUpdate(db, '12345-1', normalizeLegoStockResult({ retiring_soon: false })!).run();
  expect(await db.prepare(`SELECT lego_in_stock,lego_retiring_soon,lego_checked_at FROM lego_sets`).first())
    .toEqual({ lego_in_stock: 1, lego_retiring_soon: 0, lego_checked_at: '2020-01-01' });
});
