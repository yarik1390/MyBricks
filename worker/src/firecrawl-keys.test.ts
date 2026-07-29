/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  pickFirecrawlKey,
  recordFirecrawlSpend,
  hashFirecrawlKey,
  isCreditExhaustion,
  getFirecrawlKeyPoolStatus,
  resetFirecrawlKeyPool,
} from './lib/firecrawl-keys';
import { firecrawlScrape } from './lib/firecrawl';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;

// "small" is nearly spent, "big" is the fresh 650k key — the real situation this
// pool exists for.
const pool = {
  ...env,
  FIRECRAWL_API_KEY: 'fc-small',
  FIRECRAWL_API_KEYS: 'fc-big',
  FIRECRAWL_KEY_CREDITS: '100,650000',
} as any;

const spend = (hash: string, used: number, exhausted = false) =>
  db.prepare(
    `INSERT INTO firecrawl_keys (key_hash, used, cap, exhausted_at) VALUES (?1, ?2, 0, ${exhausted ? "datetime('now')" : 'NULL'})`,
  ).bind(hash, used);

describe('firecrawl key pool', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['firecrawl_keys', 'api_quota', 'integration_health']);
    vi.unstubAllGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drains the first key before touching the second', async () => {
    const picked = await pickFirecrawlKey(pool);
    expect(picked!.key).toBe('fc-small');
    expect(picked!.index).toBe(0);
  });

  it('moves to the next key once the first is over its configured balance', async () => {
    await spend(await hashFirecrawlKey('fc-small'), 100).run();
    const picked = await pickFirecrawlKey(pool);
    expect(picked!.key).toBe('fc-big');
    expect(picked!.index).toBe(1);
  });

  it('skips a key latched exhausted even with credits nominally left', async () => {
    await spend(await hashFirecrawlKey('fc-small'), 5, true).run();
    expect((await pickFirecrawlKey(pool))!.key).toBe('fc-big');
  });

  it('returns null only when every key is spent', async () => {
    await db.batch([
      spend(await hashFirecrawlKey('fc-small'), 100),
      spend(await hashFirecrawlKey('fc-big'), 650000),
    ]);
    expect(await pickFirecrawlKey(pool)).toBeNull();
  });

  it('never retires a key whose balance is unknown', async () => {
    const noCaps = { ...pool, FIRECRAWL_KEY_CREDITS: '' } as any;
    await spend(await hashFirecrawlKey('fc-small'), 999999).run();
    expect((await pickFirecrawlKey(noCaps))!.key).toBe('fc-small');
  });

  it('accumulates credits rather than call counts', async () => {
    const picked = (await pickFirecrawlKey(pool))!;
    await recordFirecrawlSpend(pool, picked, 5);
    await recordFirecrawlSpend(pool, picked, 5);
    await recordFirecrawlSpend(pool, picked, 1);
    const row = await db.prepare(`SELECT used FROM firecrawl_keys WHERE key_hash=?`).bind(picked.hash).first<{ used: number }>();
    expect(row!.used).toBe(11);
  });

  describe('isCreditExhaustion', () => {
    it('treats 402 as exhaustion', () => expect(isCreditExhaustion(402, '')).toBe(true));
    it('reads an explanatory body on a 4xx', () =>
      expect(isCreditExhaustion(403, '{"error":"Insufficient credits to perform this request"}')).toBe(true));
    it('does NOT treat a rate limit as exhaustion', () =>
      expect(isCreditExhaustion(429, 'Too many requests')).toBe(false));
    it('does NOT treat a server error as exhaustion', () =>
      expect(isCreditExhaustion(500, 'boom')).toBe(false));
  });

  describe('firecrawlScrape failover', () => {
    const okBody = JSON.stringify({ success: true, data: { json: { hit: 1 } } });

    it('fails over to the next key on 402 and still returns the scrape', async () => {
      const fetchSpy = vi.fn()
        .mockResolvedValueOnce(new Response('{"error":"insufficient credits"}', { status: 402 }))
        .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);

      const out = await firecrawlScrape<{ hit: number }>({ url: 'https://x.test', formats: ['markdown'] }, pool);

      expect(out?.data).toEqual({ hit: 1 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect((fetchSpy.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer fc-small');
      expect((fetchSpy.mock.calls[1][1] as any).headers.Authorization).toBe('Bearer fc-big');
      // ...and the drained key is latched so nothing tries it again.
      const row = await db.prepare(`SELECT exhausted_at FROM firecrawl_keys WHERE key_hash=?`)
        .bind(await hashFirecrawlKey('fc-small')).first<{ exhausted_at: string | null }>();
      expect(row!.exhausted_at).toBeTruthy();
    });

    it('borrows the next key on a 429 without retiring the throttled one', async () => {
      // Firecrawl's per-minute ceiling is per key, so an idle key still has its
      // own allowance — and a refused request costs no credits.
      const fetchSpy = vi.fn()
        .mockResolvedValueOnce(new Response('{"error":"Rate limit exceeded"}', { status: 429 }))
        .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);

      const out = await firecrawlScrape<{ hit: number }>({ url: 'https://x.test', formats: ['markdown'] }, pool);

      expect(out?.data).toEqual({ hit: 1 });
      expect((fetchSpy.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer fc-small');
      expect((fetchSpy.mock.calls[1][1] as any).headers.Authorization).toBe('Bearer fc-big');
      // The throttled key keeps its place at the head of the drain order...
      const row = await db.prepare(`SELECT used, exhausted_at FROM firecrawl_keys WHERE key_hash=?`)
        .bind(await hashFirecrawlKey('fc-small')).first<{ used: number; exhausted_at: string | null }>();
      expect(row!.exhausted_at).toBeNull();
      expect(row!.used).toBe(0);            // ...and is not charged for the refusal
      expect((await pickFirecrawlKey(pool))!.key).toBe('fc-small');
    });

    it('gives up when the last key is also throttled', async () => {
      const fetchSpy = vi.fn(async () => new Response('rate limited', { status: 429 }));
      vi.stubGlobal('fetch', fetchSpy);

      expect(await firecrawlScrape({ url: 'https://x.test', formats: ['markdown'] }, pool)).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(2); // both keys tried, then stop
    });

    it('does NOT burn a second key on an ordinary failure', async () => {
      // A server error is the same failure whichever key asks, so retrying would
      // spend the next key's credits for nothing. (429 is deliberately NOT this
      // case — it is per-key, and gets the detour tested above.)
      const fetchSpy = vi.fn().mockResolvedValue(new Response('upstream exploded', { status: 500 }));
      vi.stubGlobal('fetch', fetchSpy);

      expect(await firecrawlScrape({ url: 'https://x.test', formats: ['markdown'] }, pool)).toBeNull();
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('charges the key only for a call Firecrawl actually served', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
      await firecrawlScrape({ url: 'https://x.test', formats: ['markdown'] }, pool);
      const row = await db.prepare(`SELECT used FROM firecrawl_keys WHERE key_hash=?`)
        .bind(await hashFirecrawlKey('fc-small')).first<{ used: number }>();
      expect(Number(row?.used ?? 0)).toBe(0);
    });

    it('books 5 credits for a json extract and 1 for markdown', async () => {
      // A fresh Response per call: a single instance would have its body already
      // consumed by the first read, and the second scrape would fail spuriously.
      vi.stubGlobal('fetch', vi.fn(async () => new Response(okBody, { status: 200 })));
      const hash = await hashFirecrawlKey('fc-small');
      await firecrawlScrape({ url: 'https://x.test', formats: ['json'], jsonOptions: { schema: {} } }, pool);
      await firecrawlScrape({ url: 'https://x.test', formats: ['markdown'] }, pool);
      const row = await db.prepare(`SELECT used FROM firecrawl_keys WHERE key_hash=?`).bind(hash).first<{ used: number }>();
      expect(row!.used).toBe(6);
    });

    it('gives up cleanly when every key is out', async () => {
      await db.batch([
        spend(await hashFirecrawlKey('fc-small'), 0, true),
        spend(await hashFirecrawlKey('fc-big'), 0, true),
      ]);
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);

      expect(await firecrawlScrape({ url: 'https://x.test', formats: ['markdown'] }, pool)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('admin surface', () => {
    it('reports which key is active and what is left', async () => {
      await spend(await hashFirecrawlKey('fc-small'), 100).run();
      const status = await getFirecrawlKeyPoolStatus(pool);
      expect(status.keys_configured).toBe(2);
      expect(status.keys_live).toBe(1);
      expect(status.active_key_index).toBe(1);
      expect(status.pooled_remaining).toBe(650000);
      expect(status.entries[0]).toMatchObject({ exhausted: true, remaining: 0, active: false });
      expect(status.entries[1]).toMatchObject({ exhausted: false, active: true });
      // Only a hash prefix is ever exposed — never the key itself.
      expect(status.entries[0].key_hash).toHaveLength(12);
    });

    it('flags a declared balance whose key never reached the Worker', async () => {
      // FIRECRAWL_API_KEYS added as a GitHub Actions secret instead of a Worker
      // secret: the balance is declared but the key is invisible, and without
      // this signal the mistake only shows up when the active key runs dry.
      const oneKey = { ...pool, FIRECRAWL_API_KEYS: '' } as any;
      const status = await getFirecrawlKeyPoolStatus(oneKey);
      expect(status.keys_configured).toBe(1);
      expect(status.caps_declared).toBe(2);
    });

    it('reset un-latches and zeroes the pool', async () => {
      await spend(await hashFirecrawlKey('fc-small'), 100, true).run();
      expect((await resetFirecrawlKeyPool(pool)).reset).toBe(1);
      expect((await pickFirecrawlKey(pool))!.key).toBe('fc-small');
    });
  });
});
