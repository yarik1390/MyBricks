/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseRows, scrapeEbayUrls, discoverEbayByKeyword, fetchSnapshot } from './lib/brightdata-scraper';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const pool = { ...env, BRIGHTDATA_API_TOKEN: 'bd-one' } as any;

describe('brightdata web scraper api', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['brightdata_keys', 'api_quota', 'integration_health']);
    vi.unstubAllGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('parseRows', () => {
    it('reads a JSON array', () => {
      expect(parseRows('[{"a":1},{"a":2}]')).toHaveLength(2);
    });
    it('wraps a single JSON object', () => {
      expect(parseRows('{"a":1}')).toEqual([{ a: 1 }]);
    });
    it('reads NDJSON, which large deliveries use', () => {
      expect(parseRows('{"a":1}\n{"a":2}\n')).toHaveLength(2);
    });
    it('returns null on genuinely unparseable text rather than pretending it is empty', () => {
      // Distinguishing "no data" from "we could not read the reply" matters:
      // one is a real answer about the set, the other is our bug.
      expect(parseRows('<html>nope</html>')).toBeNull();
    });
    it('returns null on empty input', () => {
      expect(parseRows('   ')).toBeNull();
    });
  });

  describe('scrapeEbayUrls', () => {
    it('posts item urls to the sync scrape endpoint with the dataset id', async () => {
      const fetchSpy = vi.fn(async () => new Response('[{"title":"LEGO 75192","price":600}]', { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);

      const out = await scrapeEbayUrls(pool, ['https://www.ebay.com/itm/123']);

      expect(out.state).toBe('ok');
      expect(out.rows).toHaveLength(1);
      const [url, init] = fetchSpy.mock.calls[0] as any;
      expect(url).toContain('/datasets/v3/scrape');
      expect(url).toContain('dataset_id=gd_ltr9mjt81n0zzdk1fb');
      expect(JSON.parse(init.body)).toEqual({ input: [{ url: 'https://www.ebay.com/itm/123' }], limit_per_input: null });
    });

    it('uses the trigger endpoint when async is requested', async () => {
      const fetchSpy = vi.fn(async () => new Response('{"snapshot_id":"s_123"}', { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);

      const out = await scrapeEbayUrls(pool, ['https://www.ebay.com/itm/123'], { sync: false });

      expect((fetchSpy.mock.calls[0] as any)[0]).toContain('/datasets/v3/trigger');
      // A snapshot handle is queued work, not rows and not a failure.
      expect(out.state).toBe('queued');
      expect(out.snapshot_id).toBe('s_123');
    });

    it('honours a dataset id override from env', async () => {
      const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);
      await scrapeEbayUrls({ ...pool, BRIGHTDATA_EBAY_DATASET_ID: 'gd_custom' } as any, ['https://x.test']);
      expect((fetchSpy.mock.calls[0] as any)[0]).toContain('dataset_id=gd_custom');
    });

    it('carries the provider message on a 4xx', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('bad dataset', { status: 404 })));
      const out = await scrapeEbayUrls(pool, ['https://x.test']);
      expect(out.state).toBe('error');
      expect(out.error).toContain('HTTP 404');
      expect(out.error).toContain('bad dataset');
    });
  });

  describe('discoverEbayByKeyword', () => {
    it('asks for discovery so Bright Data runs the eBay search itself', async () => {
      const fetchSpy = vi.fn(async () => new Response('[{"title":"LEGO 75192"}]', { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);

      await discoverEbayByKeyword(pool, 'LEGO 75192', { limitPerInput: 5 });

      const [url, init] = fetchSpy.mock.calls[0] as any;
      expect(url).toContain('type=discover_new');
      expect(url).toContain('discover_by=keyword');
      expect(JSON.parse(init.body)).toEqual({ input: [{ keyword: 'LEGO 75192' }], limit_per_input: 5 });
    });
  });

  describe('fetchSnapshot', () => {
    it('treats 202 as still-running rather than an error', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 202 })));
      const out = await fetchSnapshot(pool, 's_123');
      expect(out.state).toBe('queued');
      expect(out.error).toBeNull();
    });

    it('returns rows once the snapshot is ready', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{"title":"a"}\n{"title":"b"}', { status: 200 })));
      const out = await fetchSnapshot(pool, 's_123');
      expect(out.state).toBe('ok');
      expect(out.rows).toHaveLength(2);
    });
  });
});
