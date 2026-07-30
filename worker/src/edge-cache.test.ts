/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import { edgeCached, invalidateSetDetail, invalidateSetDetailMany, setDetailCacheKey, RETAIL_MARKETS } from './lib/edge-cache';

// The whole point of edgeCached is that it ignores Authorization so one user's
// fetch can serve the next user's. That is only safe for a handler with no
// per-user content, so these tests pin the two properties that keep it safe:
// distinct URLs never collide, and a failing cache never breaks the request.
const ctx = (url: string) => ({
  req: { url, method: 'GET' },
  executionCtx: { waitUntil: (p: Promise<unknown>) => p },
}) as any;

describe('edgeCached', () => {
  it('returns the handler result and marks it a miss', async () => {
    const res = await edgeCached(ctx('https://x.test/api/sets/search?limit=1'), 60,
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
  });

  it('keys on the full URL so different queries never collide', async () => {
    const a = await edgeCached(ctx('https://x.test/api/sets/search?theme=Castle'), 60,
      async () => new Response(JSON.stringify({ which: 'castle' }), { status: 200 }));
    const b = await edgeCached(ctx('https://x.test/api/sets/search?theme=City'), 60,
      async () => new Response(JSON.stringify({ which: 'city' }), { status: 200 }));
    expect(await a.json()).toEqual({ which: 'castle' });
    expect(await b.json()).toEqual({ which: 'city' });
  });

  it('does not cache a non-200 — an error must not stick for the TTL', async () => {
    const produce = vi.fn(async () => new Response('boom', { status: 500 }));
    const url = `https://x.test/api/sets/search?e=${Math.random()}`;
    await edgeCached(ctx(url), 60, produce);
    await edgeCached(ctx(url), 60, produce);
    expect(produce).toHaveBeenCalledTimes(2); // second call re-ran, not served from cache
  });

  it('still serves the request when the cache itself throws', async () => {
    const broken = { default: { match: () => { throw new Error('cache down'); }, put: () => { throw new Error('cache down'); } } };
    vi.stubGlobal('caches', broken);
    try {
      const res = await edgeCached(ctx('https://x.test/api/sets/search?limit=9'), 60,
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('invalidateSetDetail', () => {
  it('purges every market and both set-number spellings', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      default: {
        delete: async (req: Request) => { deleted.push(req.url); return true; },
        match: async () => undefined,
        put: async () => {},
      },
    });
    try {
      await invalidateSetDetail('10182-1');
    } finally {
      vi.unstubAllGlobals();
    }
    // A user may have reached the page as "10182" or "10182-1" — those are
    // separate cache entries, so a revalue has to clear both.
    for (const form of ['10182-1', '10182']) {
      for (const market of RETAIL_MARKETS) {
        expect(deleted).toContain(setDetailCacheKey(form, market));
      }
    }
  });

  it('is a no-op rather than a throw when the Cache API is absent', async () => {
    vi.stubGlobal('caches', undefined);
    try {
      await expect(invalidateSetDetail('10182-1')).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('invalidateSetDetailMany', () => {
  const stubCache = (sink: string[]) => vi.stubGlobal('caches', {
    default: {
      delete: async (req: Request) => { sink.push(req.url); return true; },
      match: async () => undefined,
      put: async () => {},
    },
  });
  // Only the markets users actually chose, not all seven — the crons call this
  // often enough that the difference matters.
  const db = (markets: string[]) => ({
    prepare: () => ({ all: async () => ({ results: markets.map((m) => ({ m })) }) }),
  }) as unknown as D1Database;

  it('purges only the markets in use', async () => {
    const deleted: string[] = [];
    stubCache(deleted);
    try {
      await invalidateSetDetailMany(db(['US']), ['10182-1']);
    } finally { vi.unstubAllGlobals(); }
    expect(deleted).toContain(setDetailCacheKey('10182-1', 'US'));
    expect(deleted).toContain(setDetailCacheKey('10182-1', 'FR')); // anonymous default
    expect(deleted).not.toContain(setDetailCacheKey('10182-1', 'AU'));
  });

  it('caps the purge so a large sweep cannot blow the request budget', async () => {
    const deleted: string[] = [];
    stubCache(deleted);
    // Names chosen so the bare/-1 forms of different sets cannot collide
    // (a "SET-0" would strip to "SET", which every other one shares).
    const many = Array.from({ length: 500 }, (_, i) => `X${i}-1`);
    try {
      await invalidateSetDetailMany(db([]), many, 10);
    } finally { vi.unstubAllGlobals(); }
    expect(deleted.some((u) => u.includes('/X0-1/'))).toBe(true);    // first is purged
    expect(deleted.some((u) => u.includes('/X10-1/'))).toBe(false);  // past the cap is not
    expect(deleted.some((u) => u.includes('/X499-1/'))).toBe(false);
  });

  it('returns 0 without touching the db when there is nothing to purge', async () => {
    const deleted: string[] = [];
    stubCache(deleted);
    try {
      expect(await invalidateSetDetailMany(db([]), [])).toBe(0);
    } finally { vi.unstubAllGlobals(); }
    expect(deleted).toHaveLength(0);
  });
});
