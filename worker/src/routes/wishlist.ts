import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// GET /api/wishlist
app.get('/', async (c) => {
  const userId = c.get('userId');
  const [wl, alerts] = await Promise.all([
    c.env.DB.prepare(`
      SELECT w.id, w.set_num, w.target_price, w.notes, w.added_at, w.alerted_at,
        s.name, s.theme, s.year, s.image_url, s.current_value, s.forecast_2y, s.retail_price
      FROM user_wishlist w
      JOIN lego_sets s ON s.set_num = w.set_num
      WHERE w.user_id = ?
      ORDER BY w.added_at DESC
    `).bind(userId).all(),
    c.env.DB.prepare(`
      SELECT * FROM wishlist_alerts
      WHERE user_id = ? AND read_at IS NULL
      ORDER BY triggered_at DESC
    `).bind(userId).all(),
  ]);
  return c.json({ wishlist: wl.results, unread_alerts: alerts.results });
});

// POST /api/wishlist
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ set_num?: string; target_price?: number; notes?: string }>();
  const { set_num, target_price, notes } = body;
  if (!set_num) return c.json({ error: 'set_num required' }, 400);

  await c.env.DB.prepare(`
    INSERT INTO user_wishlist (user_id, set_num, target_price, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, set_num) DO UPDATE SET
      target_price = COALESCE(EXCLUDED.target_price, user_wishlist.target_price),
      notes = COALESCE(EXCLUDED.notes, user_wishlist.notes)
  `).bind(userId, set_num, target_price ?? null, notes ?? null).run();

  const item = await c.env.DB.prepare(
    'SELECT * FROM user_wishlist WHERE user_id=? AND set_num=?'
  ).bind(userId, set_num).first();
  return c.json({ item }, 201);
});

// DELETE /api/wishlist/:id
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  await c.env.DB.prepare('DELETE FROM user_wishlist WHERE id=? AND user_id=?').bind(id, userId).run();
  return new Response('', { status: 204 });
});

// POST /api/wishlist/:id — mark alert as read
app.post('/:id', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  await c.env.DB.prepare(
    `UPDATE wishlist_alerts SET read_at=datetime('now') WHERE id=? AND user_id=?`
  ).bind(id, userId).run();
  return c.json({ ok: true });
});

export { app as wishlistRoute };
