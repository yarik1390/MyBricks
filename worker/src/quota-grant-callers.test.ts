/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';

vi.mock('./lib/bricklink', () => ({ fetchMinifigPricing: vi.fn() }));
vi.mock('./lib/ebay-firecrawl', () => ({ fetchMinifigEbaySoldViaFirecrawl: vi.fn() }));
vi.mock('./lib/pricing-flags', () => ({
  ebaySoldCompsEnabled: vi.fn(() => true),
  firecrawlEnabled: vi.fn(() => false),
}));
vi.mock('./lib/ebay', () => ({
  buildEbayAskUpdate: vi.fn(() => null),
  buildEbaySoldUpdate: vi.fn(() => null),
  ebaySoldHasValue: vi.fn(() => false),
  fetchEbayActiveListings: vi.fn(async () => null),
  fetchEbaySoldPrices: vi.fn(async () => ({ status: 'no_data' })),
  isEbayAccessError: vi.fn(() => false),
}));
vi.mock('./lib/integration-health', () => ({
  isIntegrationBlocked: vi.fn(async () => false),
  recordIntegrationHealth: vi.fn(async () => undefined),
  setIntegrationBlock: vi.fn(async () => undefined),
}));
vi.mock('./lib/market-sources', () => ({
  recomputeBlendedValues: vi.fn(async () => undefined),
}));
vi.mock('./lib/source-config', () => ({
  sourceEnabled: vi.fn(async () => true),
}));

import { fetchMinifigPricing } from './lib/bricklink';
import { fetchEbayActiveListings, fetchEbaySoldPrices } from './lib/ebay';
import { QUOTA_CAPS, quotaDay } from './lib/api-quota';
import { runMinifigVerify } from './jobs/minifig-verify';
import { runValuateMinifigs } from './jobs/valuate-minifigs';
import { runEbayAskBackfill, runEbayBackfill } from './jobs/ebay-backfill';

const db = (env as any).DB as D1Database;
const mockMinifigPricing = vi.mocked(fetchMinifigPricing);
const mockEbaySold = vi.mocked(fetchEbaySoldPrices);
const mockEbayAsk = vi.mocked(fetchEbayActiveListings);

async function leaveQuota(service: 'bricklink' | 'ebay', remaining: number): Promise<void> {
  const cap = QUOTA_CAPS[service];
  await db.prepare(
    'INSERT INTO api_quota (service, day, used, cap) VALUES (?1, ?2, ?3, ?4)',
  ).bind(service, quotaDay(), cap - remaining, cap).run();
}

const seedFig = (figNum: string, blId: string | null = null) => db.prepare(`
  INSERT INTO minifigs (fig_num, name, appears_in_sets, bl_id)
  VALUES (?, ?, 5, ?)
`).bind(figNum, figNum, blId);

const seedCandidate = (figNum: string, blId: string) => db.prepare(`
  INSERT INTO minifig_bl_candidates (fig_num, bl_id) VALUES (?, ?)
`).bind(figNum, blId);

const seedSet = (setNum: string) => db.prepare(`
  INSERT INTO lego_sets (set_num, name) VALUES (?, ?)
`).bind(setNum, `Set ${setNum}`);

describe('batch jobs enforce reserveQuota grants', () => {
  beforeEach(async () => {
    await applyTestTables(db, [
      'lego_sets', 'minifigs', 'user_minifigs', 'set_minifigs',
      'minifig_bl_candidates', 'bricklink_minifigs', 'pricing_anomalies',
      'user_collection', 'user_wishlist', 'api_quota',
    ]);
    mockMinifigPricing.mockReset();
    mockMinifigPricing.mockResolvedValue({ value: null, lots: 0 });
    mockEbaySold.mockClear();
    mockEbayAsk.mockClear();
  });

  it('makes zero minifig-verifier provider calls when quota accounting fails closed', async () => {
    await db.batch([
      seedFig('fig-fail'),
      seedCandidate('fig-fail', 'bl-a'),
      seedCandidate('fig-fail', 'bl-b'),
    ]);
    await db.prepare('DROP TABLE api_quota').run();

    const result = await runMinifigVerify(env as any);

    expect(mockMinifigPricing).not.toHaveBeenCalled();
    expect(result).toMatchObject({ verified: 0, checked: 0 });
  });

  it('caps minifig-verifier calls at a partial grant without deciding an incomplete group', async () => {
    await db.batch([
      seedFig('fig-partial'),
      seedCandidate('fig-partial', 'bl-a'),
      seedCandidate('fig-partial', 'bl-b'),
    ]);
    await leaveQuota('bricklink', 1);

    const result = await runMinifigVerify(env as any);

    expect(mockMinifigPricing).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ verified: 0, checked: 1 });
    const rows = await db.prepare(`
      SELECT status, checked_at FROM minifig_bl_candidates WHERE fig_num='fig-partial'
    `).all<{ status: string; checked_at: string | null }>();
    expect(rows.results.every((row) => row.status === 'pending' && row.checked_at == null)).toBe(true);
  });

  it('makes zero valuation BrickLink calls when quota accounting fails closed', async () => {
    await db.batch([seedFig('fig-fail', 'bl-fail')]);
    await db.prepare('DROP TABLE api_quota').run();

    const result = await runValuateMinifigs(env as any, { limit: 5 });

    expect(mockMinifigPricing).not.toHaveBeenCalled();
    expect(result).toMatchObject({ figs: 1, priced: 0, missed: 0 });
  });

  it('makes zero valuation BrickLink calls and does not cool rows when the grant is zero', async () => {
    await db.batch([seedFig('fig-zero', 'bl-zero')]);
    await leaveQuota('bricklink', 0);

    const result = await runValuateMinifigs(env as any, { limit: 5 });

    expect(mockMinifigPricing).not.toHaveBeenCalled();
    expect(result).toMatchObject({ figs: 1, priced: 0, missed: 0 });
    const row = await db.prepare(`SELECT cached_at FROM minifigs WHERE fig_num='fig-zero'`)
      .first<{ cached_at: string | null }>();
    expect(row?.cached_at).toBeNull();
  });

  it('caps valuation BrickLink calls at a partial per-item grant', async () => {
    await db.batch([
      seedFig('fig-one', 'bl-one'),
      seedFig('fig-two', 'bl-two'),
    ]);
    await leaveQuota('bricklink', 1);

    const result = await runValuateMinifigs(env as any, { limit: 5 });

    expect(mockMinifigPricing).toHaveBeenCalledTimes(1);
    expect(result.missed).toBe(1);
    const rows = await db.prepare(`SELECT cached_at FROM minifigs ORDER BY fig_num`)
      .all<{ cached_at: string | null }>();
    expect(rows.results.filter((row) => row.cached_at != null)).toHaveLength(1);
  });

  it('makes zero eBay sold calls when quota accounting fails closed', async () => {
    await db.batch([seedSet('100-1')]);
    await db.prepare('DROP TABLE api_quota').run();

    const result = await runEbayBackfill({ ...env, EBAY_SOLD_COMPS_ENABLED: '1' } as any);

    expect(mockEbaySold).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it('makes zero eBay sold calls when its quota grant is zero', async () => {
    await db.batch([seedSet('100-1')]);
    await leaveQuota('ebay', 0);

    const result = await runEbayBackfill({ ...env, EBAY_SOLD_COMPS_ENABLED: '1' } as any);

    expect(mockEbaySold).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it('requires the two sold-condition units per set before starting an eBay sold item', async () => {
    await db.batch([seedSet('100-1'), seedSet('200-1')]);
    await leaveQuota('ebay', 3);

    const result = await runEbayBackfill(
      { ...env, EBAY_SOLD_COMPS_ENABLED: '1' } as any,
      { limit: 2 },
    );

    expect(mockEbaySold).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
  });

  it('makes zero eBay ask calls when quota accounting fails closed', async () => {
    await db.batch([seedSet('100-1')]);
    await db.prepare('DROP TABLE api_quota').run();

    const result = await runEbayAskBackfill(env as any);

    expect(mockEbayAsk).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  it('caps eBay ask calls at the partial per-item grant', async () => {
    await db.batch([seedSet('100-1'), seedSet('200-1')]);
    await leaveQuota('ebay', 1);

    const result = await runEbayAskBackfill(env as any, { limit: 2 });

    expect(mockEbayAsk).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(1);
  });
});
