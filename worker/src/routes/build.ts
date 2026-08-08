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

const MIN_REQ_PARTS = 50;                       // ignore book/gear/promo "sets"
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;     // refresh weekly (picks up value/catalog drift)
const CACHE_VERSION = 'v2';                     // bump to invalidate all caches (e.g. after a set_parts reload)

async function buildFingerprint(parts: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

  const fingerprint = await buildFingerprint(
    `${CACHE_VERSION}|min=${minParts}|lim=${lim}|`
    + owned.map((r) => `${r.set_num}x${r.quantity || 1}`).join(','),
  );

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

  const cov = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT sp.set_num) AS n
     FROM set_parts sp
     WHERE sp.set_num IN (
       SELECT set_num FROM user_collection
       WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1
     )`,
  ).bind(userId).first<{ n: number }>();

  // Pool = every part/color you own (owned set parts x owned quantity). For each
  // candidate set, have_total = sum(min(required, owned)); req_total = sum(required).
  const sql =
    `WITH pool AS (
       SELECT sp.part_num, sp.color_id, SUM(sp.quantity * uc.quantity) AS have
       FROM user_collection uc
       JOIN set_parts sp ON sp.set_num = uc.set_num
       WHERE uc.user_id = ? AND uc.deleted_at IS NULL AND uc.is_complete = 1
       GROUP BY sp.part_num, sp.color_id
     ),
     cand AS (
       SELECT sp.set_num,
              COUNT(DISTINCT sp.part_num) AS distinct_parts,
              MAX(sp.quantity) AS max_part_qty,
              SUM(sp.quantity) AS req_total,
              SUM(MIN(sp.quantity, COALESCE(p.have, 0))) AS have_total
       FROM set_parts sp
       LEFT JOIN pool p ON p.part_num = sp.part_num AND p.color_id = sp.color_id
       WHERE sp.is_spare = 0 AND sp.set_num NOT IN (
         SELECT set_num FROM user_collection
         WHERE user_id = ? AND deleted_at IS NULL AND is_complete = 1
       )
       GROUP BY sp.set_num
     )
     SELECT c.set_num, s.name, s.theme, s.year, s.pieces, s.image_url,
            s.current_value, c.req_total, c.have_total,
            ROUND(100.0 * c.have_total / c.req_total, 1) AS pct
     FROM cand c
     JOIN lego_sets s ON s.set_num = c.set_num
     WHERE c.req_total >= ? AND c.have_total > 0
       -- Exclude spare-part / brick-pack / assortment 'sets': they are
       -- trivially 'buildable' but are not real models. Real builds use
       -- many distinct part molds and aren't dominated by one part.
       AND c.distinct_parts >= 8
       AND (c.max_part_qty * 1.0 / c.req_total) < 0.7
       AND COALESCE(s.theme, '') NOT IN ('Bulk Bricks', 'Service Packs', 'Supplemental', 'Educational and Dacta')
       AND s.name NOT LIKE 'Extra Bricks%'
       AND s.name NOT LIKE 'Basic Bricks%'
       AND s.name NOT LIKE '%Pack of%'
       AND s.name NOT LIKE '%Assortment%'
       AND s.name NOT LIKE '%Large Package%'
     ORDER BY (c.have_total >= c.req_total) DESC, pct DESC, c.req_total DESC
     LIMIT ?`;
  const rows = await c.env.DB.prepare(sql)
    .bind(userId, userId, minParts, lim)
    .all<Record<string, unknown>>();

  const builds = (rows.results || []).map((r) => {
    const req = Number(r.req_total) || 0;
    const have = Number(r.have_total) || 0;
    return {
      set_num: r.set_num, name: r.name, theme: r.theme, year: r.year,
      pieces: r.pieces, image_url: r.image_url, current_value: r.current_value,
      req_total: req, have_total: have,
      pct: Number(r.pct) || 0,
      need: Math.max(0, req - have),
      buildable: have >= req,
    };
  });

  const payload = {
    builds,
    can_build: builds.filter((b) => b.buildable).length,
    near: builds.filter((b) => !b.buildable && b.pct >= 80).length,
    owned_sets: ownedSets.length,
    parts_sets: cov?.n ?? 0,
    min_parts: minParts,
  };

  // Cache write is best-effort and off the response path.
  c.executionCtx.waitUntil((async () => {
    try {
      await c.env.DB.prepare(
        `INSERT INTO user_build_cache (user_id, fingerprint, payload, computed_at)
         VALUES (?, ?, ?, CAST(strftime('%s','now') AS INTEGER))
         ON CONFLICT(user_id) DO UPDATE SET
           fingerprint=excluded.fingerprint, payload=excluded.payload, computed_at=excluded.computed_at`,
      ).bind(userId, fingerprint, JSON.stringify(payload)).run();
    } catch (e) {
      console.warn('[build/sets] cache write failed:', (e as Error).message);
    }
  })());

  return c.json({ ...payload, cached: false });
});

export { app as buildRoute };
