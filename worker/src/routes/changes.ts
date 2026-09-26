import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { holdingValueForRollout } from '../lib/market-sources';

// GET /api/changes?days=N — the Vault's "What changed" digest.
//
// Market movement is measured per set from set_value_history, which snapshots
// the displayed value (blended market value, else the formula value) once a
// day. Comparing that series today with its snapshot on or before the `since`
// date gives the move the market made; it is applied to each holding's own
// value — condition-aware and on the pricing rollout, exactly as /api/collection
// values it — so a used copy moves from its used price, not the sealed one.
// Adding or removing sets is not "a change in value", so holdings added after
// `since` are left out of the headline delta instead of inflating it.
//
// Response:
//   since        YYYY-MM-DD the comparison starts from
//   days         window length actually used (1–90)
//   value_now    Σ today's value × quantity over the comparable holdings
//   value_then   Σ value at `since` × quantity over the same holdings (null when
//                no history exists yet)
//   delta / pct  value_now − value_then, and that as a percentage of value_then
//   total_now    Σ today's value × quantity over every current holding
//   compared     number of holdings with a value on both ends
//   movers       biggest movers over `mover_days` (7), by absolute holding delta
//   realized     { gain, sales, priced_sales, proceeds, items[] } from sold rows;
//                gain is net of sale fees and of every copy's cost (sold_price
//                is what the whole holding fetched)
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
app.use('*', requireMember);

const MOVER_DAYS = 7;
const MOVER_LIMIT = 5;
// Look back at most this far before `since` for a set's last snapshot. It keeps
// the history scan bounded to a few weeks of rows per held set.
const LOOKBACK_DAYS = 14;
const SALES_LIMIT = 20;

type Holding = {
  set_num: string;
  name: string | null;
  theme: string | null;
  image_url: string | null;
  quantity: number | null;
  added_at: string | null;
  // The per-set series set_value_history snapshots (blended, else formula).
  series_now: number | null;
  // What the Vault shows for this copy (condition-aware, pricing rollout).
  value_now: number;
};

type Mover = {
  set_num: string;
  name: string;
  theme: string | null;
  image_url: string | null;
  quantity: number;
  value_now: number;
  value_then: number;
  delta: number;
  pct: number;
};

export function isoDaysAgo(days: number, now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function clampDays(raw: string | undefined): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return MOVER_DAYS;
  return Math.min(90, Math.max(1, n));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function valuesAt(db: D1Database, userId: string, since: string): Promise<Map<string, number>> {
  const { results } = await db.prepare(`
    SELECT h.set_num, h.current_value
    FROM set_value_history h
    JOIN (
      SELECT set_num, MAX(snapshot_date) AS d
      FROM set_value_history
      WHERE snapshot_date <= ?2
        AND snapshot_date >= date(?2, ?3)
        AND set_num IN (SELECT set_num FROM user_collection WHERE user_id = ?1 AND deleted_at IS NULL)
      GROUP BY set_num
    ) latest ON latest.set_num = h.set_num AND latest.d = h.snapshot_date
  `).bind(userId, since, `-${LOOKBACK_DAYS} days`).all<{ set_num: string; current_value: number | null }>();
  const out = new Map<string, number>();
  for (const row of results || []) {
    const v = Number(row.current_value);
    if (Number.isFinite(v) && v > 0) out.set(row.set_num, v);
  }
  return out;
}

// A holding is comparable when it was already held on `since` and has a value
// on both ends. `added_at` is a UTC datetime; compare its date part.
function compare(holdings: Holding[], then: Map<string, number>, since: string) {
  let valueNow = 0;
  let valueThen = 0;
  let compared = 0;
  const rows: Mover[] = [];
  for (const h of holdings) {
    const now = Number(h.value_now);
    const seriesNow = Number(h.series_now);
    const seriesThen = then.get(h.set_num);
    if (!(now > 0) || !(seriesNow > 0) || seriesThen == null) continue;
    if (h.added_at && String(h.added_at).slice(0, 10) > since) continue;
    const before = now * (seriesThen / seriesNow);
    const qty = Math.max(1, Number(h.quantity) || 1);
    valueNow += now * qty;
    valueThen += before * qty;
    compared++;
    rows.push({
      set_num: h.set_num,
      name: h.name || h.set_num,
      theme: h.theme,
      image_url: h.image_url,
      quantity: qty,
      value_now: round2(now),
      value_then: round2(before),
      delta: round2((now - before) * qty),
      pct: round2(((now - before) / before) * 100),
    });
  }
  return { valueNow, valueThen, compared, rows };
}

app.get('/', async (c) => {
  const userId = c.get('userId');
  const days = clampDays(c.req.query('days'));
  const since = isoDaysAgo(days);
  const moverSince = isoDaysAgo(MOVER_DAYS);

  const [holdingsRes, realizedRes, salesRes] = await Promise.all([
    c.env.DB.prepare(`
      SELECT uc.set_num, uc.condition, s.name, s.theme, s.image_url, uc.quantity, uc.added_at,
             COALESCE(NULLIF(s.blended_value, 0), s.current_value) AS series_now,
             s.current_value, s.blended_value, s.used_value,
             s.ebay_used_value, s.pc_new_value, s.pc_complete_value,
             svn.fair_value AS v3_new_fair, svu.fair_value AS v3_used_fair
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      LEFT JOIN set_valuation_state svn ON svn.set_num = s.set_num AND svn.condition = 'new_sealed'
      LEFT JOIN set_valuation_state svu ON svu.set_num = s.set_num AND svu.condition = 'used_complete'
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL
    `).bind(userId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`
      SELECT CAST(COUNT(*) AS INTEGER) AS sales,
             CAST(COALESCE(SUM(CASE WHEN purchase_price IS NOT NULL THEN 1 ELSE 0 END), 0) AS INTEGER) AS priced_sales,
             COALESCE(SUM(sold_price), 0) AS proceeds,
             -- Net of sale fees; sold_price covers the whole holding, so every copy's cost comes off.
             COALESCE(SUM(CASE WHEN purchase_price IS NOT NULL THEN sold_price - COALESCE(sold_fees, 0) - purchase_price * COALESCE(quantity, 1) ELSE 0 END), 0) AS gain
      FROM user_collection
      WHERE user_id = ? AND sold_at IS NOT NULL AND sold_price IS NOT NULL
    `).bind(userId).first<{ sales: number; priced_sales: number; proceeds: number; gain: number }>(),
    c.env.DB.prepare(`
      SELECT uc.set_num, s.name, uc.sold_at, uc.sold_price, uc.sold_fees, uc.quantity, uc.purchase_price
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      WHERE uc.user_id = ? AND uc.sold_at IS NOT NULL AND uc.sold_price IS NOT NULL
      ORDER BY uc.sold_at DESC
      LIMIT ${SALES_LIMIT}
    `).bind(userId).all<{ set_num: string; name: string | null; sold_at: string; sold_price: number; sold_fees: number | null; quantity: number | null; purchase_price: number | null }>(),
  ]);

  const rolloutPercent = Number(c.env.PRICING_V3_READ_PERCENT || 0);
  const holdings: Holding[] = (holdingsRes.results || []).map(row => ({
    set_num: String(row.set_num),
    name: row.name == null ? null : String(row.name),
    theme: row.theme == null ? null : String(row.theme),
    image_url: row.image_url == null ? null : String(row.image_url),
    quantity: row.quantity == null ? null : Number(row.quantity),
    added_at: row.added_at == null ? null : String(row.added_at),
    series_now: row.series_now == null ? null : Number(row.series_now),
    value_now: holdingValueForRollout(row, rolloutPercent),
  }));
  const thenValues = await valuesAt(c.env.DB, userId, since);
  const moverValues = moverSince === since ? thenValues : await valuesAt(c.env.DB, userId, moverSince);

  const span = compare(holdings, thenValues, since);
  const moverWindow = moverSince === since ? span : compare(holdings, moverValues, moverSince);
  const movers = moverWindow.rows
    .filter(row => Math.abs(row.delta) >= 0.5)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.name.localeCompare(b.name))
    .slice(0, MOVER_LIMIT);

  const totalNow = holdings.reduce((sum, h) => sum + (Number(h.value_now) > 0 ? Number(h.value_now) * Math.max(1, Number(h.quantity) || 1) : 0), 0);
  const hasThen = span.compared > 0;
  const delta = hasThen ? span.valueNow - span.valueThen : null;

  return c.json({
    since,
    days,
    value_now: hasThen ? round2(span.valueNow) : null,
    value_then: hasThen ? round2(span.valueThen) : null,
    delta: delta == null ? null : round2(delta),
    pct: delta == null || !(span.valueThen > 0) ? null : round2((delta / span.valueThen) * 100),
    total_now: round2(totalNow),
    compared: span.compared,
    mover_days: MOVER_DAYS,
    movers,
    realized: {
      gain: round2(Number(realizedRes?.gain) || 0),
      sales: Number(realizedRes?.sales) || 0,
      priced_sales: Number(realizedRes?.priced_sales) || 0,
      proceeds: round2(Number(realizedRes?.proceeds) || 0),
      items: (salesRes.results || []).map(row => ({
        set_num: row.set_num,
        name: row.name || row.set_num,
        sold_at: String(row.sold_at).slice(0, 10),
        sold_price: Number(row.sold_price) || 0,
        sold_fees: Number(row.sold_fees) || 0,
        quantity: Math.max(1, Number(row.quantity) || 1),
        purchase_price: row.purchase_price == null ? null : Number(row.purchase_price),
      })),
    },
  });
});

export const changesRoute = app;
