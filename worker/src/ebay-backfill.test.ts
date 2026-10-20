/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { runEbayAskBackfill } from './jobs/valuate-sets';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const today = new Date().toISOString().slice(0, 10);

async function ebayUsedToday(): Promise<number | null> {
  const row = await db.prepare(`SELECT used FROM api_quota WHERE service='ebay' AND day=?1`).bind(today).first<{ used: number }>();
  return row ? Number(row.used) : null;
}

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
