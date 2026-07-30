/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, vi } from 'vitest';
import { edgeCached } from './lib/edge-cache';

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
