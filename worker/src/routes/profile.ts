import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { holdingValueForRollout } from '../lib/market-sources';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const HOLDING_VALUE_COLUMNS = `uc.set_num, uc.condition, uc.quantity,
  ls.current_value, ls.blended_value, ls.used_value,
  ls.ebay_used_value, ls.bo_used_value, ls.pc_new_value, ls.pc_complete_value,
  svn.fair_value AS v3_new_fair, svu.fair_value AS v3_used_fair`;

// GET /api/users/leaderboard — public ranking of opted-in collections by value.
// Opt-in = a public profile that also exposes its value and has a handle.
app.get('/leaderboard', async (c) => {
  const res = await c.env.DB.prepare(`
    SELECT p.user_id, p.handle, p.display_name, p.is_supporter,
           ${HOLDING_VALUE_COLUMNS}
    FROM user_prefs p
    JOIN user_collection uc ON uc.user_id = p.user_id AND uc.deleted_at IS NULL
    JOIN lego_sets ls ON ls.set_num = uc.set_num
    LEFT JOIN set_valuation_state svn ON svn.set_num=ls.set_num AND svn.condition='new_sealed'
    LEFT JOIN set_valuation_state svu ON svu.set_num=ls.set_num AND svu.condition='used_complete'
    WHERE p.is_public = 1 AND p.expose_public_value = 1 AND p.handle IS NOT NULL
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
  const ranked = [...grouped.values()]
    .filter(row => Number(row.total_value) > 0)
    .sort((a, b) => Number(b.total_value) - Number(a.total_value))
    .slice(0, 50);
  const leaders = ranked.map((r, i) => ({
    rank: i + 1,
    handle: r.handle,
    display_name: r.display_name || r.handle,
    is_supporter: r.is_supporter === 1,
    set_count: r.set_count,
    total_value: r.total_value,
  }));
  return c.json({ leaders });
});

// GET /api/users/:handle/profile — public, no auth required
app.get('/:handle/profile', async (c) => {
  const handle = c.req.param('handle');
  const prefs = await c.env.DB.prepare(
    `SELECT user_id, display_name, is_public, expose_public_value, is_supporter FROM user_prefs WHERE handle=?`
  ).bind(handle).first<{ user_id: string; display_name: string; is_public: number; expose_public_value: number; is_supporter: number }>();

  if (!prefs || !prefs.is_public) return c.json({ error: 'Profile not found' }, 404);

  const userId = prefs.user_id;
  const exposeValue = prefs.expose_public_value !== 0;

  const [holdingResult, showcase, contribCount] = await Promise.all([
    c.env.DB.prepare(`
      SELECT ${HOLDING_VALUE_COLUMNS}, ls.theme
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      LEFT JOIN set_valuation_state svn ON svn.set_num=ls.set_num AND svn.condition='new_sealed'
      LEFT JOIN set_valuation_state svu ON svu.set_num=ls.set_num AND svu.condition='used_complete'
      WHERE uc.user_id=? AND uc.deleted_at IS NULL
    `).bind(userId).all<Record<string, unknown>>(),

    c.env.DB.prepare(`
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
    `).bind(userId).all<Record<string, unknown>>(),

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
  const themeValues = new Map<string, number>();
  for (const row of holdingResult.results || []) {
    const value = holdingValueForRollout(row, rolloutPercent) * Number(row.quantity || 1);
    totalValue += value;
    const theme = String(row.theme || 'Other');
    themeValues.set(theme, (themeValues.get(theme) || 0) + value);
  }
  const themes = [...themeValues.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([theme, value]) => ({ theme, value: exposeValue ? value : null }));

  return c.json({
    handle,
    display_name: prefs.display_name || handle,
    is_supporter: prefs.is_supporter === 1,
    approved_contributions: contribCount?.approved_contributions ?? 0,
    expose_public_value: exposeValue,
    set_count: holdingResult.results?.length ?? 0,
    total_value: exposeValue ? totalValue : null,
    top_themes: themes,
    showcase: showcase.results.map(s => ({
      ...s,
      retired: !!s.retired,
      market_value: holdingValueForRollout(s, rolloutPercent),
    })),
  });
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

