import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { SALES_CTE } from '../lib/realized-sales';
import { edgeCached } from '../lib/edge-cache';

// Sales & taxes (mounted at /api/sales).
//
// GET    /api/sales?year=YYYY   the year's realized sales: summary for everyone,
//                               the per-sale report (for a tax return or an
//                               accountant) for Pro
// DELETE /api/sales/:id         drop a mistaken ledger entry
// GET    /api/sales/value-check public: how close our displayed value was to
//                               the prices collectors actually sold for
//
// Holding period: a sale more than 365 days after purchase is long-term, as in
// most capital-gains regimes; without a purchase date the term is unknown. We
// report numbers, not tax advice — the screen says so.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const LONG_TERM_DAYS = 365;
const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface SaleRow {
  id: number;
  set_num: string;
  name: string | null;
  quantity: number;
  condition: string | null;
  purchased_at: string | null;
  sold_at: string;
  cost_basis: number | null;
  sold_price: number;
  sold_fees: number | null;
  origin: string;
}

/** Pure: per-sale gain/term plus the year's totals. */
export function summarizeSales(rows: SaleRow[]) {
  const sum = { sales: 0, units: 0, proceeds: 0, fees: 0, cost: 0, gain: 0, short_term_gain: 0, long_term_gain: 0, unknown_term_gain: 0, missing_cost: 0 };
  const out = rows.map((r) => {
    const fees = Number(r.sold_fees) || 0;
    const net = Number(r.sold_price) - fees;
    const cost = r.cost_basis == null ? null : Number(r.cost_basis);
    const gain = cost == null ? null : round2(net - cost);
    const held = r.purchased_at ? Math.floor((Date.parse(r.sold_at) - Date.parse(r.purchased_at)) / DAY_MS) : null;
    const term = held == null || !Number.isFinite(held) ? null : held > LONG_TERM_DAYS ? 'long' : 'short';
    sum.sales += 1;
    sum.units += Number(r.quantity) || 1;
    sum.proceeds += Number(r.sold_price);
    sum.fees += fees;
    if (cost == null || gain == null) sum.missing_cost += 1;
    else {
      sum.cost += cost;
      sum.gain += gain;
      if (term === 'long') sum.long_term_gain += gain;
      else if (term === 'short') sum.short_term_gain += gain;
      else sum.unknown_term_gain += gain;
    }
    return { ...r, net_proceeds: round2(net), gain, held_days: held != null && Number.isFinite(held) ? held : null, term };
  });
  for (const k of ['proceeds', 'fees', 'cost', 'gain', 'short_term_gain', 'long_term_gain', 'unknown_term_gain'] as const) sum[k] = round2(sum[k]);
  return { rows: out, summary: sum };
}

/** Pure: accuracy of value_at_sale against the per-unit price actually paid. */
export function valueCheck(pairs: { value: number; price: number }[], minSales = 20) {
  // A sale far off our value is usually a bundle, a damaged box or a typo, not
  // a valuation miss; drop pairs outside 0.25x–4x so one outlier can't swing it.
  const errs = pairs
    .filter((p) => p.value > 0 && p.price > 0 && p.price / p.value >= 0.25 && p.price / p.value <= 4)
    .map((p) => (p.value - p.price) / p.price);
  const n = errs.length;
  if (n < minSales) return { ready: false, sales: n, min_sales: minSales };
  const abs = errs.map(Math.abs).sort((a, b) => a - b);
  const signed = [...errs].sort((a, b) => a - b);
  const median = (xs: number[]) => (xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
  const pct = (x: number) => Math.round(x * 1000) / 10;
  return {
    ready: true,
    sales: n,
    min_sales: minSales,
    median_abs_error_pct: pct(median(abs)),
    median_bias_pct: pct(median(signed)),
    within_10_pct: pct(abs.filter((e) => e <= 0.1).length / n),
    within_20_pct: pct(abs.filter((e) => e <= 0.2).length / n),
  };
}

// Public and identical for every caller, so it is safe to edge-cache.
app.get('/value-check', (c) => edgeCached(c, 3600, async () => {
  const { results } = await c.env.DB.prepare(
    `SELECT value_at_sale AS value, sold_price * 1.0 / MAX(1, quantity) AS price
       FROM realized_sales
      WHERE deleted_at IS NULL AND value_at_sale > 0 AND sold_price > 0
        AND COALESCE(condition, 'sealed') IN ('sealed', 'new')
        AND sold_at >= DATE('now', '-365 days')
      LIMIT 20000`,
  ).all<{ value: number; price: number }>();
  return c.json(valueCheck(results || []));
}));

app.use('/', requireMember);
app.use('/:id', requireMember);

async function isSupporter(db: D1Database, userId: string): Promise<boolean> {
  const pref = await db.prepare('SELECT is_supporter FROM user_prefs WHERE user_id = ?')
    .bind(userId).first<{ is_supporter: number }>().catch(() => null);
  return !!pref?.is_supporter;
}

app.get('/', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const userId = c.get('userId');
  const yearsRes = await c.env.DB.prepare(
    `WITH ${SALES_CTE} SELECT DISTINCT substr(sold_at, 1, 4) AS y FROM sales ORDER BY y DESC`,
  ).bind(userId, userId).all<{ y: string }>();
  const years = (yearsRes.results || []).map((r) => Number(r.y)).filter((y) => Number.isInteger(y));
  const thisYear = new Date().getUTCFullYear();
  const asked = Number(c.req.query('year'));
  const year = Number.isInteger(asked) && asked > 1990 && asked < 3000 ? asked : (years[0] ?? thisYear);

  const { results } = await c.env.DB.prepare(
    `WITH ${SALES_CTE}
     SELECT x.id, x.set_num, s.name, x.quantity, x.condition, x.purchased_at, x.sold_at,
            x.cost_basis, x.sold_price, x.sold_fees, x.origin
       FROM sales x
       LEFT JOIN lego_sets s ON s.set_num = x.set_num
      WHERE x.sold_at >= ? AND x.sold_at < ?
      ORDER BY x.sold_at ASC, x.id ASC`,
  ).bind(userId, userId, `${year}-01-01`, `${year + 1}-01-01`).all<SaleRow>();
  const { rows, summary } = summarizeSales(results || []);
  const pro = await isSupporter(c.env.DB, userId);
  return c.json({ year, years: years.length ? years : [thisYear], pro, summary, rows: pro ? rows : null });
});

app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id === 0) return c.json({ error: 'Invalid id' }, 400);
  if (id < 0) {
    // A legacy sale lives on its sold holding: clear the sale, keep the row deleted.
    const res = await c.env.DB.prepare(
      `UPDATE user_collection SET sold_price = NULL, sold_at = NULL, sold_fees = NULL, last_modified = datetime('now')
        WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL AND sold_at IS NOT NULL`,
    ).bind(-id, userId).run();
    if (!res.meta.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  }
  const res = await c.env.DB.prepare(
    `UPDATE realized_sales SET deleted_at = datetime('now') WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
  ).bind(id, userId).run();
  if (!res.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});

export { app as salesRoute };
