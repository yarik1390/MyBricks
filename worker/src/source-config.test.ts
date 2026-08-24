/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSourceConfig, saveSourceConfig, applySourceConfig, sourceEnabled,
  clearSourceConfigCache, DEFAULT_SOURCE_CONFIG,
} from './lib/source-config';
import { blendMarketValue, resetSourceWeightMultipliers } from './lib/market-sources';
import { spendQuota } from './lib/api-quota';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS app_settings').run();
  await db.prepare(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`).run();
  await db.prepare('DROP TABLE IF EXISTS api_quota').run();
  await db.prepare(`CREATE TABLE api_quota (service TEXT, day TEXT, used INTEGER NOT NULL DEFAULT 0, cap INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (service, day))`).run();
  clearSourceConfigCache();
  resetSourceWeightMultipliers();
}

describe('source-config', () => {
  beforeEach(freshSchema);

  it('returns defaults when nothing is stored', async () => {
    const cfg = await getSourceConfig(env as any);
    expect(cfg).toEqual(DEFAULT_SOURCE_CONFIG);
  });

  it('keeps the eBay sold-comps lane held while the ask lane follows tuning', async () => {
    // Master eBay switch is ON by default (Browse ask lane is sanctioned);
    // the scraped sold lane stays held regardless of any setting.
    const cfg = await getSourceConfig(env as any);
    expect(cfg.ebay.enabled).toBe(true);
    expect(await sourceEnabled(env as any, 'ebay')).toBe(true);
  });

  it('ebaySoldLaneEnabled is false in production-like envs and true only in tests with the escape hatch', async () => {
    const { ebaySoldLaneEnabled } = await import('./lib/source-config');
    expect(ebaySoldLaneEnabled(env as any)).toBe(false); // cloudflare:test env has no test escape hatch vars
    const prod = { ENVIRONMENT: 'production', EBAY_SOURCE_AUTHORIZED_FOR_TESTS: '1' };
    expect(ebaySoldLaneEnabled(prod as any)).toBe(false);
    const test = { ENVIRONMENT: 'test', EBAY_SOURCE_AUTHORIZED_FOR_TESTS: '1' };
    expect(ebaySoldLaneEnabled(test as any)).toBe(true);
  });

  it('a stored override can now enable the eBay ask source (only the sold lane is held)', async () => {
    await (env as any).DB.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('source_config', ?1, datetime('now'))`,
    ).bind(JSON.stringify({ ebay: { enabled: false } })).run();
    clearSourceConfigCache();
    const cfg = await getSourceConfig(env as any);
    expect(cfg.ebay.enabled).toBe(false);
  });

  it('persists an admin eBay enable decision for the ask lane', async () => {
    const cfg = await saveSourceConfig(env as any, { ebay: { enabled: true } });
    expect(cfg.ebay.enabled).toBe(true);
    clearSourceConfigCache();
    expect((await getSourceConfig(env as any)).ebay.enabled).toBe(true);
  });

  it('deep-merges + clamps stored overrides over defaults', async () => {
    clearSourceConfigCache();
    await saveSourceConfig(env as any, { pricesapi: { enabled: true, weight: 99 }, bricklink: { dailyCap: 1000 } });
    clearSourceConfigCache();
    const cfg = await getSourceConfig(env as any);
    expect(cfg.pricesapi.enabled).toBe(true);
    expect(cfg.pricesapi.weight).toBe(3);          // clamped to max 3
    expect(cfg.bricklink.dailyCap).toBe(1000);
    expect(cfg.ebay).toEqual(DEFAULT_SOURCE_CONFIG.ebay); // untouched
  });

  it('sourceEnabled reflects the stored kill switch (fail-open default)', async () => {
    expect(await sourceEnabled(env as any, 'bricklink')).toBe(true);
    clearSourceConfigCache();
    await saveSourceConfig(env as any, { bricklink: { enabled: false } });
    clearSourceConfigCache();
    expect(await sourceEnabled(env as any, 'bricklink')).toBe(false);
  });

  it('applySourceConfig drives blend weights (a 0 weight excludes the source)', async () => {
    const fresh = new Date().toISOString();
    const row = { bl_new_value: 200, bl_new_qty: 5, bl_cached_at: fresh, ebay_new_value: 300, ebay_new_qty: 20, ebay_new_cached_at: fresh };
    // Default: both contribute → value between 200 and 300.
    resetSourceWeightMultipliers();
    const base = blendMarketValue(row).value!;
    expect(base).toBeGreaterThan(200);

    clearSourceConfigCache();
    await saveSourceConfig(env as any, { ebay: { weight: 0 } });
    clearSourceConfigCache();
    await applySourceConfig(env as any);
    // pc_new excluded → only BrickLink remains.
    expect(blendMarketValue(row).value).toBe(200);
    resetSourceWeightMultipliers();
  });

  it('applySourceConfig scales blend influence for a fractional weight, not just on/off', async () => {
    // Regression: a weight between 0 and 1 used to behave identically to 1 —
    // effectiveSignals() only ever checked `weight > 0`, so admins dialing a
    // source's trust down (e.g. StockX's own default of 0.6) had zero actual
    // effect on the blend. This asserts a heavily downweighted-but-not-excluded
    // source measurably loses influence instead of remaining full-strength.
    const fresh = new Date().toISOString();
    const row = { bl_new_value: 200, bl_new_qty: 5, bl_cached_at: fresh, ebay_new_value: 300, ebay_new_qty: 20, ebay_new_cached_at: fresh };
    resetSourceWeightMultipliers();
    const base = blendMarketValue(row).value!;

    clearSourceConfigCache();
    await saveSourceConfig(env as any, { ebay: { weight: 0.1 } });
    clearSourceConfigCache();
    await applySourceConfig(env as any);
    const downweighted = blendMarketValue(row).value!;
    resetSourceWeightMultipliers();

    // Still present (not excluded like weight:0 above) but pulled toward
    // BrickLink's 200 now that eBay barely counts, and strictly below the
    // full-weight baseline.
    expect(downweighted).toBeLessThan(base);
    expect(downweighted).toBeCloseTo(200, 0);
  });

  it('applySourceConfig drives the daily quota cap override', async () => {
    clearSourceConfigCache();
    await saveSourceConfig(env as any, { pricesapi: { dailyCap: 1 } });
    clearSourceConfigCache();
    await applySourceConfig(env as any);
    expect(await spendQuota(env as any, 'pricesapi', 1)).toBe(true);   // 1st within cap
    expect(await spendQuota(env as any, 'pricesapi', 1)).toBe(false);  // 2nd exceeds cap=1
  });
});
