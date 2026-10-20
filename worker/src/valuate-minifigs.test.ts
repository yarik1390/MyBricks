/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/bricklink', () => ({ fetchMinifigPricing: vi.fn() }));
import { fetchMinifigPricing } from './lib/bricklink';
import { runValuateMinifigs } from './jobs/valuate-minifigs';

const db = (env as any).DB as D1Database;
const mockBl = vi.mocked(fetchMinifigPricing);
const fcEnv = { ...env } as any;

const seedFig = (figNum: string, name: string, year: number | null = 2014, appears = 5) =>
  db.prepare(`INSERT INTO minifigs (fig_num, name, year, appears_in_sets) VALUES (?, ?, ?, ?)`)
    .bind(figNum, name, year, appears);
const seedBl = (blId: string, normName: string, year: number | null) =>
  db.prepare(`INSERT INTO bricklink_minifigs (bl_id, name, norm_name, year) VALUES (?, ?, ?, ?)`)
    .bind(blId, normName, normName, year);
const readFig = (figNum: string) =>
  db.prepare(`SELECT bl_id, current_value, cached_at, source, ebay_value FROM minifigs WHERE fig_num=?`)
    .bind(figNum).first<{ bl_id: string | null; current_value: number | null; cached_at: string | null; source: string | null; ebay_value: number | null }>();

describe('runValuateMinifigs', () => {
  beforeEach(async () => {
    mockBl.mockReset();
    mockBl.mockResolvedValue(null as any);
    await applyTestTables(db, [
      'lego_sets', 'minifigs', 'user_minifigs', 'set_minifigs',
      'minifig_bl_candidates', 'bricklink_minifigs', 'pricing_anomalies', 'api_quota',
    ]);
  });

  it('rotates an unpriceable fig without freshening its price observation', async () => {
    await seedFig('fig-1', 'Nobody In Particular').run();

    const r = await runValuateMinifigs(fcEnv, { limit: 5 });

    expect(r).toMatchObject({ figs: 1, priced: 0, missed: 1 });
    const fig = await readFig('fig-1');
    expect(fig!.cached_at).toBeNull(); // attempt cooldown is separate
    expect((await db.prepare(`SELECT attempted_at FROM minifigs WHERE fig_num='fig-1'`).first<any>()).attempted_at).toBeTruthy();
    expect(fig!.current_value).toBeNull(); // but no value invented
    // ...and the second run no longer sees it.
    expect((await runValuateMinifigs(fcEnv, { limit: 5 })).figs).toBe(0);
  });

  it('preserves prior clocks on BrickLink failures', async () => {
    await db.batch([seedFig('fig-held', 'Batman'), seedBl('bat001','batman',2014)]);
    await db.prepare(`UPDATE minifigs SET current_value=30, cached_at='2020-01-01',
      ebay_value=35, ebay_cached_at='2020-01-02' WHERE fig_num='fig-held'`).run();
    mockBl.mockRejectedValue(new Error('provider down'));
    const result = await runValuateMinifigs(fcEnv, { limit: 5 });
    expect(result).toMatchObject({ failed: 1, priced: 0 });
    expect(await readFig('fig-held')).toMatchObject({ current_value: 30, cached_at: '2020-01-01', ebay_value: 35 });
    expect((await db.prepare(`SELECT ebay_cached_at FROM minifigs WHERE fig_num='fig-held'`).first<any>()).ebay_cached_at)
      .toBe('2020-01-02');
  });

  it('resolves a BrickLink id when its name merely extends ours', async () => {
    await db.batch([
      seedFig('fig-3', 'Sir Fangar', 2014),
      seedBl('loc087', 'sir fangar heavy armor cape', 2014),
    ]);
    mockBl.mockResolvedValue({ value: 30, lots: 6 } as any);

    const r = await runValuateMinifigs(fcEnv, { limit: 5 });

    expect(r).toMatchObject({ bl_matched: 1, priced: 1 });
    const fig = await readFig('fig-3');
    expect(fig!.bl_id).toBe('loc087');
    expect(fig!.current_value).toBe(30);
  });

  it('resolves the longest BrickLink prefix when our name is the more specific one', async () => {
    await db.batch([
      seedFig('fig-4', 'Batman, Black Suit, Black Cape and Cowl', 2012),
      seedBl('bat001', 'batman black suit', 2012),
      seedBl('bat000', 'batman black', 2011),
    ]);
    mockBl.mockResolvedValue({ value: 15, lots: 2 } as any);

    await runValuateMinifigs(fcEnv, { limit: 5 });

    expect((await readFig('fig-4'))!.bl_id).toBe('bat001');
  });

  it('parks rival extensions for price verification instead of guessing an id', async () => {
    await db.batch([
      seedFig('fig-5', 'Gorzan', 2014),
      seedBl('loc050', 'gorzan pearl gold heavy armor', 2014),
      seedBl('loc068', 'gorzan flat silver heavy armor', 2014),
    ]);

    const r = await runValuateMinifigs(fcEnv, { limit: 5 });

    expect(r).toMatchObject({ bl_matched: 0, parked: 1 });
    expect(mockBl).not.toHaveBeenCalled(); // no id -> no wasted BrickLink call
    expect((await readFig('fig-5'))!.bl_id).toBeNull();
    const parked = await db.prepare(
      `SELECT bl_id, status FROM minifig_bl_candidates WHERE fig_num='fig-5' ORDER BY bl_id`,
    ).all<{ bl_id: string; status: string }>();
    expect(parked.results.map((x) => x.bl_id)).toEqual(['loc050', 'loc068']);
    expect(parked.results.every((x) => x.status === 'pending')).toBe(true);
  });
});
