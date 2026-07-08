import { Hono } from 'hono';
import { requireMember } from '../auth';
import { enrichSetRecord } from '../lib/market-sources';
import { weeklySlopeUSD } from '../lib/price-trend';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// GET /api/wishlist
app.get('/', async (c) => {
  const userId = c.get('userId');
  const [wl, alerts, hist] = await Promise.all([
    c.env.DB.prepare(`
      SELECT w.id, w.set_num, w.target_price, w.notes, w.added_at, w.alerted_at,
        s.name, s.theme, s.year, s.image_url, s.current_value, s.forecast_2y,
        s.retail_price, s.retired, s.retirement_risk_score, s.ebay_value,
        s.ebay_new_value, s.ebay_used_value, s.ebay_new_qty, s.ebay_used_qty,
        s.ebay_new_cached_at, s.ebay_used_cached_at, s.ebay_cached_at,
        s.used_value, s.bl_new_value, s.bl_new_qty,
        s.bl_used_qty, s.bl_cached_at, s.be_cached_at,
        s.valuation_method, s.valuation_expires_at, s.cached_at,
        s.lego_availability, s.lego_retiring_soon
      FROM user_wishlist w
      JOIN lego_sets s ON s.set_num = w.set_num
      WHERE w.user_id = ?
      ORDER BY w.added_at DESC
    `).bind(userId).all(),
    c.env.DB.prepare(`
      SELECT id, user_id, set_num, set_name, target_price, current_value,
             triggered_at, read_at, alert_type
      FROM wishlist_alerts
      WHERE user_id = ? AND read_at IS NULL
      ORDER BY triggered_at DESC
    `).bind(userId).all(),
    c.env.DB.prepare(`
      SELECT set_num, snapshot_date, current_value
      FROM set_value_history
      WHERE set_num IN (SELECT set_num FROM user_wishlist WHERE user_id = ?)
        AND snapshot_date >= DATE('now', '-30 days')
      ORDER BY set_num, snapshot_date ASC
    `).bind(userId).all<{ set_num: string; snapshot_date: string; current_value: number }>(),
  ]);

  // Per-set 30-day slope (USD/week) so the client can show "buy window" hints
  // on wishlist targets. Requires >= 7 snapshots to avoid noise.
  const trendWeekly: Record<string, number> = {};
  const grouped: Record<string, Array<{ x: number; y: number }>> = {};
  for (const r of hist.results || []) {
    if (!Number.isFinite(r.current_value) || r.current_value <= 0) continue;
    (grouped[r.set_num] ||= []).push({ x: new Date(r.snapshot_date).getTime() / 86400000, y: r.current_value });
  }
  for (const [setNum, pts] of Object.entries(grouped)) {
    if (pts.length < 7) continue;
    const slope = weeklySlopeUSD(pts);
    if (slope != null) trendWeekly[setNum] = Math.round(slope * 100) / 100;
  }

  return c.json({
    wishlist: (wl.results || []).map(r => enrichSetRecord({
      ...r,
      retired: !!(r as Record<string, unknown>).retired,
      trend_weekly: trendWeekly[(r as Record<string, unknown>).set_num as string] ?? null,
    } as Record<string, unknown>)),
    unread_alerts: alerts.results,
  });
});

// POST /api/wishlist
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ set_num?: string; target_price?: number; notes?: string }>();
  const { set_num, target_price } = body;
  // Cap free text (same 500-char bound as collection notes).
  const notes = body.notes != null ? String(body.notes).slice(0, 500) : body.notes;
  if (!set_num) return c.json({ error: 'set_num required' }, 400);

  if (target_price !== undefined && target_price !== null && (typeof target_price !== 'number' || target_price < 0)) {
    return c.json({ error: 'Target price must be a number >= 0' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT 1 FROM lego_sets WHERE set_num=?').bind(set_num).first();
  if (!existing) return c.json({ error: 'Set not found in catalog' }, 404);

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
  return new Response(null, { status: 204 });
});

// DELETE /api/wishlist/by-set/:setNum — remove a set from the wishlist by its
// set number. The catalog coming-soon cards only know the set_num (not the
// numeric wishlist row id the /:id route expects), so they use this.
app.delete('/by-set/:setNum', async (c) => {
  const userId = c.get('userId');
  const setNum = c.req.param('setNum');
  if (!setNum) return c.json({ error: 'set_num required' }, 400);
  await c.env.DB.prepare('DELETE FROM user_wishlist WHERE set_num=? AND user_id=?').bind(setNum, userId).run();
  return new Response(null, { status: 204 });
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
