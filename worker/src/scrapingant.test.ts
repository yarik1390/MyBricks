/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';
import { QUOTA_CAPS } from './lib/api-quota';
import {
  configuredScrapingAntKeys,
  getScrapingAntKeyPoolStatus,
  hashScrapingAntKey,
  markScrapingAntExhausted,
  pickScrapingAntKey,
  reserveScrapingAntUnit,
} from './lib/scrapingant-keys';
import { scrapingAntEnabled, scrapingAntFetchHtml } from './lib/scrapingant';
import { fetchBrickEconomy } from './lib/brickeconomy-firecrawl';
import { checkLegoStock } from './lib/lego-stock';

const db = (env as any).DB as D1Database;
const secret = 'ant-secret-that-must-not-leak';
const configured = { ...env, SCRAPINGANT_API_KEY: secret } as any;

describe('ScrapingAnt raw HTML client', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['api_quota', 'integration_health', 'brightdata_keys', 'scrapingant_keys']);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('rotating monthly key pool', () => {
    const pooled = {
      ...env,
      SCRAPINGANT_API_KEY: 'legacy-ant-key',
      SCRAPINGANT_API_KEYS: 'ant-key-b, ant-key-c, legacy-ant-key',
      SCRAPINGANT_KEY_CAP: '3',
    } as any;

    it('accepts pooled or legacy secrets, deduplicates them, and never exposes raw keys', async () => {
      expect(configuredScrapingAntKeys(pooled)).toEqual([
        'legacy-ant-key',
        'ant-key-b',
        'ant-key-c',
      ]);
      expect(scrapingAntEnabled(pooled)).toBe(true);
      expect(scrapingAntEnabled({ ...env, SCRAPINGANT_API_KEY: '', SCRAPINGANT_API_KEYS: 'pool-only' } as any)).toBe(true);

      const status = await getScrapingAntKeyPoolStatus(pooled);
      const serialized = JSON.stringify(status);
      expect(status.keys_configured).toBe(3);
      for (const rawKey of configuredScrapingAntKeys(pooled)) {
        expect(serialized).not.toContain(rawKey);
      }
    });

    it('picks the least-used key and breaks ties by SHA-256 hash', async () => {
      const entries = await Promise.all(configuredScrapingAntKeys(pooled).map(async (key) => ({
        key,
        hash: await hashScrapingAntKey(key),
      })));
      const [lowestHash, nextHash, mostUsed] = [...entries].sort((a, b) => a.hash.localeCompare(b.hash));
      for (const [entry, used] of [[lowestHash, 1], [nextHash, 1], [mostUsed, 2]] as const) {
        await db.prepare(`INSERT INTO scrapingant_keys (key_hash, used, cap, period_month)
          VALUES (?1, ?2, 3, strftime('%Y-%m','now'))`).bind(entry.hash, used).run();
      }

      await expect(pickScrapingAntKey(pooled)).resolves.toMatchObject({
        key: lowestHash.key,
        hash: lowestHash.hash,
      });
    });

    it('creates only a hash ledger row when reserving a pooled key', async () => {
      const picked = await pickScrapingAntKey(pooled);
      expect(picked).not.toBeNull();
      await expect(reserveScrapingAntUnit(pooled, picked!)).resolves.toBe(true);

      const row = await db.prepare('SELECT * FROM scrapingant_keys WHERE key_hash=?1')
        .bind(picked!.hash).first<any>();
      expect(row).toMatchObject({ key_hash: picked!.hash, used: 1, cap: 3 });
      expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(picked!.key);
    });

    it('atomically enforces the per-key monthly cap', async () => {
      const capped = { ...env, SCRAPINGANT_API_KEY: 'capped-key', SCRAPINGANT_KEY_CAP: '2' } as any;
      const hash = await hashScrapingAntKey('capped-key');
      await db.prepare(`INSERT INTO scrapingant_keys (key_hash, used, cap, period_month)
        VALUES (?1, 1, 2, strftime('%Y-%m','now'))`).bind(hash).run();
      const picked = await pickScrapingAntKey(capped);

      const claims = await Promise.all([
        reserveScrapingAntUnit(capped, picked!),
        reserveScrapingAntUnit(capped, picked!),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const row = await db.prepare('SELECT used FROM scrapingant_keys WHERE key_hash=?1').bind(hash).first<any>();
      expect(row?.used).toBe(2);
      await expect(pickScrapingAntKey(capped)).resolves.toBeNull();
    });

    it('resets a prior-month exhausted key on its first reservation this month', async () => {
      const legacyOnly = { ...env, SCRAPINGANT_API_KEY: 'legacy-only', SCRAPINGANT_KEY_CAP: '3' } as any;
      const hash = await hashScrapingAntKey('legacy-only');
      await db.prepare(`INSERT INTO scrapingant_keys (key_hash, used, cap, period_month, exhausted_at)
        VALUES (?1, 3, 3, strftime('%Y-%m','now','-1 month'), datetime('now'))`).bind(hash).run();

      const picked = await pickScrapingAntKey(legacyOnly);
      expect(picked?.key).toBe('legacy-only');
      await expect(reserveScrapingAntUnit(legacyOnly, picked!)).resolves.toBe(true);
      const row = await db.prepare('SELECT used, period_month, exhausted_at FROM scrapingant_keys WHERE key_hash=?1')
        .bind(hash).first<any>();
      expect(row).toMatchObject({ used: 1, period_month: new Date().toISOString().slice(0, 7), exhausted_at: null });
    });

    it('skips exhausted keys', async () => {
      const entries = await Promise.all(configuredScrapingAntKeys(pooled).map(async (key, index) => ({
        key,
        index,
        hash: await hashScrapingAntKey(key),
      })));
      const first = [...entries].sort((a, b) => a.hash.localeCompare(b.hash))[0];
      await markScrapingAntExhausted(pooled, first);

      const picked = await pickScrapingAntKey(pooled);
      expect(picked?.key).not.toBe(first.key);
    });

    it.each([401, 429])('marks HTTP %i keys exhausted and retries with the next key', async (status) => {
      const twoKeys = {
        ...env,
        SCRAPINGANT_API_KEY: '',
        SCRAPINGANT_API_KEYS: 'ant-retry-a,ant-retry-b',
        SCRAPINGANT_KEY_CAP: '3',
      } as any;
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response('provider rejected key', { status }))
        .mockResolvedValueOnce(new Response('<html>recovered</html>', {
          status: 200,
          headers: { 'ant-credits-cost': '1' },
        }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(scrapingAntFetchHtml('https://example.com', twoKeys)).resolves.toBe('<html>recovered</html>');
      const firstUrl = new URL(fetchMock.mock.calls[0][0] as string);
      const secondUrl = new URL(fetchMock.mock.calls[1][0] as string);
      expect(secondUrl.searchParams.get('x-api-key')).not.toBe(firstUrl.searchParams.get('x-api-key'));
      const firstHash = await hashScrapingAntKey(firstUrl.searchParams.get('x-api-key')!);
      const row = await db.prepare('SELECT exhausted_at FROM scrapingant_keys WHERE key_hash=?1')
        .bind(firstHash).first<any>();
      expect(row?.exhausted_at).toBeTruthy();
    });
  });

  it('uses only the non-browser datacenter contract and returns raw HTML', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>ok</html>', {
      status: 200,
      headers: { 'ant-credits-cost': '1', 'content-type': 'text/html' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(scrapingAntFetchHtml('https://brickset.com/sets/75192-1', configured, { timeoutMs: 1_000 }))
      .resolves.toBe('<html>ok</html>');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestUrl = new URL(endpoint);
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe('https://api.scrapingant.com/v2/general');
    expect(requestUrl.searchParams.get('url')).toBe('https://brickset.com/sets/75192-1');
    expect(requestUrl.searchParams.get('x-api-key')).toBe(secret);
    expect(requestUrl.searchParams.get('browser')).toBe('false');
    expect(requestUrl.searchParams.get('proxy_type')).toBe('datacenter');
    expect(requestUrl.searchParams.has('proxy_country')).toBe(false);
    expect(init.method).toBe('GET');

    const quota = await db.prepare(`SELECT used, cap FROM api_quota WHERE service='scrapingant'`).first<any>();
    expect(quota).toMatchObject({ used: 1, cap: QUOTA_CAPS.scrapingant });
  });

  it('does not call the provider when the key is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(scrapingAntFetchHtml('https://example.com', { ...env, SCRAPINGANT_API_KEY: '' } as any))
      .resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed at the conservative daily request cap', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await db.prepare(`INSERT INTO api_quota (service, day, used, cap) VALUES ('scrapingant', ?1, ?2, ?2)`)
      .bind(today, QUOTA_CAPS.scrapingant).run();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(scrapingAntFetchHtml('https://example.com', configured)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null on provider failure and never logs or persists the secret', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(`request failed: x-api-key=${secret}`)));

    await expect(scrapingAntFetchHtml('https://example.com', configured)).resolves.toBeNull();
    const health = await db.prepare(`SELECT last_error FROM integration_health WHERE service='scrapingant'`).first<any>();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(health)).not.toContain(secret);
    expect(health?.last_error).toMatch(/network error/i);
  });

  it('returns null for non-2xx responses without exposing response content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`invalid key ${secret}`, { status: 401 })));

    await expect(scrapingAntFetchHtml('https://example.com', configured)).resolves.toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    const health = await db.prepare(`SELECT last_error FROM integration_health WHERE service='scrapingant'`).first<any>();
    expect(health?.last_error).toBe('HTTP 401 (key exhausted)');
    expect(JSON.stringify(health)).not.toContain(secret);
  });

  it('falls back to Bright Data when ScrapingAnt fails for BrickEconomy', async () => {
    const antRequest = vi.fn().mockResolvedValue(new Response('blocked', { status: 503 }));
    const brightRequest = vi.fn().mockResolvedValue(new Response(`
      <section><div>Retail price</div><div>$849.99</div>
      <h4>New/Sealed</h4><div>Machine Learning/AI Model</div>
      <div>Value(today)</div><div>$1,448.03</div>
      <div>Value(in 2 years)</div><div>$1,951.71</div></section>
    `, { status: 200 }));
    const fetchMock = vi.fn((input: string | URL | Request) =>
      String(input).startsWith('https://api.scrapingant.com/') ? antRequest(input) : brightRequest(input));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchBrickEconomy('75192-1', {
      ...configured,
      BRIGHTDATA_API_TOKEN: 'bright-token',
      BRIGHTDATA_KEY_CAP: '10',
      FIRECRAWL_API_KEY: '',
      FIRECRAWL_API_KEYS: '',
    } as any);

    expect(result).toMatchObject({ retail_price_us: 849.99, current_value_new: 1448.03 });
    expect(antRequest).toHaveBeenCalledTimes(1);
    expect(brightRequest).toHaveBeenCalledTimes(1);
  });

  it('uses ScrapingAnt HTML before other providers for LEGO stock', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      `<script>{"productCode":"75192","availabilityStatus":"IN_STOCK","price":{"centAmount":84999,"currencyCode":"USD"}}</script>`,
      { status: 200, headers: { 'ant-credits-cost': '1' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await checkLegoStock('75192-1', {
      ...configured,
      BRIGHTDATA_API_TOKEN: 'bright-token',
      FIRECRAWL_API_KEY: 'fc-key',
    } as any);

    expect(result).toMatchObject({ in_stock: true, availability: 'in_stock', retail_price_usd: 849.99 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/api\.scrapingant\.com\/v2\/general/);
  });
});
