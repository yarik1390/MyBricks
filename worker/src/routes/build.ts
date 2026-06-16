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
  const ph = setNums.map(() => '?').join(',');
  const fetched = await env.DB.prepare(
    `SELECT set_num FROM set_alts_fetched WHERE set_num IN (${ph})`,
  ).bind(...setNums).all<{ set_num: string }>();
  const done = new Set((fetched.results || []).map((r) => r.set_num));
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

  const ph = ownedSets.map(() => '?').join(',');
  const orderBy = sort === 'parts_desc'
    ? '(ab.num_parts IS NULL) ASC, ab.num_parts DESC, ab.name ASC'
    : sort === 'name_asc'
      ? 'ab.name ASC'
      : '(ab.num_parts IS NULL) ASC, ab.num_parts ASC, ab.name ASC';

  const filters: string[] = [`ab.set_num IN (${ph})`];
  const params: unknown[] = [...ownedSets];
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
     FROM set_alt_builds WHERE set_num IN (${ph})`,
  ).bind(...ownedSets).first<{ n: number; sets: number }>();

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

export { app as buildRoute };
