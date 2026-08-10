/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { submitAsyncUnlock, fetchAsyncResult, ebaySoldUrl } from './lib/brightdata-async';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

const pool = {
  ...env,
  BRIGHTDATA_API_TOKEN: 'bd-one',
  BRIGHTDATA_ZONE: 'web_unlocker1',
} as any;

describe('brightdata async unlocker', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['brightdata_keys', 'api_quota', 'integration_health']);
    vi.unstubAllGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('submitAsyncUnlock', () => {
    it('returns the response_id and posts to the zone-scoped submit endpoint', async () => {
      const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ response_id: 'abc123' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);

      const out = await submitAsyncUnlock(pool, 'https://www.ebay.com/sch/i.html?x=1');

      expect(out).toMatchObject({ ok: true, response_id: 'abc123', status: 200, error: null });
      const [url, init] = fetchSpy.mock.calls[0] as any;
      expect(url).toBe('https://api.brightdata.com/unblocker/req?zone=web_unlocker1');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer bd-one');
    });

    it('surfaces the provider error verbatim when async is not enabled on the zone', async () => {
      // The failure we most expect first: the control-panel toggle is still off.
      // It must NOT be reported as "eBay blocked us" — different problem entirely.
      vi.stubGlobal('fetch', vi.fn(async () =>
        new Response('async requests are not enabled for this zone', { status: 400 })));

      const out = await submitAsyncUnlock(pool, 'https://x.test');

      expect(out.ok).toBe(false);
      expect(out.status).toBe(400);
      expect(out.error).toContain('async requests are not enabled');
    });

    it('does not invent an id when the reply carries none', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ queued: true }), { status: 200 })));
      const out = await submitAsyncUnlock(pool, 'https://x.test');
      expect(out.ok).toBe(false);
      expect(out.response_id).toBeNull();
      expect(out.error).toContain('no response_id');
    });

    it('reports a missing token pool rather than throwing', async () => {
      const noKeys = { ...pool, BRIGHTDATA_API_TOKEN: '', BRIGHTDATA_API_TOKENS: '' } as any;
      const out = await submitAsyncUnlock(noKeys, 'https://x.test');
      expect(out.ok).toBe(false);
      expect(out.error).toContain('no live Bright Data token');
    });
  });

  describe('fetchAsyncResult', () => {
    it('returns the body once the job is ready', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>s-card__price $10.00</html>', { status: 200 })));
      const out = await fetchAsyncResult(pool, 'abc123');
      expect(out.state).toBe('ready');
      expect(out.body).toContain('s-card__price');
    });

    it.each([202, 404])('treats HTTP %i as still-pending, not an error', async (status) => {
      // "Not ready yet" is the normal intermediate state for async — reporting it
      // as an error would make the collect path give up on a live job. 404 counts
      // because a freshly queued id can read as not-found before it is durable.
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status })));
      const out = await fetchAsyncResult(pool, 'abc123');
      expect(out.state).toBe('pending');
      expect(out.error).toBeNull();
    });

    it('reports a real failure as an error', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status: 500 })));
      const out = await fetchAsyncResult(pool, 'abc123');
      expect(out.state).toBe('error');
      expect(out.error).toContain('HTTP 500');
    });
  });

  describe('ebaySoldUrl', () => {
    it('strips the -1 suffix and defaults to the new/sealed condition', () => {
      const url = ebaySoldUrl('75192-1', 'Millennium Falcon');
      expect(url).toContain('_nkw=LEGO%2075192%20Millennium%20Falcon');
      expect(url).toContain('LH_ItemCondition=1000');
      expect(url).toContain('LH_Sold=1');
    });

    it('can target the used condition', () => {
      expect(ebaySoldUrl('10307-1', 'Eiffel Tower', 3000)).toContain('LH_ItemCondition=3000');
    });
  });
});
