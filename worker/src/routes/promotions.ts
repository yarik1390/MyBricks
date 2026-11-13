import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import type { Env, Variables } from '../types';
import { edgeCached } from '../lib/edge-cache';
import { normalizePromo, promoLooksForeign, promoMarket, stripMarkdown } from '../lib/promotions';

// Promotions calendar (mounted at /api/promotions).
//
// GET    /api/promotions?market=FR   public: offers on now and coming up at that
//                                    country's LEGO.com store (US when none
//                                    given); a store with no offers on file
//                                    falls back to the US list, flagged
// GET    /api/promotions/admin?market=FR  admin: everything recent for that
//                                    store, hidden included (same fallback)
// POST   /api/promotions/admin       admin: add an offer by hand
// PATCH  /api/promotions/admin/:id   admin: fix or hide an offer (an edited
//                                    offer is no longer refreshed from LEGO.com)
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const COLUMNS = `p.id, p.kind, p.title, p.details, p.starts_on, p.ends_on, p.min_spend, p.gift_set_num, p.url,
  p.source, p.hidden, p.last_seen_at, COALESCE(p.market, 'US') AS market, COALESCE(p.currency, 'USD') AS currency,
  s.name AS gift_name, s.image_url AS gift_image`;

const LIVE = `p.hidden = 0
        AND (p.ends_on >= DATE('now')
             OR (p.ends_on IS NULL AND (p.source = 'admin' OR p.last_seen_at >= datetime('now', '-10 days'))))`;
const RECENT = `COALESCE(p.ends_on, DATE(p.last_seen_at)) >= DATE('now', '-60 days')`;

/** Older rows (before plain-text extraction) can carry _Star Wars_ style Markdown. */
const tidy = (r: Record<string, unknown>): Record<string, unknown> => ({
  ...r,
  title: typeof r.title === 'string' ? stripMarkdown(r.title) : r.title,
  details: typeof r.details === 'string' ? stripMarkdown(r.details) : r.details,
});

/**
 * Rows for the asked store; when that store has none on file (not read yet,
 * or LEGO.com runs no offers there) the US list, with `fallback` set so the
 * app says so instead of passing dollar offers off as local ones.
 */
async function forMarket(env: Env, asked: string, where: string, order: string, limit: number) {
  const read = (m: string) => env.DB.prepare(
    `SELECT ${COLUMNS} FROM promotions p LEFT JOIN lego_sets s ON s.set_num = p.gift_set_num
      WHERE COALESCE(p.market, 'US') = ? AND ${where} ORDER BY ${order} LIMIT ${limit}`,
  ).bind(m).all<Record<string, unknown>>().then((r) => r.results || []).catch(() => [] as Record<string, unknown>[])
    // Rows filed under this store that are really the US copy (scraped before
    // the job learned to skip them) must not pass as local offers.
    .then((rows) => rows.filter((r) => r.source === 'admin' || !promoLooksForeign(r as { market?: string; currency?: string; url?: string; details?: string; title?: string })));
  let rows = await read(asked);
  let market = asked;
  if (!rows.length && asked !== 'US') {
    rows = await read('US');
    market = 'US';
  }
  return { asked, market, fallback: market !== asked, rows: rows.map(tidy) };
}

app.get('/', (c) => edgeCached(c, 900, async () => {
  // An offer without an end date counts as current while LEGO.com still shows
  // it (seen in the last 10 days) or while an admin keeps it.
  const asked = promoMarket(c.req.query('market')) || 'US';
  const got = await forMarket(c.env, asked, LIVE,
    `COALESCE(p.starts_on, '0000') ASC, COALESCE(p.ends_on, '9999') ASC, p.id ASC`, 100);
  const today = new Date().toISOString().slice(0, 10);
  const rows = got.rows.map(({ hidden: _h, last_seen_at: _l, ...r }) => r);
  return c.json({
    market: got.market,
    asked_market: got.asked,
    fallback: got.fallback,
    now: rows.filter((r) => !r.starts_on || String(r.starts_on) <= today),
    upcoming: rows.filter((r) => r.starts_on && String(r.starts_on) > today),
  });
}));

app.use('/admin', requireAdmin);
app.use('/admin/*', requireAdmin);

app.get('/admin', async (c) => {
  const asked = promoMarket(c.req.query('market')) || 'US';
  const got = await forMarket(c.env, asked, RECENT, `p.hidden ASC, COALESCE(p.starts_on, '0000') DESC, p.id DESC`, 200);
  return c.json({ market: got.market, asked_market: got.asked, fallback: got.fallback, promotions: got.rows });
});

app.post('/admin', async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const p = normalizePromo(body);
  if (!p) return c.json({ error: 'A title is required' }, 400);
  const row = await c.env.DB.prepare(
    `INSERT INTO promotions (dedupe_key, kind, title, details, starts_on, ends_on, min_spend, gift_set_num, url, market, currency, source, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', datetime('now')) RETURNING id`,
  ).bind(`admin|${crypto.randomUUID()}`, p.kind, p.title, p.details, p.starts_on, p.ends_on, p.min_spend, p.gift_set_num, p.url, p.market, p.currency)
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
       url = ?, market = ?, currency = ?, hidden = ?, source = 'admin', updated_at = datetime('now') WHERE id = ?`,
  ).bind(p.kind, p.title, p.details, p.starts_on, p.ends_on, p.min_spend, p.gift_set_num, p.url, p.market, p.currency,
    'hidden' in body ? (body.hidden ? 1 : 0) : Number(current.hidden) || 0, id).run();
  return c.json({ ok: true });
});

export { app as promotionsRoute };
