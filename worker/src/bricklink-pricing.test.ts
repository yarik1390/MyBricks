/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchSetPricing, fetchUsedPricing } from './lib/bricklink';

// BrickLink creds so oauthHeader() runs; CACHE_KV undefined so we hit the network
// path every time; recordHealth:false so we don't touch integration_health.
const e: any = {
  ...env,
  BRICKLINK_CONSUMER_KEY: 'ck',
  BRICKLINK_CONSUMER_SECRET: 'cs',
  BRICKLINK_TOKEN: 'tok',
  BRICKLINK_TOKEN_SECRET: 'ts',
  CACHE_KV: undefined,
};
const opts = { recordHealth: false, retries: 0 } as const;

function stub(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })));
}
const guide = (lots: number, avg = '100.00') =>
  ({ meta: { code: 200 }, data: { unit_quantity: lots, qty_avg_price: avg, min_price: '80.00', max_price: '120.00' } });

describe('fetchSetPricing — source outage vs genuine no-data', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a price when the sold guide has ≥5 lots', async () => {
    stub(guide(9, '123.45'));
    const r = await fetchSetPricing('75192-1', e, opts);
    expect(r).toEqual({ current_value: 123.45, lot_count: 9, min_price: 80, max_price: 120 });
  });

  it('returns null (no-data) on a 404 — set genuinely not in the guide', async () => {
    stub('not found', 404);
    await expect(fetchSetPricing('00000-1', e, opts)).resolves.toBeNull();
  });

  it('returns null (no-data) when the guide has too few lots (<5)', async () => {
    stub(guide(2));
    await expect(fetchSetPricing('11111-1', e, opts)).resolves.toBeNull();
  });

  it('returns null (no-data) when code is 200 but there is no usable price', async () => {
    stub({ meta: { code: 200 }, data: { unit_quantity: 20, qty_avg_price: '' } });
    await expect(fetchSetPricing('22222-1', e, opts)).resolves.toBeNull();
  });

  it('THROWS on a transient HTTP error (5xx) rather than reporting no-data', async () => {
    stub('upstream boom', 503);
    await expect(fetchSetPricing('75192-1', e, opts)).rejects.toThrow(/HTTP 503/);
  });

  it('THROWS on an auth error (401) — never a silent no-data null', async () => {
    stub('unauthorized', 401);
    await expect(fetchSetPricing('75192-1', e, opts)).rejects.toThrow(/HTTP 401/);
  });

  it('THROWS on a BrickLink API-level error (meta.code != 200)', async () => {
    stub({ meta: { code: 429 }, data: null });
    await expect(fetchSetPricing('75192-1', e, opts)).rejects.toThrow(/API code 429/);
  });

  it('THROWS on a network failure rather than swallowing it as no-data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    await expect(fetchSetPricing('75192-1', e, opts)).rejects.toThrow(/ECONNRESET/);
  });

  it('returns null WITHOUT a fetch when BrickLink is not configured', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await fetchSetPricing('75192-1', { ...e, BRICKLINK_CONSUMER_KEY: '' }, opts);
    expect(r).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fetchUsedPricing — same outage vs no-data contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a used price when the guide has ≥3 lots', async () => {
    stub(guide(4, '55.00'));
    const r = await fetchUsedPricing('75192-1', e, opts);
    expect(r).toMatchObject({ used_value: 55, lot_count: 4 });
  });

  it('returns null (no-data) on a 404', async () => {
    stub('not found', 404);
    await expect(fetchUsedPricing('00000-1', e, opts)).resolves.toBeNull();
  });

  it('THROWS on a transient 500', async () => {
    stub('boom', 500);
    await expect(fetchUsedPricing('75192-1', e, opts)).rejects.toThrow(/HTTP 500/);
  });
});
