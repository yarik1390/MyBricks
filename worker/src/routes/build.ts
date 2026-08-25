import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

import { ensureAltsCached } from '../lib/build-alts';

// GET /api/build — models the user can build from the sets they already own.
// Each owned COMPLETE set contributes its Rebrickable alternate builds (MOCs
// buildable from that set's parts), each with an instructions link. The user
// owns the full set, so every alternate is buildable — no fabricated gap.
app.get('/', async (c) => {
  const userId = c.get('userId');
  const q = (c.req.query('q') || '').trim();
  const sort = c.req.query('sort') || 'parts_asc';
  const lim = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);

  const ownedRes = await c.env.DB.prepare(
    `SELECT DISTINCT set_num FROM user_collection
     WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1`,
  ).bind(userId).all<{ set_num: string }>();
  const ownedSets = (ownedRes.results || []).map((r) => r.set_num);

  if (!ownedSets.length) {
    return c.json({ builds: [], total: 0, can_build: 0, owned_sets: 0,
      sets_with_alts: 0, indexing: 0, hasMore: false });
  }

  let indexing = 0;
  try {
    indexing = await ensureAltsCached(c.env, ownedSets);
  } catch (e) {
    console.warn('[build] ensureAltsCached failed:', (e as Error).message);
  }

  const orderBy = sort === 'parts_desc'
    ? '(ab.num_parts IS NULL) ASC, ab.num_parts DESC, ab.name ASC'
    : sort === 'name_asc'
      ? 'ab.name ASC'
      : '(ab.num_parts IS NULL) ASC, ab.num_parts ASC, ab.name ASC';

  const filters: string[] = [`ab.set_num IN (
    SELECT set_num FROM user_collection
    WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1
  )`];
  const params: unknown[] = [userId];
  if (q) { filters.push('LOWER(ab.name) LIKE LOWER(?)'); params.push(`%${q}%`); }
  const whereSQL = `WHERE ${filters.join(' AND ')}`;

  const countRow = await c.env.DB.prepare(
    `SELECT CAST(COUNT(*) AS INTEGER) AS n FROM set_alt_builds ab ${whereSQL}`,
  ).bind(...params).first<{ n: number }>();
  const total = countRow?.n ?? 0;

  const rows = await c.env.DB.prepare(
    `SELECT ab.moc_num, ab.name, ab.num_parts, ab.year, ab.designer,
            ab.moc_img_url, ab.moc_url, ab.set_num AS from_set_num,
            s.name AS from_set_name, s.image_url AS from_set_img
     FROM set_alt_builds ab
     JOIN lego_sets s ON s.set_num = ab.set_num
     ${whereSQL}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
  ).bind(...params, lim, offset).all<Record<string, unknown>>();

  const canRow = await c.env.DB.prepare(
    `SELECT CAST(COUNT(*) AS INTEGER) AS n,
            CAST(COUNT(DISTINCT set_num) AS INTEGER) AS sets
     FROM set_alt_builds WHERE set_num IN (
       SELECT set_num FROM user_collection
       WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1
     )`,
  ).bind(userId).first<{ n: number; sets: number }>();

  return c.json({
    builds: rows.results || [],
    total,
    can_build: canRow?.n ?? 0,
    sets_with_alts: canRow?.sets ?? 0,
    owned_sets: ownedSets.length,
    indexing,
    hasMore: offset + (rows.results?.length || 0) < total,
  });
});

// ---------------------------------------------------------------------------
// Parts-based matcher: official LEGO sets you can build from the COMBINED parts
// of the sets you already own, with completion % and "Need N". Powered by the
// bulk-loaded set_parts table. Results are CACHED per user, keyed by a
// fingerprint of their owned sets, so repeat opens are instant and we avoid
// re-scanning ~4M set_parts rows. The cache auto-invalidates when the
// collection changes (fingerprint differs) or after CACHE_TTL_SECONDS.
// The heavy compute lives in lib/build-matcher.ts so collection mutations can
// pre-warm this exact cache in the background (scheduleBuildCacheRecompute).

import { MIN_REQ_PARTS, CACHE_TTL_SECONDS, fingerprintFor, computeAndCacheBuildableSets } from '../lib/build-matcher';

// GET /api/build/sets
app.get('/sets', async (c) => {
  const userId = c.get('userId');
  const minParts = Math.min(
    Math.max(parseInt(c.req.query('min') || String(MIN_REQ_PARTS), 10) || MIN_REQ_PARTS, 1),
    5000,
  );
  const lim = Math.min(parseInt(c.req.query('limit') || '120', 10), 300);
  const noCache = c.req.query('refresh') === '1';

  // Owned, complete sets (with quantity) define both the parts pool and the cache key.
  const ownedRes = await c.env.DB.prepare(
    `SELECT set_num, quantity FROM user_collection
     WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1
     ORDER BY set_num`,
  ).bind(userId).all<{ set_num: string; quantity: number }>();
  const owned = ownedRes.results || [];
  const ownedSets = owned.map((r) => r.set_num);
  if (!ownedSets.length) {
    return c.json({ builds: [], can_build: 0, near: 0, owned_sets: 0, parts_sets: 0, min_parts: minParts, cached: false });
  }

  const fingerprint = await fingerprintFor(userId, owned, minParts, lim);

  // Cache lookup (fingerprint match + within TTL). Best-effort; never fail on it.
  if (!noCache) {
    try {
      const hit = await c.env.DB.prepare(
        `SELECT payload, computed_at FROM user_build_cache WHERE user_id = ? AND fingerprint = ?`,
      ).bind(userId, fingerprint).first<{ payload: string; computed_at: number }>();
      if (hit) {
        const ageSec = Math.floor(Date.now() / 1000) - Number(hit.computed_at);
        if (ageSec < CACHE_TTL_SECONDS) {
          return c.json({ ...JSON.parse(hit.payload), cached: true });
        }
      }
    } catch (e) {
      console.warn('[build/sets] cache read failed:', (e as Error).message);
    }
  }

  // Heavy compute via the shared matcher — also persists the result into
  // user_build_cache so collection mutations can pre-warm this exact payload.
  const computed = await computeAndCacheBuildableSets(c.env, userId, minParts, lim);
  if (!computed) {
    return c.json({ builds: [], can_build: 0, near: 0, owned_sets: 0, parts_sets: 0, min_parts: minParts, cached: false });
  }
  return c.json({ ...computed.payload, cached: false });
});

export { app as buildRoute };
