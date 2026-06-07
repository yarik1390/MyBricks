import { Hono } from 'hono';
import { optionalMember, requireMember } from '../auth';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', optionalMember);

// GET /api/minifigs
app.get('/', async (c) => {
  const userId = c.get('userId') || '';
  const series = c.req.query('series') || '';
  const q      = c.req.query('q')      || '';
  const rarity = c.req.query('rarity') || '';
  const owned  = c.req.query('owned')  || ''; // 'yes' | 'no'
  const sort   = c.req.query('sort')   || 'rarity_desc';
  const lim    = Math.min(parseInt(c.req.query('limit')  || '30', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0',  10), 0);

  const buildWhere = (extraParams: unknown[]) => {
    const where: string[] = [];
    if (series) { where.push(`m.series = ?`);               extraParams.push(series); }
    if (q)      { where.push(`LOWER(m.name) LIKE LOWER(?)`); extraParams.push(`%${q}%`); }
    if (rarity) { where.push(`m.rarity = ?`);               extraParams.push(rarity); }
    if (owned === 'yes') where.push(`COALESCE(um.quantity, 0) > 0`);
    if (owned === 'no')  where.push(`COALESCE(um.quantity, 0) = 0`);
    return where.length ? `WHERE ${where.join(' AND ')}` : '';
  };

  const pageParams: unknown[] = [userId];
  const pageWhereSQL = buildWhere(pageParams);
  pageParams.push(lim, offset);

  const countParams: unknown[] = [userId];
  const countWhereSQL = buildWhere(countParams);

  const valExpr = `COALESCE(m.current_value, CASE m.rarity
    WHEN 'common' THEN 3.50
    WHEN 'uncommon' THEN 7.50
    WHEN 'rare' THEN 18.00
    WHEN 'legendary' THEN 50.00
    ELSE 3.50
  END)`;

  let orderBy = `ORDER BY CASE m.rarity WHEN 'legendary' THEN 4 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 2 ELSE 1 END DESC, m.name ASC`;
  if (sort === 'value_desc') {
    orderBy = `ORDER BY ${valExpr} DESC, m.name ASC`;
  } else if (sort === 'value_asc') {
    orderBy = `ORDER BY ${valExpr} ASC, m.name ASC`;
  } else if (sort === 'name_asc') {
    orderBy = `ORDER BY m.name ASC`;
  }

  const [pageRes, countRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT m.fig_num, m.name, m.series, m.rarity, m.image_url, m.added_at, m.source,
              ${valExpr} as current_value,
              COALESCE(um.quantity, 0) as owned_qty
       FROM minifigs m
       LEFT JOIN user_minifigs um ON um.fig_num = m.fig_num AND um.user_id = ?
       ${pageWhereSQL}
       ${orderBy}
       LIMIT ? OFFSET ?`
    ).bind(...pageParams).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT CAST(COUNT(*) AS INTEGER) AS total
       FROM minifigs m
       LEFT JOIN user_minifigs um ON um.fig_num = m.fig_num AND um.user_id = ?
       ${countWhereSQL}`
    ).bind(...countParams).first<{ total: number }>(),
  ]);

  const total = countRes?.total ?? 0;
  return c.json({
    minifigs: pageRes.results,
    total,
    hasMore: offset + pageRes.results.length < total,
  });
});

// PUT /api/minifigs/:fignum — mark owned
app.put('/:fignum', requireMember, async (c) => {
  const userId = c.get('userId');
  const figNum = c.req.param('fignum');
  const exists = await c.env.DB.prepare('SELECT 1 FROM minifigs WHERE fig_num=?').bind(figNum).first();
  if (!exists) return c.json({ error: 'Minifig not found' }, 404);

  const body = await c.req.json<{ quantity?: number }>().catch(() => ({ quantity: undefined }));
  const qty = Math.max(1, parseInt(String(body.quantity ?? 1), 10) || 1);
  await c.env.DB.prepare(`
    INSERT INTO user_minifigs (user_id, fig_num, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT (user_id, fig_num) DO UPDATE SET quantity = EXCLUDED.quantity
  `).bind(userId, figNum, qty).run();
  return c.json({ ok: true, fig_num: figNum, quantity: qty });
});

// DELETE /api/minifigs/:fignum
app.delete('/:fignum', requireMember, async (c) => {
  const userId = c.get('userId');
  const figNum = c.req.param('fignum');
  const exists = await c.env.DB.prepare('SELECT 1 FROM minifigs WHERE fig_num=?').bind(figNum).first();
  if (!exists) return c.json({ error: 'Minifig not found' }, 404);
  await c.env.DB.prepare('DELETE FROM user_minifigs WHERE user_id=? AND fig_num=?').bind(userId, figNum).run();
  return new Response(null, { status: 204 });
});

export { app as minifigsRoute };
