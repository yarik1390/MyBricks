import type { Context } from 'hono';
import type { Env, Variables } from '../types';

// ---------------------------------------------------------------------------
// Colo-local edge cache for responses that are IDENTICAL for every caller.
//
// The global Cache-Control middleware in index.ts only marks a response public
// when the request carried no Authorization header. That is the right default —
// most endpoints are user-specific — but it means a signed-in user never gets a
// cached catalog, and the catalog is the app's most-hit surface. Since the app
// is used signed-in, effectively nothing was being cached in practice.
//
// This caches on the URL ALONE, deliberately ignoring Authorization, which is
// what lets one user's fetch serve the next user's. That is only sound for a
// response with no per-user content, so:
//
//   *** ONLY wrap a handler you have verified never reads c.get('userId') ***
//
// /api/sets/search qualifies (it takes no user input and joins no user table).
// /api/sets/:setnum does NOT — it embeds the caller's collection entry.
// /api/minifigs does NOT — it joins user_minifigs for owned status.
//
// Failures are swallowed: a cache miss or a put error must never fail a request.
// ---------------------------------------------------------------------------

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

export async function edgeCached(
  c: Ctx,
  ttlSeconds: number,
  produce: () => Promise<Response>,
): Promise<Response> {
  // Cache API is unavailable in some test/dev runtimes — fall straight through.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache || c.req.method !== 'GET') return produce();

  const key = new Request(new URL(c.req.url).toString(), { method: 'GET' });
  try {
    const hit = await cache.match(key);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('X-Edge-Cache', 'HIT');
      return res;
    }
  } catch { /* fall through to a live read */ }

  const res = await produce();
  if (res.status === 200) {
    try {
      // The stored copy carries its own Cache-Control; the response we return is
      // still subject to the global middleware, so the browser is unaffected.
      const stored = new Response(res.clone().body, res);
      stored.headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
      stored.headers.delete('Set-Cookie');
      c.executionCtx?.waitUntil?.(cache.put(key, stored).catch(() => {}));
    } catch { /* caching is best-effort */ }
  }
  res.headers.set('X-Edge-Cache', 'MISS');
  return res;
}
