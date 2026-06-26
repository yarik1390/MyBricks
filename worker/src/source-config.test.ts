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
    const row = { bl_new_value: 200, bl_new_qty: 5, bl_cached_at: fresh, pc_new_value: 300, pc_cached_at: fresh };
    // Default: both contribute → value between 200 and 300.
    resetSourceWeightMultipliers();
    const base = blendMarketValue(row).value!;
    expect(base).toBeGreaterThan(200);

    clearSourceConfigCache();
    await saveSourceConfig(env as any, { pricecharting: { weight: 0 } });
    clearSourceConfigCache();
    await applySourceConfig(env as any);
    // pc_new excluded → only BrickLink remains.
    expect(blendMarketValue(row).value).toBe(200);
    resetSourceWeightMultipliers();
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
