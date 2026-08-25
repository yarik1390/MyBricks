import { Hono } from 'hono';
import { requireMember } from '../auth';
import { fetchSetAlternates } from '../lib/rebrickable';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// Cap how many not-yet-indexed owned sets we fetch alternates for synchronously
// on a cold load, to stay within the Worker subrequest budget. The rest get
// indexed on subsequent calls; the response reports how many remain.
const SYNC_FETCH_CAP = 6;

// Ensure set_alt_builds is populated for the given sets. Sets we've never
// fetched are pulled from Rebrickable (capped), cached, and marked fetched.
// Returns the number of sets still un-indexed after this pass.
async function ensureAltsCached(env: Env, setNums: string[]): Promise<number> {
  if (!setNums.length) return 0;
  // D1 allows at most 100 bound parameters per individual statement on every
  // plan. A serious collector can own far more than that, so discover cached
  // sets in bounded chunks rather than building one unbounded IN (...).
  const done = new Set<string>();
  for (let i = 0; i < setNums.length; i += 90) {
    const chunk = setNums.slice(i, i + 90);
    const ph = chunk.map(() => '?').join(',');
    const fetched = await env.DB.prepare(
      `SELECT set_num FROM set_alts_fetched WHERE set_num IN (${ph})`,
    ).bind(...chunk).all<{ set_num: string }>();
    for (const row of fetched.results || []) done.add(row.set_num);
  }
  const pending = setNums.filter((s) => !done.has(s));
  if (!pending.length) return 0;

  const toFetch = pending.slice(0, SYNC_FETCH_CAP);
  for (const setNum of toFetch) {
    const alts = await fetchSetAlternates(setNum, env);
    if (alts === null) continue; // missing key / hard failure — retry next time
    const stmts: D1PreparedStatement[] = alts.map((a) => env.DB.prepare(
      `INSERT INTO set_alt_builds
         (set_num,moc_num,name,num_parts,year,designer,moc_img_url,moc_url,cached_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(set_num,moc_num) DO UPDATE SET
         name=excluded.name, num_parts=excluded.num_parts, year=excluded.year,
         designer=excluded.designer, moc_img_url=excluded.moc_img_url,
         moc_url=excluded.moc_url, cached_at=datetime('now')`,
    ).bind(setNum, a.moc_num, a.name, a.num_parts, a.year, a.designer,
           a.moc_img_url, a.moc_url));
    stmts.push(env.DB.prepare(
      `INSERT INTO set_alts_fetched (set_num,fetched_at,alt_count)
       VALUES (?,datetime('now'),?)
       ON CONFLICT(set_num) DO UPDATE SET
         fetched_at=datetime('now'), alt_count=excluded.alt_count`,
    ).bind(setNum, alts.length));
    for (let i = 0; i < stmts.length; i += 100) {
      await env.DB.batch(stmts.slice(i, i + 100));
    }
  }
  return Math.max(0, pending.length - toFetch.length);
}

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
