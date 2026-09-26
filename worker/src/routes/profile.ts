import { Hono } from 'hono';
import { optionalMember, requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { holdingValueForRollout } from '../lib/market-sources';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const HOLDING_VALUE_COLUMNS = `uc.set_num, uc.condition, uc.quantity,
  ls.current_value, ls.blended_value, ls.used_value,
  ls.ebay_used_value, ls.pc_new_value, ls.pc_complete_value,
  svn.fair_value AS v3_new_fair, svu.fair_value AS v3_used_fair`;

// Up to six trophy sets in shelf order, each valued like the rest of the vault.
async function loadShowcase(env: Env, userId: string) {
  const res = await env.DB.prepare(`
    SELECT ${HOLDING_VALUE_COLUMNS}, ls.name, ls.theme, ls.year, ls.pieces,
           ls.minifigs, ls.image_url, ls.retired, ls.valuation_method
    FROM user_showcase us
    JOIN user_collection uc ON uc.user_id = us.user_id
      AND uc.set_num = us.set_num AND uc.deleted_at IS NULL
    JOIN lego_sets ls ON ls.set_num = us.set_num
    LEFT JOIN set_valuation_state svn ON svn.set_num=ls.set_num AND svn.condition='new_sealed'
    LEFT JOIN set_valuation_state svu ON svu.set_num=ls.set_num AND svu.condition='used_complete'
    WHERE us.user_id=?
    ORDER BY us.display_order ASC
    LIMIT 6
  `).bind(userId).all<Record<string, unknown>>();
  const rolloutPercent = Number(env.PRICING_V3_READ_PERCENT || 0);
  return (res.results || []).map(s => ({
    ...s,
    retired: !!s.retired,
    market_value: holdingValueForRollout(s, rolloutPercent),
  }));
}

// GET /api/users/leaderboard — public ranking of opted-in collections by value.
// Opt-in = a public profile that also exposes its value and has a handle.
app.get('/leaderboard', async (c) => {
  // Bound the joined scan to at most 2000 public users via CTE to prevent unbounded row expansion.
  // JS aggregation via holdingValueForRollout remains the single source of truth so totals stay exact for included users.
  // ORDER BY makes the bound deterministic (a stable prefix) rather than an arbitrary subset.
  const res = await c.env.DB.prepare(`
    WITH public_users AS (
      SELECT user_id, handle, display_name, is_supporter
      FROM user_prefs
      WHERE is_public = 1 AND expose_public_value = 1 AND handle IS NOT NULL
      ORDER BY user_id
      LIMIT 2000
    )
    SELECT p.user_id, p.handle, p.display_name, p.is_supporter,
           ${HOLDING_VALUE_COLUMNS}
    FROM public_users p
    JOIN user_collection uc ON uc.user_id = p.user_id AND uc.deleted_at IS NULL
    JOIN lego_sets ls ON ls.set_num = uc.set_num
    LEFT JOIN set_valuation_state svn ON svn.set_num=ls.set_num AND svn.condition='new_sealed'
    LEFT JOIN set_valuation_state svu ON svu.set_num=ls.set_num AND svu.condition='used_complete'
  `).all<Record<string, unknown>>();
  const rolloutPercent = Number(c.env.PRICING_V3_READ_PERCENT || 0);
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of res.results || []) {
    const userId = String(row.user_id);
    const current = grouped.get(userId) || { ...row, set_count: 0, total_value: 0 };
    current.set_count = Number(current.set_count) + 1;
    current.total_value = Number(current.total_value) + holdingValueForRollout(row, rolloutPercent) * Number(row.quantity || 1);
    grouped.set(userId, current);
  }
  const everyone = [...grouped.values()];

  // "Rising": change against each collector's own snapshot from ~30 days ago
  // (the newest one at least 30 days old). Null when there's no history.
  const monthAgo = new Map<string, number>();
  const snaps = await c.env.DB.prepare(`
    SELECT ps.user_id, ps.total_value FROM portfolio_snapshots ps
    JOIN (SELECT s.user_id, MAX(s.snapshot_date) AS d FROM portfolio_snapshots s
          JOIN user_prefs p ON p.user_id = s.user_id
          WHERE p.is_public = 1 AND p.expose_public_value = 1 AND p.handle IS NOT NULL
            AND s.snapshot_date <= date('now', '-30 days')
          GROUP BY s.user_id) m
      ON m.user_id = ps.user_id AND m.d = ps.snapshot_date
  `).all<{ user_id: string; total_value: number }>().catch(() => ({ results: [] as { user_id: string; total_value: number }[] }));
  for (const s of snaps.results || []) if (Number(s.total_value) > 0) monthAgo.set(String(s.user_id), Number(s.total_value));
  const change = (r: Record<string, unknown>) => {
    const before = monthAgo.get(String(r.user_id));
    return before ? Math.round(((Number(r.total_value) - before) / before) * 1000) / 10 : null;
  };

  // ?sort=value (default) | sets | rising. Rising only ranks collectors with
  // a month of history.
  // Only the value-based rankings need a valuation; a collection whose sets
  // aren't priced yet still has a real set count.
  const sort = c.req.query('sort') === 'sets' ? 'sets' : c.req.query('sort') === 'rising' ? 'rising' : 'value';
  const byValue = (a: Record<string, unknown>, b: Record<string, unknown>) => Number(b.total_value) - Number(a.total_value);
  const valued = everyone.filter(r => Number(r.total_value) > 0);
  const pool = sort === 'sets' ? everyone : sort === 'rising' ? valued.filter(r => change(r) !== null) : valued;
  const allRanked = [...pool].sort(
    sort === 'sets' ? (a, b) => (Number(b.set_count) - Number(a.set_count)) || byValue(a, b)
      : sort === 'rising' ? (a, b) => (Number(change(b)) - Number(change(a))) || byValue(a, b)
      : byValue,
  );
  const leaders = allRanked.slice(0, 50).map((r, i) => ({
    rank: i + 1,
    handle: r.handle,
    display_name: r.display_name || r.handle,
    is_supporter: r.is_supporter === 1,
    set_count: r.set_count,
    total_value: r.total_value,
    change_30d_pct: change(r),
  }));

  // ?value= / ?sets= let a private collector see where they would land
  // ("You'd be #214 of 1,204") without joining.
  const probe = Number(c.req.query(sort === 'sets' ? 'sets' : 'value'));
  const wouldRank = sort !== 'rising' && Number.isFinite(probe) && probe > 0
    ? allRanked.filter(r => Number(sort === 'sets' ? r.set_count : r.total_value) > probe).length + 1
    : null;
  return c.json({ leaders, total: allRanked.length, sort, would_rank: wouldRank });
});

// GET /api/users/:handle/profile — public, no auth required. A signed-in
// owner also gets their own profile while it is private, as a preview
// (is_owner / is_public tell the page to say so); anyone else gets a 404.
app.get('/:handle/profile', optionalMember, async (c) => {
  const handle = c.req.param('handle');
  const prefs = await c.env.DB.prepare(
    `SELECT user_id, display_name, is_public, expose_public_value, is_supporter FROM user_prefs WHERE handle=?`
  ).bind(handle).first<{ user_id: string; display_name: string; is_public: number; expose_public_value: number; is_supporter: number }>();

  const isOwner = !!prefs && !!c.get('userId') && c.get('userId') === prefs.user_id;
  if (!prefs || (!prefs.is_public && !isOwner)) return c.json({ error: 'Profile not found' }, 404);

  const userId = prefs.user_id;
  const exposeValue = prefs.expose_public_value !== 0;

  const [holdingResult, showcase, contribCount] = await Promise.all([
    c.env.DB.prepare(`
      SELECT ${HOLDING_VALUE_COLUMNS}, ls.theme, ls.pieces, uc.added_at
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      LEFT JOIN set_valuation_state svn ON svn.set_num=ls.set_num AND svn.condition='new_sealed'
      LEFT JOIN set_valuation_state svu ON svu.set_num=ls.set_num AND svu.condition='used_complete'
      WHERE uc.user_id=? AND uc.deleted_at IS NULL
    `).bind(userId).all<Record<string, unknown>>(),

    loadShowcase(c.env, userId),

    c.env.DB.prepare(`
      SELECT (
        SELECT COUNT(*) FROM set_reviews WHERE user_id=? AND status='approved' AND deleted_at IS NULL
      ) + (
        SELECT COUNT(*) FROM set_photos WHERE user_id=? AND status='approved' AND deleted_at IS NULL
      ) + (
        SELECT COUNT(*) FROM set_contributions WHERE user_id=? AND status='approved' AND deleted_at IS NULL
      ) AS approved_contributions
    `).bind(userId, userId, userId).first<{ approved_contributions: number }>(),
  ]);
  const rolloutPercent = Number(c.env.PRICING_V3_READ_PERCENT || 0);
  let totalValue = 0;
  let pieceCount = 0;
  let firstAdded: string | null = null;
  const themeValues = new Map<string, number>();
  for (const row of holdingResult.results || []) {
    const value = holdingValueForRollout(row, rolloutPercent) * Number(row.quantity || 1);
    totalValue += value;
    pieceCount += (Number(row.pieces) || 0) * Number(row.quantity || 1);
    const added = row.added_at ? String(row.added_at) : null;
    if (added && (!firstAdded || added < firstAdded)) firstAdded = added;
    const theme = String(row.theme || 'Other');
    themeValues.set(theme, (themeValues.get(theme) || 0) + value);
  }
  const themes = [...themeValues.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, value]) => ({ theme, value: exposeValue ? value : null }));

  return c.json({
    handle,
    is_public: !!prefs.is_public,
    is_owner: isOwner,
    display_name: prefs.display_name || handle,
    is_supporter: prefs.is_supporter === 1,
    approved_contributions: contribCount?.approved_contributions ?? 0,
    expose_public_value: exposeValue,
    set_count: holdingResult.results?.length ?? 0,
    piece_count: pieceCount,
    collecting_since: firstAdded ? Number(firstAdded.slice(0, 4)) || null : null,
    total_value: exposeValue ? totalValue : null,
    top_themes: themes,
    showcase,
  });
});

// GET /api/users/:handle/showcase — auth required, own handle only. The shelf
// editor reads from here: the public profile 404s while private, and editing
// an empty stand-in would overwrite the stored shelf.
app.get('/:handle/showcase', requireMember, async (c) => {
  const userId = c.get('userId');
  const prefs = await c.env.DB.prepare(
    'SELECT user_id FROM user_prefs WHERE handle=? AND user_id=?'
  ).bind(c.req.param('handle'), userId).first();
  if (!prefs) return c.json({ error: 'Not your profile' }, 403);
  return c.json({ showcase: await loadShowcase(c.env, userId) });
});

// POST /api/users/:handle/showcase — auth required, own handle only
app.post('/:handle/showcase', requireMember, async (c) => {
  const userId = c.get('userId');
  const handle = c.req.param('handle');

  const prefs = await c.env.DB.prepare(
    'SELECT user_id FROM user_prefs WHERE handle=? AND user_id=?'
  ).bind(handle, userId).first();
  if (!prefs) return c.json({ error: 'Not your profile' }, 403);

  const body = await c.req.json<{ set_nums?: string[] }>().catch(() => ({ set_nums: [] }));
  const setNums = (body.set_nums ?? []).slice(0, 6);

  const stmts = [
    c.env.DB.prepare('DELETE FROM user_showcase WHERE user_id=?').bind(userId),
    ...setNums.map((sn, i) =>
      c.env.DB.prepare(
        'INSERT OR IGNORE INTO user_showcase (user_id, set_num, display_order) VALUES (?,?,?)'
      ).bind(userId, sn, i)
    ),
  ];
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// GET /api/users/check-handle/:handle — check if handle is available
app.get('/check-handle/:handle', requireMember, async (c) => {
  const handle = c.req.param('handle') || '';
  const userId = c.get('userId');
  
  if (!/^[a-zA-Z0-9-]{3,30}$/.test(handle)) {
    return c.json({ available: false, error: 'Must be 3-30 alphanumeric characters or hyphens' });
  }
  
  const existing = await c.env.DB.prepare(
    'SELECT user_id FROM user_prefs WHERE handle=? AND user_id != ?'
  ).bind(handle, userId).first();
  
  return c.json({ available: !existing });
});

export { app as profileRoute };

