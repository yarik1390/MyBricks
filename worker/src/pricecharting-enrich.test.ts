/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runPriceChartingEnrich } from './jobs/pricecharting-enrich';
import { clearSourceConfigCache } from './lib/source-config';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const today = new Date().toISOString().slice(0, 10);

async function seedSets(n: number) {
  const stmts = [];
  for (let i = 0; i < n; i++) {
    stmts.push(db.prepare(
      `INSERT INTO lego_sets (set_num, name, year, pc_id, upc, pc_cached_at) VALUES (?1, ?2, 2015, ?3, ?4, NULL)`,
    ).bind(`${1000 + i}-1`, `Set ${i}`, `pc${i}`, `upc${i}`));
  }
  await db.batch(stmts);
}

describe('runPriceChartingEnrich', () => {
  beforeEach(async () => {
    clearSourceConfigCache();
    await applyTestTables(db, ['lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota', 'app_settings']);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('skips cleanly when PRICECHARTING_TOKEN is not set (no DB work)', async () => {
    const r = await runPriceChartingEnrich({ ...env, PRICECHARTING_TOKEN: '' } as any);
    expect(r.skipped).toMatch(/PRICECHARTING_TOKEN/);
    expect(r.processed).toBe(0);
  });

  it('stops before any API call when the daily PriceCharting quota is exhausted', async () => {
    await seedSets(3);
    // Pre-exhaust today's ledger (cap 500) so the batch-loop spendQuota gate trips
    // on the very first batch and breaks — no set is fetched or processed.
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('pricecharting', ?1, 500, 500)`).bind(today).run();
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const r = await runPriceChartingEnrich({ ...env, PRICECHARTING_TOKEN: 'tok' } as any, { concurrency: 3 });

    expect(r.processed).toBe(0);
    expect(r.updated).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled(); // quota gate ran BEFORE any fetch
  });

  it('writes PriceCharting values when quota is available', async () => {
    await seedSets(1);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'success', id: '6910', 'console-name': 'LEGO Creator',
      'new-price': 12250, 'cib-price': 9250, 'loose-price': 5000, 'sales-volume': 100,
    }), { status: 200 })));

    const r = await runPriceChartingEnrich({ ...env, PRICECHARTING_TOKEN: 'tok' } as any, { concurrency: 1 });

    expect(r.processed).toBe(1);
    expect(r.updated).toBe(1);
    const row = await db.prepare(`SELECT pc_new_value, pc_cached_at FROM lego_sets WHERE set_num='1000-1'`).first<{ pc_new_value: number; pc_cached_at: string }>();
    expect(row!.pc_new_value).toBe(122.5); // cents → dollars
    expect(row!.pc_cached_at).toBeTruthy();
    // Loose value + sales volume land in the side table.
    const ext = await db.prepare(`SELECT pc_loose_value, pc_sales_volume FROM set_market_ext WHERE set_num='1000-1'`).first<{ pc_loose_value: number; pc_sales_volume: number }>();
    expect(ext!.pc_loose_value).toBe(50);
    expect(ext!.pc_sales_volume).toBe(100);
    // Ledger recorded the spend.
    const q = await db.prepare(`SELECT used FROM api_quota WHERE service='pricecharting' AND day=?1`).bind(today).first<{ used: number }>();
    expect(q!.used).toBe(1);
  });
});
