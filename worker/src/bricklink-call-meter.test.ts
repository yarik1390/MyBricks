/// <reference types="@cloudflare/vitest-pool-workers/types" />
// 2026-11-26: BrickLink blocked the Store API for passing its daily limit while
// our ledger showed ~2-3k/day. These tests pin the fix: every real BrickLink
// HTTP attempt is booked, in a rolling 24-hour window, before it is sent.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRICKLINK_ROLLING_CAP,
  __resetBrickLinkMeter,
  quotaDay,
  quotaHour,
  quotaRemaining,
  reserveQuota,
  setQuotaCapOverrides,
  spendBrickLinkCall,
} from './lib/api-quota';
import { fetchMinifigPricing, fetchSetPricing, BrickLinkQuotaError } from './lib/bricklink';
import type { Env } from './types';

const testEnv = env as unknown as Env;
const blEnv: any = {
  ...env,
  BRICKLINK_CONSUMER_KEY: 'ck',
  BRICKLINK_CONSUMER_SECRET: 'cs',
  BRICKLINK_TOKEN: 'tok',
  BRICKLINK_TOKEN_SECRET: 'ts',
  CACHE_KV: undefined,
};

const guide = { meta: { code: 200 }, data: { unit_quantity: 9, qty_avg_price: '100.00' } };

async function used(service: string, day: string): Promise<number> {
  const row = await testEnv.DB.prepare('SELECT used FROM api_quota WHERE service=?1 AND day=?2')
    .bind(service, day).first<{ used: number }>();
  return Number(row?.used ?? 0);
}

async function setHour(hour: string, n: number): Promise<void> {
  await testEnv.DB.prepare(
    "INSERT INTO api_quota (service, day, used, cap) VALUES ('bricklink@hour', ?1, ?2, 4000) ON CONFLICT(service, day) DO UPDATE SET used=?2",
  ).bind(hour, n).run();
}

beforeEach(async () => {
  __resetBrickLinkMeter();
  setQuotaCapOverrides({});
  await testEnv.DB.prepare('DROP TABLE IF EXISTS api_quota').run();
  await testEnv.DB.prepare(`CREATE TABLE api_quota (
    service TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0,
    cap INTEGER NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (service, day))`).run();
});
afterEach(() => vi.unstubAllGlobals());

describe('rolling 24-hour BrickLink window', () => {
  it('books each call in both the hourly window and the calendar-day row', async () => {
    expect(await spendBrickLinkCall(testEnv)).toBe(true);
    expect(await spendBrickLinkCall(testEnv)).toBe(true);
    expect(await used('bricklink@hour', quotaHour())).toBe(2);
    expect(await used('bricklink', quotaDay())).toBe(2);
  });

  it('counts calls made before UTC midnight against the window after it', async () => {
    // 3,999 calls in the previous hours (yesterday on the UTC calendar): the
    // calendar-day row is empty, but BrickLink's own day may still include them.
    const earlier = quotaHour(new Date(Date.now() - 5 * 3600_000));
    await setHour(earlier, BRICKLINK_ROLLING_CAP - 1);
    expect(await spendBrickLinkCall(testEnv)).toBe(true);
    expect(await spendBrickLinkCall(testEnv)).toBe(false);
    expect(await used('bricklink', quotaDay())).toBe(1);
    expect(await quotaRemaining(testEnv, 'bricklink')).toBe(0);
  });

  it('frees room once calls are older than 24 hours', async () => {
    await setHour(quotaHour(new Date(Date.now() - 25 * 3600_000)), BRICKLINK_ROLLING_CAP);
    expect(await spendBrickLinkCall(testEnv)).toBe(true);
  });

  it('an admin day cap can lower the window but never raise or remove it', async () => {
    setQuotaCapOverrides({ bricklink: 9000 });
    expect(await quotaRemaining(testEnv, 'bricklink')).toBe(BRICKLINK_ROLLING_CAP);
    setQuotaCapOverrides({ bricklink: null });
    expect(await quotaRemaining(testEnv, 'bricklink')).toBe(BRICKLINK_ROLLING_CAP);
    setQuotaCapOverrides({ bricklink: 3 });
    expect(await quotaRemaining(testEnv, 'bricklink')).toBe(3);
  });

  it('fails closed when the ledger cannot be read', async () => {
    await testEnv.DB.prepare('DROP TABLE api_quota').run();
    expect(await spendBrickLinkCall(testEnv)).toBe(false);
    expect(await quotaRemaining(testEnv, 'bricklink')).toBe(0);
    expect((await reserveQuota(testEnv, { bricklink: 5 })).bricklink).toBe(0);
  });

  it('reservations book the window and are not booked again when the call is made', async () => {
    setQuotaCapOverrides({ bricklink: 10 });
    expect((await reserveQuota(testEnv, { bricklink: 4 })).bricklink).toBe(4);
    expect(await used('bricklink@hour', quotaHour())).toBe(4);
    for (let i = 0; i < 4; i++) expect(await spendBrickLinkCall(testEnv)).toBe(true);
    expect(await used('bricklink@hour', quotaHour())).toBe(4);
    // A fifth call (a retry, or an unreserved caller) books its own unit.
    expect(await spendBrickLinkCall(testEnv)).toBe(true);
    expect(await used('bricklink@hour', quotaHour())).toBe(5);
    expect(await used('bricklink', quotaDay())).toBe(5);
  });
});

describe('every BrickLink HTTP attempt is metered', () => {
  it('books the retry too (503 then 200 = two units)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(guide), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchSetPricing('75192-1', blEnv, { recordHealth: false, retries: 1 });
    expect(r?.current_value).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await used('bricklink@hour', quotaHour())).toBe(2);
  });

  it('retries at most once, whatever the caller asks for', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchSetPricing('75192-1', blEnv, { recordHealth: false, retries: 5 })).rejects.toThrow(/HTTP 503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await used('bricklink@hour', quotaHour())).toBe(2);
  });

  it('never retries a 429', async () => {
    const fetchMock = vi.fn(async () => new Response('slow down', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchSetPricing('75192-1', blEnv, { recordHealth: false })).rejects.toThrow(/HTTP 429/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('the minifig price call (which used to retry up to 3 times unbooked) books each attempt', async () => {
    const fetchMock = vi.fn(async () => new Response('busy', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchMinifigPricing('sw0001', blEnv, { recordHealth: false })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await used('bricklink@hour', quotaHour())).toBe(2);
  });

  it('sends nothing once the window is full', async () => {
    await setHour(quotaHour(), BRICKLINK_ROLLING_CAP);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(guide), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchSetPricing('75192-1', blEnv, { recordHealth: false })).rejects.toBeInstanceOf(BrickLinkQuotaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats HTTP 400 (bad item number) as no-data so it is not re-asked every run', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
    await expect(fetchSetPricing('9999999-1', blEnv, { recordHealth: false })).resolves.toBeNull();
  });
});
