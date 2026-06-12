/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CRON_BUDGET,
  QUOTA_CAPS,
  getQuotaUsage,
  packBatch,
  perSetCost,
  quotaDay,
  reserveQuota,
  spendQuota,
  type PackProfile,
} from './lib/api-quota';
import type { Env } from './types';

const testEnv = env as unknown as Env;

const createTable = `
  CREATE TABLE api_quota (
    service TEXT NOT NULL,
    day TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    cap INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (service, day)
  )
`;

beforeEach(async () => {
  await testEnv.DB.prepare('DROP TABLE IF EXISTS api_quota').run();
  await testEnv.DB.prepare(createTable).run();
});

const readRow = (service: string) =>
  testEnv.DB.prepare('SELECT used, cap FROM api_quota WHERE service=?1 AND day=?2')
    .bind(service, quotaDay())
    .first<{ used: number; cap: number }>();

describe('quotaDay', () => {
  it('formats as UTC YYYY-MM-DD', () => {
    expect(quotaDay(new Date('2026-06-11T23:59:59Z'))).toBe('2026-06-11');
    expect(quotaDay(new Date('2026-06-12T00:00:01Z'))).toBe('2026-06-12');
  });
});

describe('spendQuota', () => {
  it('allows spends under the cap and increments usage', async () => {
    expect(await spendQuota(testEnv, 'brickeconomy')).toBe(true);
    expect(await spendQuota(testEnv, 'brickeconomy', 2)).toBe(true);
    const row = await readRow('brickeconomy');
    expect(row?.used).toBe(3);
    expect(row?.cap).toBe(QUOTA_CAPS.brickeconomy);
  });

  it('denies spends once the daily budget is exhausted', async () => {
    await testEnv.DB.prepare(
      'INSERT INTO api_quota (service, day, used, cap) VALUES (?1, ?2, ?3, ?3)'
    ).bind('brickeconomy', quotaDay(), QUOTA_CAPS.brickeconomy).run();
    expect(await spendQuota(testEnv, 'brickeconomy')).toBe(false);
    const row = await readRow('brickeconomy');
    expect(row?.used).toBe(QUOTA_CAPS.brickeconomy);
  });

  it('never gates services without a configured cap', async () => {
    expect(await spendQuota(testEnv, 'gemini')).toBe(true);
    expect(await readRow('gemini')).toBeNull();
  });

  it('fails open when the ledger table is unavailable', async () => {
    await testEnv.DB.prepare('DROP TABLE api_quota').run();
    expect(await spendQuota(testEnv, 'bricklink')).toBe(true);
  });
});

describe('reserveQuota', () => {
  it('grants the full request when budget remains', async () => {
    const grants = await reserveQuota(testEnv, { bricklink: 24, ebay: 10 });
    expect(grants.bricklink).toBe(24);
    expect(grants.ebay).toBe(10);
    expect((await readRow('bricklink'))?.used).toBe(24);
    expect((await readRow('ebay'))?.used).toBe(10);
  });

  it('grants only what remains of an almost-spent budget', async () => {
    await testEnv.DB.prepare(
      'INSERT INTO api_quota (service, day, used, cap) VALUES (?1, ?2, ?3, ?4)'
    ).bind('brickeconomy', quotaDay(), QUOTA_CAPS.brickeconomy - 10, QUOTA_CAPS.brickeconomy).run();
    const grants = await reserveQuota(testEnv, { brickeconomy: 25, bricklink: 5 });
    expect(grants.brickeconomy).toBe(10);
    expect(grants.bricklink).toBe(5);
    expect((await readRow('brickeconomy'))?.used).toBe(QUOTA_CAPS.brickeconomy);
  });

  it('grants zero when a budget is fully spent', async () => {
    await testEnv.DB.prepare(
      'INSERT INTO api_quota (service, day, used, cap) VALUES (?1, ?2, ?3, ?3)'
    ).bind('brickeconomy', quotaDay(), QUOTA_CAPS.brickeconomy).run();
    const grants = await reserveQuota(testEnv, { brickeconomy: 4 });
    expect(grants.brickeconomy).toBe(0);
  });

  it('passes unbudgeted services through and ignores non-positive wants', async () => {
    const grants = await reserveQuota(testEnv, { gemini: 7, bricklink: 0 });
    expect(grants.gemini).toBe(7);
    expect(grants.bricklink).toBeUndefined();
    expect(await readRow('gemini')).toBeNull();
  });

  it('fails open with full grants when the ledger table is unavailable', async () => {
    await testEnv.DB.prepare('DROP TABLE api_quota').run();
    const grants = await reserveQuota(testEnv, { brickeconomy: 12 });
    expect(grants.brickeconomy).toBe(12);
  });
});

describe('getQuotaUsage', () => {
  it('zero-fills every budgeted service and computes remaining', async () => {
    await spendQuota(testEnv, 'brickeconomy', 5);
    const usage = await getQuotaUsage(testEnv);
    const services = usage.map(u => u.service);
    for (const service of Object.keys(QUOTA_CAPS)) {
      expect(services).toContain(service);
    }
    const be = usage.find(u => u.service === 'brickeconomy')!;
    expect(be.used).toBe(5);
    expect(be.remaining).toBe(QUOTA_CAPS.brickeconomy - 5);
    const bl = usage.find(u => u.service === 'bricklink')!;
    expect(bl.used).toBe(0);
    expect(bl.remaining).toBe(QUOTA_CAPS.bricklink);
  });
});

describe('invocation packing', () => {
  const cronProfile: PackProfile = {
    brickEconomy: true,
    supplemental: false,
    ebay: false,
    aiFallback: true,
    progressWrites: false,
  };
  const fullSliceProfile: PackProfile = {
    brickEconomy: true,
    supplemental: true,
    ebay: true,
    aiFallback: false,
    progressWrites: true,
  };

  it('prices a full-fanout slice set higher than a source-light cron set', () => {
    expect(perSetCost(fullSliceProfile)).toBeGreaterThan(perSetCost(cronProfile));
  });

  it('fits at least the legacy hand-tuned batch of 4 in a default cron budget', () => {
    expect(packBatch(12, DEFAULT_CRON_BUDGET, cronProfile)).toBeGreaterThanOrEqual(4);
  });

  it('never exceeds the requested limit', () => {
    expect(packBatch(2, DEFAULT_CRON_BUDGET, cronProfile)).toBe(2);
  });

  it('keeps the cron batch within the budget envelope', () => {
    const packed = packBatch(250, DEFAULT_CRON_BUDGET, cronProfile);
    expect(packed * perSetCost(cronProfile)).toBeLessThanOrEqual(DEFAULT_CRON_BUDGET);
  });

  it('floors at one set even when the budget is tiny', () => {
    expect(packBatch(8, 5, fullSliceProfile)).toBe(1);
  });
});
