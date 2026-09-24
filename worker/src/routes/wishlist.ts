import { Hono } from 'hono';
import { requireMember } from '../auth';
import { enrichSetRecord } from '../lib/market-sources';
import { weeklySlopeUSD } from '../lib/price-trend';
import type { Env, Variables } from '../types';
import { attachCatalogValuationState, MARKET_EXT_JOIN, WISHLIST_COLS } from './sets-sql';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

// GET /api/wishlist
app.get('/', async (c) => {
  const userId = c.get('userId');
  const [wl, alerts, hist, upcoming, switches] = await Promise.all([
    c.env.DB.prepare(`
      SELECT ${WISHLIST_COLS}
      FROM user_wishlist w
      JOIN lego_sets s ON s.set_num = w.set_num
      ${MARKET_EXT_JOIN}
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
    c.env.DB.prepare(`
      SELECT set_num, price_usd, availability
      FROM upcoming_sets
      WHERE set_num IN (SELECT set_num FROM user_wishlist WHERE user_id = ?)
    `).bind(userId).all<{ set_num: string; price_usd: number | null; availability: string | null }>(),
    // Per-set alert switches ride in a separate read: the catalog projection
    // above already sits at D1's result-column limit.
    c.env.DB.prepare(
      'SELECT id, notify_target, notify_retiring, notify_stock FROM user_wishlist WHERE user_id = ?',
    ).bind(userId).all<{ id: number; notify_target: number; notify_retiring: number; notify_stock: number }>(),
  ]);
  const switchesById = new Map((switches.results || []).map(row => [row.id, row]));

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
  const upcomingBySet = new Map((upcoming.results || []).map(row => [row.set_num, row]));

  return c.json({
    wishlist: (wl.results || []).map(r => {
      const row = r as Record<string, unknown>;
      const upcomingSet = upcomingBySet.get(String(row.set_num));
      const comingSoon = upcomingSet?.availability != null;
      const announcedPrice = [upcomingSet?.price_usd, row.retail_price, row.be_retail]
        .map(Number)
        .find(value => Number.isFinite(value) && value > 0) ?? null;
      const sw = switchesById.get(Number(row.id));
      const enriched: Record<string, unknown> = enrichSetRecord(attachCatalogValuationState({
        ...row,
        retired: !!row.retired,
        trend_weekly: trendWeekly[row.set_num as string] ?? null,
        notify_target: sw ? Number(sw.notify_target) : 1,
        notify_retiring: sw ? Number(sw.notify_retiring) : 1,
        notify_stock: sw ? Number(sw.notify_stock) : 1,
      }));
      if (!comingSoon) return enriched;
      const availability = /pre/i.test(String(upcomingSet?.availability)) ? 'pre_order' : 'coming_soon';
      return {
        ...enriched,
        coming_soon: true,
        upcoming_price: announcedPrice,
        current_value: announcedPrice ?? enriched.current_value,
        lego_availability: availability,
      };
    }),
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

// PATCH /api/wishlist/:id — the price alert sheet: target price (null clears
// it) and the per-set switches. Changing the target re-arms the alert so a
// set already under the NEW target can fire on the next run.
app.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<{
    target_price?: number | null; notify_target?: boolean; notify_retiring?: boolean; notify_stock?: boolean; notes?: string | null;
  }>().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'JSON body required' }, 400);
  const sets: string[] = [];
  const binds: (number | string | null)[] = [];
  if (body.target_price !== undefined) {
    const tp = body.target_price;
    if (tp !== null && (typeof tp !== 'number' || !Number.isFinite(tp) || tp <= 0 || tp > 1e7)) {
      return c.json({ error: 'Target price must be a positive number or null' }, 400);
    }
    sets.push('target_price = ?', 'alerted_at = NULL', 'acknowledged_at = NULL');
    binds.push(tp);
  }
  for (const col of ['notify_target', 'notify_retiring', 'notify_stock'] as const) {
    const v = body[col];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') return c.json({ error: `${col} must be a boolean` }, 400);
    sets.push(`${col} = ?`);
    binds.push(v ? 1 : 0);
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?');
    binds.push(body.notes == null ? null : String(body.notes).slice(0, 500));
  }
  if (!sets.length) return c.json({ error: 'Nothing to update' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE user_wishlist SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
  ).bind(...binds, id, userId).run();
  if (res.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  const item = await c.env.DB.prepare('SELECT * FROM user_wishlist WHERE id = ? AND user_id = ?').bind(id, userId).first();
  return c.json({ item });
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

app.post('/:id/acknowledge-alert', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);
  const res = await c.env.DB.prepare(
    'UPDATE user_wishlist SET acknowledged_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
  ).bind(id, userId).run();
  if (res.meta.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true, id });
});

export { app as wishlistRoute };
