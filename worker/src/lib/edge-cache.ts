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
  /**
   * Override the cache key. Use when the request URL is NOT the right identity
   * for the cached body — e.g. set detail caches only the shared half of its
   * response, keyed by (set, retail market), while the per-user half is fetched
   * live and merged by the caller. Must be an absolute URL and must include
   * every input the cached body varies on.
   */
  keyUrl?: string,
): Promise<Response> {
  // Cache API is unavailable in some test/dev runtimes — fall straight through.
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache || c.req.method !== 'GET') return produce();

  const key = new Request(keyUrl ?? new URL(c.req.url).toString(), { method: 'GET' });
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

/** Markets a user can pick (user_prefs.retail_market). Shared so the set-detail
 *  cache key and its invalidation cannot drift apart from the validation list. */
export const RETAIL_MARKETS = ['FR', 'US', 'GB', 'DE', 'CA', 'AU', 'NL'];

/** Cache key for set detail's shared half. The raw request param is used rather
 *  than the resolved set_num because the key has to be computable BEFORE the
 *  lookup — which means "10182" and "10182-1" occupy separate entries for the
 *  same set, so invalidation has to cover both forms. */
export function setDetailCacheKey(setnum: string, market: string): string {
  return `https://set-detail.internal/${encodeURIComponent(setnum)}/${encodeURIComponent(market)}`;
}

/**
 * Drop every cached variant of one set: both the bare and -1 spellings, across
 * all markets. Called when a user forces a revaluation — without it a longer TTL
 * would leave them staring at the old price after clicking the button, which
 * reads as "revalue is broken" rather than "the cache is doing its job".
 * Best-effort: a failed purge only costs one stale window.
 */
export async function invalidateSetDetail(setnum: string): Promise<void> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!cache) return;
  const bare = setnum.replace(/-\d+$/, '');
  const forms = [...new Set([setnum, bare, `${bare}-1`])];
  await Promise.all(
    forms.flatMap((form) =>
      RETAIL_MARKETS.map((m) => cache.delete(new Request(setDetailCacheKey(form, m))).catch(() => false)),
    ),
  );
}
