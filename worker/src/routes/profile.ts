import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/users/:handle/profile — public, no auth required
app.get('/:handle/profile', async (c) => {
  const handle = c.req.param('handle');
  const prefs = await c.env.DB.prepare(
    `SELECT user_id, display_name, is_public, expose_public_value FROM user_prefs WHERE handle=?`
  ).bind(handle).first<{ user_id: string; display_name: string; is_public: number; expose_public_value: number }>();

  if (!prefs || !prefs.is_public) return c.json({ error: 'Profile not found' }, 404);

  const userId = prefs.user_id;
  const exposeValue = prefs.expose_public_value !== 0;

  const [stats, topThemes, showcase] = await Promise.all([
    c.env.DB.prepare(`
      SELECT COUNT(*) as set_count,
             COALESCE(SUM(COALESCE(ls.blended_value, ls.current_value) * uc.quantity), 0) as total_value
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      WHERE uc.user_id=? AND uc.deleted_at IS NULL
    `).bind(userId).first<{ set_count: number; total_value: number }>(),

    c.env.DB.prepare(`
      SELECT ls.theme, SUM(COALESCE(ls.blended_value, ls.current_value) * uc.quantity) as value
      FROM user_collection uc
      JOIN lego_sets ls ON ls.set_num = uc.set_num
      WHERE uc.user_id=? AND uc.deleted_at IS NULL AND ls.theme IS NOT NULL
      GROUP BY ls.theme
      ORDER BY value DESC
      LIMIT 5
    `).bind(userId).all<{ theme: string; value: number }>(),

    c.env.DB.prepare(`
      SELECT ls.*
      FROM user_showcase us
      JOIN lego_sets ls ON ls.set_num = us.set_num
      WHERE us.user_id=?
        AND EXISTS (
          SELECT 1 FROM user_collection uc
          WHERE uc.user_id = us.user_id
            AND uc.set_num = us.set_num
            AND uc.deleted_at IS NULL
        )
      ORDER BY us.display_order ASC
      LIMIT 6
    `).bind(userId).all<Record<string, unknown>>(),
  ]);

  const themes = (topThemes.results || []).map(t => ({
    theme: t.theme,
    value: exposeValue ? t.value : null
  }));

  return c.json({
    handle,
    display_name: prefs.display_name || handle,
    expose_public_value: exposeValue,
    set_count: stats?.set_count ?? 0,
    total_value: exposeValue ? (stats?.total_value ?? 0) : null,
    top_themes: themes,
    showcase: showcase.results.map(s => ({ ...s, retired: !!s.retired })),
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

