/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runPriceChartingEnrich } from './jobs/pricecharting-enrich';
import { clearSourceConfigCache, saveSourceConfig } from './lib/source-config';
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
    await applyTestTables(db, [
      'lego_sets', 'set_market_ext', 'user_collection', 'user_wishlist', 'api_quota',
      'app_settings', 'pricing_source_map', 'pricing_signals', 'set_valuation_state',
      'pricing_write_ledger', 'set_value_history',
    ]);
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
    const enabled = { ...env, PRICECHARTING_TOKEN: 'tok', PRICECHARTING_VERIFIED_ENABLED: '1' } as any;
    await saveSourceConfig(enabled, { pricecharting: { enabled: true, weight: 0 } } as any);
    clearSourceConfigCache();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'success', id: '6910', 'console-name': 'LEGO Creator',
      'new-price': 12250, 'cib-price': 9250, 'loose-price': 5000, 'sales-volume': 100,
    }), { status: 200 })));

    const r = await runPriceChartingEnrich(enabled, { concurrency: 1 });

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

  // `legacy:<set_num>` is a synthetic id minted by pricecharting-verify so a
  // price-agreement promotion has a mapping key when lego_sets.pc_id is empty.
  // It is not a PriceCharting product id — 5,531 verified mappings carried one
  // and the job spent 100 calls a day on /product?id=legacy:… 404s, which is why
  // production read "updated 0 · found 0 · processed 100" every single run.
  const enableJob = async () => {
    const enabled = { ...env, PRICECHARTING_TOKEN: 'tok', PRICECHARTING_VERIFIED_ENABLED: '1' } as any;
    await saveSourceConfig(enabled, { pricecharting: { enabled: true, weight: 0 } } as any);
    clearSourceConfigCache();
    return enabled;
  };

  it('ignores a synthetic legacy: mapping and rediscovers the real product id', async () => {
    await seedSets(1);
    await db.prepare(`
      INSERT INTO pricing_source_map (source, source_item_id, set_num, status, match_method, match_confidence)
      VALUES ('pricecharting', 'legacy:1000-1', '1000-1', 'verified', 'price_agreement', 0.85)
    `).run();
    const enabled = await enableJob();
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: any) => {
      urls.push(String(u));
      return new Response(JSON.stringify({
        status: 'success', id: '6910', 'console-name': 'LEGO Creator',
        'product-name': 'LEGO Set 1000', 'new-price': 12250,
      }), { status: 200 });
    }));

    const r = await runPriceChartingEnrich(enabled, { concurrency: 1 });

    expect(urls.some((u) => u.includes('legacy%3A') || u.includes('legacy:'))).toBe(false);
    expect(r.discovered).toBe(1); // "found" is no longer structurally pinned at 0
    expect(r.updated).toBe(1);
    // The real id replaces the placeholder rather than sitting beside it.
    const ids = await db.prepare(
      `SELECT source_item_id FROM pricing_source_map WHERE source='pricecharting' AND set_num='1000-1'`,
    ).all<{ source_item_id: string }>();
    expect(ids.results.map((x) => x.source_item_id)).toEqual(['6910']);
  });

  it('stamps an attempt marker on a miss so it stops re-filling the queue', async () => {
    await seedSets(1);
    const enabled = await enableJob();
    // A set PriceCharting does not carry. pc_cached_at is success-only, so
    // without the marker this same set heads every future batch forever.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'error' }), { status: 404 })));

    const first = await runPriceChartingEnrich(enabled, { concurrency: 1 });
    expect(first.processed).toBe(1);
    expect(first.updated).toBe(0);
    const ext = await db.prepare(`SELECT pc_attempted_at FROM set_market_ext WHERE set_num='1000-1'`)
      .first<{ pc_attempted_at: string }>();
    expect(ext?.pc_attempted_at).toBeTruthy();

    const second = await runPriceChartingEnrich(enabled, { concurrency: 1 });
    expect(second.processed).toBe(0);
  });
});
