/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pricesApiSearch } from './lib/pricesapi';
import { getKeyPoolStatus } from './lib/pricesapi-keys';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS pricesapi_keys').run();
  await db.prepare(`CREATE TABLE pricesapi_keys (
    key_hash TEXT PRIMARY KEY, used INTEGER NOT NULL DEFAULT 0, cap INTEGER NOT NULL DEFAULT 1000,
    period_month TEXT, exhausted_at TEXT, last_used_at TEXT, updated_at TEXT
  )`).run();
  await db.prepare('DROP TABLE IF EXISTS integration_health').run();
  await db.prepare(`CREATE TABLE integration_health (
    service TEXT PRIMARY KEY, last_ok_at TEXT, last_fail_at TEXT, last_error TEXT,
    ok_count INTEGER NOT NULL DEFAULT 0, fail_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT, blocked_until TEXT
  )`).run();
}

// Enabled env with the KV cache disabled so each call exercises the live path.
function enabledEnv(): any {
  return { ...env, PRICESAPI_API_KEY: undefined, PRICESAPI_API_KEYS: 'k1,k2', PRICESAPI_ENABLED: '1', PRICESAPI_MARKET: 'us', CACHE_KV: undefined };
}

function mockResponse(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

const SAMPLE = {
  success: true,
  data: {
    query: 'LEGO 10300',
    country: 'us',
    products: [
      {
        pid: 1, title: 'LEGO Back to the Future', source: 'Best Buy', price: 199.99, currency: 'USD',
        offerCount: 3,
        offers: [
          { seller: 'Best Buy', price: 199.99, currency: 'USD', condition: 'New', url: 'x' },
          { seller: 'Target', price: 169.99, currency: 'USD', condition: 'New', url: 'y' },
          { seller: 'Amazon', price: 179.99, currency: 'USD', condition: 'New', url: 'z' },
        ],
      },
    ],
  },
  meta: { degraded: false, cache_source: 'miss' },
};

describe('pricesApiSearch', () => {
  beforeEach(freshSchema);
  afterEach(() => vi.unstubAllGlobals());

  it('returns null when disabled', async () => {
    mockResponse(SAMPLE);
    const e: any = { ...enabledEnv(), PRICESAPI_ENABLED: '0' };
    expect(await pricesApiSearch('LEGO 10300', e)).toBeNull();
  });

  it('normalizes the cheapest offer, merchant, retail and stock', async () => {
    mockResponse(SAMPLE);
    const r = await pricesApiSearch('LEGO 10300', enabledEnv());
    expect(r).not.toBeNull();
    expect(r!.retail_value).toBe(199.99);
    expect(r!.lowest_offer).toBe(169.99); // true min, not offers[0]
    expect(r!.best_merchant).toBe('Target');
    expect(r!.offer_count).toBe(3);
    expect(r!.in_stock).toBe(true);
    expect(r!.market).toBe('us');
  });

  it('treats a degraded (empty-offers) response as out of stock', async () => {
    mockResponse({ ...SAMPLE, data: { ...SAMPLE.data, products: [{ ...SAMPLE.data.products[0], offers: [], offerCount: 0 }] }, meta: { degraded: true } });
    const r = await pricesApiSearch('LEGO 10300', enabledEnv());
    expect(r!.in_stock).toBe(false);
    expect(r!.lowest_offer).toBeNull();
    expect(r!.retail_value).toBe(199.99);
  });

  it('spends one unit of a key budget on a billed call', async () => {
    mockResponse(SAMPLE);
    const e = enabledEnv();
    await pricesApiSearch('LEGO 10300', e);
    const status = await getKeyPoolStatus(e);
    expect(status.entries.reduce((s, x) => s + x.used, 0)).toBe(1);
  });

  it('marks the key exhausted on 403 CREDITS_EXCEEDED', async () => {
    mockResponse({ error: 'Monthly API credits limit reached', code: 'CREDITS_EXCEEDED' }, 403);
    const e = enabledEnv();
    const r = await pricesApiSearch('LEGO 10300', e);
    expect(r).toBeNull();
    const status = await getKeyPoolStatus(e);
    expect(status.entries.some((x) => x.exhausted)).toBe(true);
  });

  it('returns null on a network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await pricesApiSearch('LEGO 10300', enabledEnv())).toBeNull();
  });

  it('returns null when there is no product match', async () => {
    mockResponse({ success: true, data: { query: 'x', country: 'us', products: [] }, meta: {} });
    expect(await pricesApiSearch('LEGO 99999', enabledEnv())).toBeNull();
  });
});
