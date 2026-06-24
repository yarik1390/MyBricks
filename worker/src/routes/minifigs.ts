import { Hono } from 'hono';
import { optionalMember, requireMember } from '../auth';
import { fetchMinifigDetail } from '../lib/rebrickable';
import { logEvent } from '../lib/analytics';
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

  const rarityFallbackExpr = `CASE m.rarity
    WHEN 'common' THEN 3.50
    WHEN 'uncommon' THEN 7.50
    WHEN 'rare' THEN 18.00
    WHEN 'legendary' THEN 50.00
    ELSE 3.50
  END`;
  const valExpr = `COALESCE(m.current_value, ${rarityFallbackExpr})`;

  let orderBy = `ORDER BY CASE m.rarity WHEN 'legendary' THEN 4 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 2 ELSE 1 END DESC, m.name ASC`;
  if (sort === 'value_desc') {
    orderBy = `ORDER BY ${valExpr} DESC, m.name ASC`;
  } else if (sort === 'value_asc') {
    orderBy = `ORDER BY ${valExpr} ASC, m.name ASC`;
  } else if (sort === 'name_asc') {
    orderBy = `ORDER BY m.name ASC`;
  } else if (sort === 'scarcity') {
    // Rarest first = fewest set appearances; unknown (NULL/0) sorts to the end.
    orderBy = `ORDER BY (m.appears_in_sets IS NULL OR m.appears_in_sets = 0) ASC, m.appears_in_sets ASC, m.name ASC`;
  } else if (sort === 'year_desc') {
    orderBy = `ORDER BY (m.year IS NULL) ASC, m.year DESC, m.name ASC`;
  } else if (sort === 'year_asc') {
    orderBy = `ORDER BY (m.year IS NULL) ASC, m.year ASC, m.name ASC`;
  } else if (sort === 'rarity_asc') {
    // Common first (inverse of the default legendary-first rarity tier sort).
    orderBy = `ORDER BY CASE m.rarity WHEN 'legendary' THEN 4 WHEN 'rare' THEN 3 WHEN 'uncommon' THEN 2 ELSE 1 END ASC, m.name ASC`;
  } else if (sort === 'name_desc') {
    orderBy = `ORDER BY m.name DESC`;
  } else if (sort === 'scarcity_asc') {
    // Inverse of "rarest": most-common first (most set appearances); unknown last.
    orderBy = `ORDER BY (m.appears_in_sets IS NULL OR m.appears_in_sets = 0) ASC, m.appears_in_sets DESC, m.name ASC`;
  }

  const [pageRes, countRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT m.fig_num, m.name, m.series, m.rarity, m.image_url, m.added_at, m.source,
              m.current_value, m.year, m.num_parts, m.appears_in_sets,
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
  const results = pageRes.results;

  // Background: enrich up to 5 minifigs missing metadata (year, num_parts, appears_in_sets)
  if (c.env.REBRICKABLE_API_KEY) {
    const stale = results
      .filter(r => r.year == null)
      .slice(0, 5)
      .map(r => r.fig_num as string);
    if (stale.length > 0) {
      c.executionCtx.waitUntil((async () => {
        for (const figNum of stale) {
          try {
            const detail = await fetchMinifigDetail(figNum, c.env);
            if (!detail) continue;
            await c.env.DB.prepare(
              `UPDATE minifigs SET year=?, num_parts=?, appears_in_sets=? WHERE fig_num=? AND year IS NULL`
            ).bind(detail.year, detail.num_parts, detail.set_count, figNum).run();
          } catch { /* non-fatal */ }
        }
      })());
    }
  }

  return c.json({
    minifigs: results,
    total,
    hasMore: offset + results.length < total,
  });
});

// GET /api/minifigs/series — distinct series with counts, for the filter UI.
// Most-populated first; only real (non-empty) series. Cheap, cacheable.
app.get('/series', async (c) => {
  const res = await c.env.DB.prepare(
    `SELECT series, CAST(COUNT(*) AS INTEGER) AS n
     FROM minifigs
     WHERE series IS NOT NULL AND series <> ''
     GROUP BY series
     ORDER BY n DESC, series ASC
     LIMIT 40`
  ).all<{ series: string; n: number }>();
  return c.json({ series: res.results });
});

// GET /api/minifigs/blindbox?code=<upc-or-setnum> — identify a Collectible
// Minifigures SERIES from a sealed bag/box barcode and list its candidate figs.
// A blind bag's barcode identifies the series, not the specific sealed fig
// (that needs the printed bump code), so we return the whole series roster for
// the user to pick from.
app.get('/blindbox', async (c) => {
  const code = (c.req.query('code') || '').trim().replace(/\s+/g, '');
  if (!code) return c.json({ error: 'Scan or enter a barcode.' }, 400);

  // Resolve the scanned code to a catalog set: by UPC, the set number, or the
  // first individual-fig set number (some bags carry a fig-level barcode).
  const set = await c.env.DB.prepare(
    `SELECT set_num, name, theme FROM lego_sets WHERE upc = ? OR set_num = ? OR set_num = ? LIMIT 1`
  ).bind(code, code, code + '-1').first<{ set_num: string; name: string; theme: string }>();
  if (!set) return c.json({ error: "That barcode isn't in the catalog. Try the series number (e.g. 71045)." }, 404);
  if (String(set.theme) !== 'Collectible Minifigures') {
    return c.json({ error: `That's "${set.name}" — not a Collectible Minifigures series.` }, 404);
  }

  const prefix = String(set.set_num).split('-')[0];
  const figsRes = await c.env.DB.prepare(
    `SELECT DISTINCT m.fig_num, m.name, m.series, m.rarity, m.image_url, m.current_value, m.year, m.appears_in_sets
     FROM lego_sets ls
     JOIN set_minifigs sm ON sm.set_num = ls.set_num
     JOIN minifigs m ON m.fig_num = sm.fig_num
     WHERE ls.set_num LIKE ? AND ls.theme = 'Collectible Minifigures'
       AND ls.name NOT LIKE '%Complete%' AND ls.name NOT LIKE '%Random%'
       AND ls.name NOT LIKE '%Sealed Box%' AND ls.name NOT LIKE '% Pack%'
     ORDER BY m.name`
  ).bind(prefix + '-%').all<Record<string, unknown>>();

  // Clean series label from the box/random entry (which carries "Series N").
  const seriesRow = await c.env.DB.prepare(
    `SELECT name FROM lego_sets WHERE set_num LIKE ? AND (name LIKE '%Random%' OR name LIKE '%Complete%' OR name LIKE '%Sealed Box%') ORDER BY set_num LIMIT 1`
  ).bind(prefix + '-%').first<{ name: string }>();
  const series = String(seriesRow?.name || set.name)
    .replace(/\s*-\s*(Random Box|Random Bag|Complete.*|Sealed Box).*$/i, '')
    .trim();

  return c.json({ series, set_num: set.set_num, figs: figsRes.results });
});

// GET /api/minifigs/rare-finds — the signed-in user's OWNED rare/legendary figs
// (value desc) for the collection highlight. Empty for guests (owned figs are
// local-only without an account).
app.get('/rare-finds', async (c) => {
  const userId = c.get('userId') || '';
  if (!userId) return c.json({ figs: [] });
  const { results } = await c.env.DB.prepare(`
    SELECT m.fig_num, m.name, m.series, m.rarity, m.image_url, m.current_value,
           m.year, m.num_parts, m.appears_in_sets, um.quantity
    FROM user_minifigs um
    JOIN minifigs m ON m.fig_num = um.fig_num
    WHERE um.user_id = ? AND um.quantity > 0 AND m.rarity IN ('rare', 'legendary')
    ORDER BY CASE m.rarity WHEN 'legendary' THEN 2 ELSE 1 END DESC, COALESCE(m.current_value, 0) DESC
    LIMIT 24
  `).bind(userId).all<Record<string, unknown>>();
  return c.json({ figs: results || [] });
});

// GET /api/minifigs/:fignum/sets — the sets a minifig appears in (turns the
// fig detail into a navigable hub). Public. image_url is proxied by the global
// image-rewrite middleware. Newest first.
app.get('/:fignum/sets', async (c) => {
  const figNum = c.req.param('fignum');
  const { results } = await c.env.DB.prepare(`
    SELECT ls.set_num, ls.name, ls.year, ls.image_url,
           COALESCE(NULLIF(ls.blended_value, 0), ls.current_value) AS value,
           sm.quantity
    FROM set_minifigs sm
    JOIN lego_sets ls ON ls.set_num = sm.set_num
    WHERE sm.fig_num = ?
    ORDER BY COALESCE(ls.year, 0) DESC, ls.set_num ASC
    LIMIT 50
  `).bind(figNum).all<Record<string, unknown>>();
  return c.json({ sets: results || [] });
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
  logEvent(c.env, 'minifig_owned', userId, { figNum });
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
