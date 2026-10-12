import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import type { Env, Variables } from '../types';
import { edgeCached } from '../lib/edge-cache';
import { normalizePromo } from '../lib/promotions';

// Promotions calendar (mounted at /api/promotions).
//
// GET    /api/promotions             public: offers on now and coming up
// GET    /api/promotions/admin       admin: everything recent, hidden included
// POST   /api/promotions/admin       admin: add an offer by hand
// PATCH  /api/promotions/admin/:id   admin: fix or hide an offer (an edited
//                                    offer is no longer refreshed from LEGO.com)
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const COLUMNS = `p.id, p.kind, p.title, p.details, p.starts_on, p.ends_on, p.min_spend, p.gift_set_num, p.url,
  p.source, p.hidden, p.last_seen_at, s.name AS gift_name, s.image_url AS gift_image`;

app.get('/', (c) => edgeCached(c, 900, async () => {
  // An offer without an end date counts as current while LEGO.com still shows
  // it (seen in the last 10 days) or while an admin keeps it.
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNS}
       FROM promotions p LEFT JOIN lego_sets s ON s.set_num = p.gift_set_num
      WHERE p.hidden = 0
        AND (p.ends_on >= DATE('now')
             OR (p.ends_on IS NULL AND (p.source = 'admin' OR p.last_seen_at >= datetime('now', '-10 days'))))
      ORDER BY COALESCE(p.starts_on, '0000') ASC, COALESCE(p.ends_on, '9999') ASC, p.id ASC
      LIMIT 100`,
  ).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }));
  const today = new Date().toISOString().slice(0, 10);
  const rows = (results || []).map(({ hidden: _h, last_seen_at: _l, ...r }) => r);
  return c.json({
    now: rows.filter((r) => !r.starts_on || String(r.starts_on) <= today),
    upcoming: rows.filter((r) => r.starts_on && String(r.starts_on) > today),
  });
}));

app.use('/admin', requireAdmin);
app.use('/admin/*', requireAdmin);

app.get('/admin', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${COLUMNS} FROM promotions p LEFT JOIN lego_sets s ON s.set_num = p.gift_set_num
      WHERE COALESCE(p.ends_on, DATE(p.last_seen_at)) >= DATE('now', '-60 days')
      ORDER BY p.hidden ASC, COALESCE(p.starts_on, '0000') DESC, p.id DESC LIMIT 200`,
  ).all();
  return c.json({ promotions: results || [] });
});

app.post('/admin', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const p = normalizePromo(body);
  if (!p) return c.json({ error: 'A title is required' }, 400);
  const row = await c.env.DB.prepare(
    `INSERT INTO promotions (dedupe_key, kind, title, details, starts_on, ends_on, min_spend, gift_set_num, url, source, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', datetime('now')) RETURNING id`,
  ).bind(`admin|${crypto.randomUUID()}`, p.kind, p.title, p.details, p.starts_on, p.ends_on, p.min_spend, p.gift_set_num, p.url)
    .first<{ id: number }>();
  return c.json({ ok: true, id: row?.id ?? null });
});

app.patch('/admin/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (Object.keys(body).length === 1 && 'hidden' in body) {
    const res = await c.env.DB.prepare(`UPDATE promotions SET hidden = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(body.hidden ? 1 : 0, id).run();
    return res.meta.changes ? c.json({ ok: true }) : c.json({ error: 'Not found' }, 404);
  }
  const current = await c.env.DB.prepare('SELECT * FROM promotions WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!current) return c.json({ error: 'Not found' }, 404);
  const p = normalizePromo({ ...current, ...body });
  if (!p) return c.json({ error: 'A title is required' }, 400);
  await c.env.DB.prepare(
    `UPDATE promotions SET kind = ?, title = ?, details = ?, starts_on = ?, ends_on = ?, min_spend = ?, gift_set_num = ?,
       url = ?, hidden = ?, source = 'admin', updated_at = datetime('now') WHERE id = ?`,
  ).bind(p.kind, p.title, p.details, p.starts_on, p.ends_on, p.min_spend, p.gift_set_num, p.url,
    'hidden' in body ? (body.hidden ? 1 : 0) : Number(current.hidden) || 0, id).run();
  return c.json({ ok: true });
});

export { app as promotionsRoute };
