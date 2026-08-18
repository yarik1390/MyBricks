/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runEbayBackfill, runEbayAskBackfill } from './jobs/valuate-sets';
import { setIntegrationBlock } from './lib/integration-health';
import { clearSourceConfigCache, saveSourceConfig } from './lib/source-config';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const today = new Date().toISOString().slice(0, 10);

async function ebayUsedToday(): Promise<number | null> {
  const row = await db.prepare(`SELECT used FROM api_quota WHERE service='ebay' AND day=?1`).bind(today).first<{ used: number }>();
  return row ? Number(row.used) : null;
}

describe('runEbayBackfill (Marketplace Insights sold comps)', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health', 'app_settings']);
    clearSourceConfigCache();
  });

  it('skips when eBay sold comps are disabled (default)', async () => {
    const r = await runEbayBackfill({ ...env, EBAY_SOLD_COMPS_ENABLED: '' } as any);
    expect(r.skipped).toMatch(/ebay disabled in source tuning|ebay sold comps disabled/);
    expect(await ebayUsedToday()).toBeNull(); // never reserved
  });

  it('skips while the eBay circuit breaker is open, without reserving quota', async () => {
    const enabled = { ...env, EBAY_SOLD_COMPS_ENABLED: '1' } as any;
    await saveSourceConfig(enabled, { ebay: { enabled: true } });
    clearSourceConfigCache();
    await setIntegrationBlock(enabled, 'ebay', 6); // access-denied breaker active
    const r = await runEbayBackfill(enabled);
    expect(r.skipped).toMatch(/ebay access blocked/);
    expect(await ebayUsedToday()).toBeNull();
  });

  it('runs cleanly with nothing to backfill when enabled and unblocked', async () => {
    const enabled = { ...env, EBAY_SOLD_COMPS_ENABLED: '1' } as any;
    await saveSourceConfig(enabled, { ebay: { enabled: true } });
    clearSourceConfigCache();
    const r = await runEbayBackfill(enabled);
    expect(r.skipped).toBeUndefined();
    expect(r.processed).toBe(0); // empty catalog → no eligible sets
  });
});

describe('runEbayAskBackfill (Browse ask signal)', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'user_collection', 'user_wishlist', 'api_quota', 'integration_health']);
  });

  it('returns cleanly when no set has a stale ask (nothing reserved)', async () => {
    const r = await runEbayAskBackfill(env as any);
    expect(r.processed).toBe(0);
    expect(r.updated).toBe(0);
    expect(await ebayUsedToday()).toBeNull(); // reserve only happens once there ARE rows
  });
});
