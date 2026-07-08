import { Hono, type Context } from 'hono';
import { requireMember } from '../auth';
import { formulaValuation } from '../lib/valuation';
import { fetchTracked } from '../lib/http';
import { enrichSetRecord } from '../lib/market-sources';
import { logEvent } from '../lib/analytics';
import type { Env, Variables } from '../types';
import { runSyncProcess } from './google-sync';
import { awardXpForAdd } from '../lib/kids-xp';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

async function triggerGoogleSync(userId: string, c: Context<{ Bindings: Env; Variables: Variables }>) {
  try {
    const prefs = await c.env.DB.prepare('SELECT google_refresh_token, google_spreadsheet_id FROM user_prefs WHERE user_id=?')
      .bind(userId).first() as { google_refresh_token?: string; google_spreadsheet_id?: string } | null;
    if (prefs?.google_refresh_token) {
      c.executionCtx.waitUntil(
        runSyncProcess(userId, prefs.google_refresh_token, prefs.google_spreadsheet_id || null, c.env)
      );
    }
  } catch (err) {
    console.error('[sync-trigger] Failed to trigger Google Sheets sync:', err);
  }
}

app.use('*', requireMember);

// GET /api/collection — list user's collection
app.get('/', async (c) => {
  const userId = c.get('userId');

  const [collStats, figStats, valFingerprint] = await Promise.all([
    c.env.DB.prepare(`
      SELECT SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as count,
             MAX(COALESCE(deleted_at, last_modified)) as max_time
      FROM user_collection
      WHERE user_id = ?
    `).bind(userId).first<{ count: number; max_time: string | null }>(),
    c.env.DB.prepare(`
      SELECT COUNT(*) as count,
             MAX(added_at) as max_time
      FROM user_minifigs
      WHERE user_id = ?
    `).bind(userId).first<{ count: number; max_time: string | null }>(),
    // Value fingerprint: any cron price update busts the ETag so the browser
    // doesn't serve a 304 with stale prices after a valuation run.
    c.env.DB.prepare(`
      SELECT ROUND(SUM(
               COALESCE(s.current_value,0) + COALESCE(s.blended_value,0) +
               COALESCE(s.used_value,0) +
               COALESCE(s.ebay_new_value,0) + COALESCE(s.ebay_used_value,0) +
               COALESCE(s.ebay_value,0) + COALESCE(s.forecast_2y,0) +
               COALESCE(s.retirement_risk_score,0) + COALESCE(s.retired,0)
             ), 2) as fp
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      WHERE uc.user_id = ? AND uc.deleted_at IS NULL
    `).bind(userId).first<{ fp: number | null }>()
  ]);

  const collCountEtag = collStats?.count ?? 0;
  const collMaxTimeEtag = collStats?.max_time || '';
  const figCountEtag = figStats?.count ?? 0;
  const figMaxTimeEtag = figStats?.max_time || '';
  const valEtag = valFingerprint?.fp ?? 0;

  const etag = `W/"${collCountEtag}-${collMaxTimeEtag}-${figCountEtag}-${figMaxTimeEtag}-${valEtag}"`;

  c.header('ETag', etag);
  c.header('Cache-Control', 'no-cache');

  if (c.req.header('if-none-match') === etag) {
    return c.body(null, 304);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      uc.id, uc.set_num, uc.quantity, uc.condition, uc.purchase_price,
      uc.notes, uc.added_at, uc.purchased_at, uc.last_modified,
      uc.storage_location, uc.acquisition_source, uc.is_complete, uc.missing_pieces, uc.custom_image_url,
      s.name, s.theme, s.year, s.pieces, s.minifigs,
      s.retail_price, s.current_value, s.forecast_2y, s.forecast_5y,
      s.image_url, s.retired, s.retirement_risk_score, s.used_value, s.ebay_value,
      s.ebay_new_value, s.ebay_used_value, s.ebay_new_qty, s.ebay_used_qty,
      s.ebay_new_cached_at, s.ebay_used_cached_at, s.ebay_cached_at, s.cached_at,
      s.valuation_method, s.bl_new_value, s.bl_new_qty, s.bl_used_qty,
      s.bo_used_value, s.bl_cached_at, s.be_cached_at, s.blended_value
    FROM user_collection uc
    JOIN lego_sets s ON s.set_num = uc.set_num
    WHERE uc.user_id = ? AND uc.deleted_at IS NULL
    ORDER BY uc.added_at DESC
  `).bind(userId).all<Record<string, unknown>>();

  // Fetch past 90 days history for sets in collection to calculate slopes on-the-fly
  const historyRows = await c.env.DB.prepare(`
    SELECT set_num, snapshot_date, current_value
    FROM set_value_history
    WHERE set_num IN (SELECT set_num FROM user_collection WHERE user_id = ? AND deleted_at IS NULL)
      AND snapshot_date >= DATE('now', '-90 days')
    ORDER BY set_num, snapshot_date ASC
  `).bind(userId).all<{ set_num: string; snapshot_date: string; current_value: number }>();

  const historyBySet: Record<string, Array<{ x: number; y: number }>> = {};
  if (historyRows.results) {
    const tempGroup: Record<string, Array<{ date: string; val: number }>> = {};
    for (const r of historyRows.results) {
      if (!tempGroup[r.set_num]) tempGroup[r.set_num] = [];
      tempGroup[r.set_num].push({ date: r.snapshot_date, val: r.current_value });
    }
    for (const [setNum, list] of Object.entries(tempGroup)) {
      if (list.length >= 14) {
        const firstTime = new Date(list[0].date).getTime();
        historyBySet[setNum] = list.map(item => ({
          x: (new Date(item.date).getTime() - firstTime) / (24 * 3600 * 1000),
          y: item.val
        }));
      }
    }
  }

  const trends: Record<string, { trend: 'rising' | 'stable' | 'falling'; slope: number }> = {};
  for (const [setNum, data] of Object.entries(historyBySet)) {
    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (const p of data) {
      sumX += p.x;
      sumY += p.y;
      sumXY += p.x * p.y;
      sumXX += p.x * p.x;
    }
    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) {
      trends[setNum] = { trend: 'stable', slope: 0 };
      continue;
    }
    const slopeDaily = (n * sumXY - sumX * sumY) / denominator;
    const avgY = sumY / n;
    if (avgY === 0) {
      trends[setNum] = { trend: 'stable', slope: 0 };
      continue;
    }
    const slopePctPerWeek = (slopeDaily * 7 / avgY) * 100;
    let trend: 'rising' | 'stable' | 'falling' = 'stable';
    if (slopePctPerWeek > 0.5) trend = 'rising';
    else if (slopePctPerWeek < -0.5) trend = 'falling';
    trends[setNum] = { trend, slope: slopePctPerWeek };
  }

  // Portfolio basis (Approach A): blended fair value where available, else the
  // formula current_value. Used holdings are valued at their used-market price
  // (real used comps when present), so condition affects the holding's worth —
  // mirrors marketValueForCondition() on the front end.
  const conditionValue = (r: Record<string, unknown>): number => {
    const base = Number(r.blended_value) || Number(r.current_value) || 0;
    if (!String(r.condition || '').startsWith('used')) return base;
    const used = Number(r.ebay_used_value) || Number(r.used_value)
      || Number(r.bo_used_value) || 0;
    return used || base;
  };

  const items = results.map(row => {
    const marketVal = conditionValue(row as Record<string, unknown>);
    let annualizedRoi = null;
    if (row.purchased_at && Number(row.purchase_price) > 0 && marketVal > 0) {
      const years = (Date.now() - new Date(row.purchased_at as string).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (years >= 0.08) {
        annualizedRoi = Math.pow(marketVal / Number(row.purchase_price), 1 / years) - 1;
      }
    }
    const t = trends[row.set_num as string] || { trend: 'stable', slope: 0 };
    return enrichSetRecord({
      ...row,
      retired: !!row.retired,
      is_complete: !!row.is_complete,
      annualized_roi: annualizedRoi,
      trend: t.trend,
      slope_90d: t.slope
    } as Record<string, unknown>);
  });

  const totalValue = items.reduce((s, r) => s + conditionValue(r as Record<string, unknown>) * Number(r.quantity), 0);
  const totalPaid  = items.reduce((s, r) => s + (Number(r.purchase_price) || 0) * Number(r.quantity), 0);
  const minifigCount = items.reduce((s, r) => s + (Number(r.minifigs) || 0) * Number(r.quantity), 0);
  const count = items.length;
  const minifigsStats = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(COALESCE(m.current_value, CASE m.rarity
        WHEN 'common' THEN 3.50
        WHEN 'uncommon' THEN 7.50
        WHEN 'rare' THEN 18.00
        WHEN 'legendary' THEN 50.00
        ELSE 3.50
      END) * um.quantity), 0) as fig_value,
      CAST(COUNT(um.fig_num) AS INTEGER) as fig_count
    FROM user_minifigs um
    JOIN minifigs m ON m.fig_num = um.fig_num
    WHERE um.user_id = ?
  `).bind(userId).first<{ fig_value: number; fig_count: number }>();

  const figValue = minifigsStats?.fig_value || 0;
  const figCount = minifigsStats?.fig_count || 0;

  // Portfolio-level pricing trust: what share of priced holdings rests on a
  // high/medium-confidence market value (vs. a thin/estimated one). Uses the
  // anomaly-aware blend confidence, falling back to the trust-panel confidence.
  const priced = items.filter(r => conditionValue(r as Record<string, unknown>) > 0);
  const confOf = (r: Record<string, unknown>) => String(r.market_value_confidence || r.confidence || '');
  const highMed = priced.filter(r => {
    const cf = confOf(r as Record<string, unknown>);
    return cf === 'high' || cf === 'medium';
  }).length;
  const pricingConfidence = {
    priced: priced.length,
    high_medium: highMed,
    pct: priced.length ? Math.round((highMed / priced.length) * 100) : 0,
  };

  return c.json({
    items,
    total_value: totalValue,
    total_paid: totalPaid,
    count,
    minifig_count: minifigCount,
    fig_value: figValue,
    fig_count: figCount,
    total_value_with_figs: totalValue + figValue,
    pricing_confidence: pricingConfidence
  });
});

// POST /api/collection — add/upsert a set
app.post('/', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{
    set_num?: string; quantity?: number; condition?: string;
    purchase_price?: number; notes?: string; purchased_at?: string;
  }>();
  const { set_num, quantity = 1, condition = 'new', purchase_price, notes, purchased_at } = body;
  if (!set_num) return c.json({ error: 'set_num required' }, 400);
  const validConditions = ['new', 'used_good', 'used_acceptable', 'sealed'];
  if (!validConditions.includes(condition)) return c.json({ error: 'Invalid condition' }, 400);

  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
    return c.json({ error: 'Quantity must be an integer >= 1' }, 400);
  }
  if (purchase_price !== undefined && purchase_price !== null && (typeof purchase_price !== 'number' || purchase_price < 0)) {
    return c.json({ error: 'Purchase price must be a number >= 0' }, 400);
  }
  if (purchased_at) {
    if (typeof purchased_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(purchased_at) || isNaN(Date.parse(purchased_at))) {
      return c.json({ error: 'Purchased at must be a valid YYYY-MM-DD date string' }, 400);
    }
  }

  const existing = await c.env.DB.prepare('SELECT 1 FROM lego_sets WHERE set_num=?').bind(set_num).first();
  if (!existing) return c.json({ error: 'Set not found in catalog' }, 404);

  await c.env.DB.prepare(`
    INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price, notes, purchased_at, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (user_id, set_num) DO UPDATE SET
      quantity = EXCLUDED.quantity,
      condition = EXCLUDED.condition,
      purchase_price = COALESCE(EXCLUDED.purchase_price, user_collection.purchase_price),
      notes = COALESCE(EXCLUDED.notes, user_collection.notes),
      purchased_at = COALESCE(EXCLUDED.purchased_at, user_collection.purchased_at),
      last_modified = datetime('now'),
      deleted_at = NULL
  `).bind(userId, set_num, quantity, condition, purchase_price ?? null, notes ?? null, purchased_at ?? null).run();

  const item = await c.env.DB.prepare(
    'SELECT * FROM user_collection WHERE user_id=? AND set_num=? AND deleted_at IS NULL'
  ).bind(userId, set_num).first();
  logEvent(c.env, 'set_added', userId, { setNum: set_num });
  const kidsResult = await awardXpForAdd(c.env.DB, userId);
  c.executionCtx.waitUntil(triggerGoogleSync(userId, c));
  return c.json({ item, kids: kidsResult.xp_gained > 0 ? kidsResult : undefined }, 201);
});

// GET /api/collection/export
// Pro (is_supporter) gates the investor toolkit: CSV export and full portfolio
// history depth. The flag comes from Play/Apple/Stripe purchase events and is
// the authoritative entitlement source (same check as scan/revalue limits).
async function isSupporter(c: { env: { DB: D1Database } }, userId: string): Promise<boolean> {
  const pref = await c.env.DB.prepare(
    'SELECT is_supporter FROM user_prefs WHERE user_id=?'
  ).bind(userId).first<{ is_supporter: number }>().catch(() => null);
  return !!pref?.is_supporter;
}

// Export is tiered, never blocked: your own entered data (sets, qty, condition,
// purchase price/date, notes) always exports — data portability is a right, not
// a perk. Pro adds the computed market-intelligence columns (current value,
// retail, ROI), which are the product's derived work.
app.get('/export', async (c) => {
  const userId = c.get('userId');
  const pro = await isSupporter(c, userId);
  const { results } = await c.env.DB.prepare(`
    SELECT
      uc.id, uc.set_num, uc.quantity, uc.condition, uc.purchase_price,
      uc.purchased_at, uc.storage_location, uc.acquisition_source,
      uc.is_complete, uc.missing_pieces, uc.notes, uc.added_at,
      s.name, s.theme, s.year, s.pieces, s.minifigs,
      s.retail_price, s.current_value
    FROM user_collection uc
    JOIN lego_sets s ON s.set_num = uc.set_num
    WHERE uc.user_id = ? AND uc.deleted_at IS NULL
    ORDER BY uc.added_at DESC
  `).bind(userId).all<Record<string, unknown>>();

  const csvCell = (v: unknown) => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };

  const headers = [
    'set_num','name','theme','year','pieces','minifigs',
    'condition','quantity','purchase_price','purchased_at',
    ...(pro ? ['current_value','retail_price','roi_pct'] : []),
    'storage_location','acquisition_source',
    'is_complete','missing_pieces','notes','added_at',
  ];

  const rows = results.map(r => {
    const pp = Number(r.purchase_price);
    const cv = Number(r.current_value);
    const roi = pp > 0 && cv > 0 ? ((cv - pp) / pp * 100).toFixed(2) : '';
    const pa = r.purchased_at ? String(r.purchased_at).slice(0, 10) : '';
    const aa = r.added_at ? String(r.added_at).slice(0, 10) : '';
    return [
      r.set_num, r.name, r.theme, r.year, r.pieces, r.minifigs,
      r.condition, r.quantity, r.purchase_price ?? '', pa,
      ...(pro ? [r.current_value ?? '', r.retail_price ?? '', roi] : []),
      r.storage_location ?? '', r.acquisition_source ?? '',
      r.is_complete == null ? 'true' : String(!!r.is_complete), r.missing_pieces ?? 0,
      r.notes ?? '', aa,
    ].map(csvCell).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="brickvault-export.csv"',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    },
  });
});

// GET /api/collection/history
// Free tier sees the last 90 days; Pro unlocks the full retained history (365d).
// The response reports the applied window + tier so the chart can show an
// honest "unlock 1y" affordance instead of silently truncating.
app.get('/history', async (c) => {
  const userId = c.get('userId');
  const requested = Math.min(parseInt(c.req.query('days') || '90', 10), 365);
  const pro = await isSupporter(c, userId);
  const days = pro ? requested : Math.min(requested, 90);
  const { results } = await c.env.DB.prepare(`
    SELECT snapshot_date, total_value, total_paid, set_count
    FROM portfolio_snapshots
    WHERE user_id = ? AND snapshot_date >= DATE('now', ? )
    ORDER BY snapshot_date ASC
  `).bind(userId, `-${days} days`).all();
  return c.json({ snapshots: results, days, pro });
});

// POST /api/collection/import
app.post('/import', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ rows?: unknown[]; overwrite?: boolean }>();
  const { rows, overwrite = false } = body;
  if (!Array.isArray(rows) || rows.length === 0) return c.json({ error: 'rows array required' }, 400);
  if (rows.length > 500) return c.json({ error: 'max 500 rows per import' }, 400);

  // Pre-load owned sets to avoid per-row duplicate queries when overwrite=false.
  let ownedSets = new Set<string>();
  const setKey = (v: string) => String(v || '').replace(/-1$/, '');
  if (!overwrite) {
    const { results: owned } = await c.env.DB.prepare(
      'SELECT set_num FROM user_collection WHERE user_id=? AND deleted_at IS NULL'
    ).bind(userId).all<{ set_num: string }>();
    ownedSets = new Set(owned.map(r => setKey(r.set_num)));
  }

  let skipped = 0;
  const errors: unknown[] = [];
  const stmts: D1PreparedStatement[] = [];
  const validConds = ['new', 'used_good', 'used_acceptable', 'sealed'];

  // Unknown sets fall back to a Rebrickable lookup, but that's an external
  // subrequest PER ROW: a 500-row import of unknown sets used to fire 500
  // serial fetches — blowing the Workers subrequest cap / 30s limit and
  // failing the whole import opaquely. Cap the lookups per request and dedupe
  // misses so duplicate rows of the same unknown set don't refetch.
  const EXTERNAL_LOOKUP_CAP = 25;
  let externalLookups = 0;
  const externalMisses = new Set<string>();

  for (const row of rows as Record<string, unknown>[]) {
    const set_num = String(row.set_num || '').trim();
    if (!set_num) { errors.push({ row, reason: 'missing set_num' }); continue; }

    let catalog = await c.env.DB.prepare('SELECT 1 FROM lego_sets WHERE set_num=?').bind(set_num).first();
    if (!catalog && externalMisses.has(set_num)) {
      errors.push({ set_num, reason: 'set not in catalog' }); skipped++; continue;
    }
    if (!catalog && c.env.REBRICKABLE_API_KEY && externalLookups >= EXTERNAL_LOOKUP_CAP) {
      errors.push({ set_num, reason: `unknown set — catalog lookup limit (${EXTERNAL_LOOKUP_CAP}) reached for this import; re-import the remaining rows to continue` });
      skipped++; continue;
    }
    if (!catalog && c.env.REBRICKABLE_API_KEY) {
      externalLookups++;
      try {
        const url = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(set_num)}/`;
        const rb = await fetchTracked(c.env, 'rebrickable', url, { headers: { 'Authorization': `key ${c.env.REBRICKABLE_API_KEY}` } });
        if (rb.ok) {
          const s = await rb.json() as { set_num: string; name: string; year: number; num_parts: number; num_minifigs: number; set_img_url: string };
          const vals = formulaValuation({ pieces: s.num_parts, year: s.year, retired: false, minifigs: s.num_minifigs || 0 });
          await c.env.DB.prepare(`
            INSERT INTO lego_sets (set_num,name,year,pieces,minifigs,image_url,retail_price,current_value,forecast_2y,forecast_5y,valuation_method,cached_at,source)
            VALUES (?,?,?,?,?,?,?,?,?,?,'formula_bulk',datetime('now'),'rebrickable')
            ON CONFLICT (set_num) DO UPDATE SET cached_at=datetime('now')
          `).bind(s.set_num, s.name, s.year, s.num_parts, s.num_minifigs || 0, s.set_img_url,
                  vals.retail_price, vals.current_value, vals.forecast_2y, vals.forecast_5y).run();
          catalog = { set_num: s.set_num };
        } else {
          externalMisses.add(set_num);
        }
      } catch (e) {
        externalMisses.add(set_num);
        console.warn(`[import] Rebrickable fallback failed for ${set_num}:`, (e as Error).message);
      }
    }

    if (!catalog) { errors.push({ set_num, reason: 'set not in catalog' }); skipped++; continue; }

    const key = setKey(set_num);
    if (!overwrite && ownedSets.has(key)) { skipped++; continue; }

    const condition = validConds.includes(String(row.condition)) ? String(row.condition) : 'new';
    const quantity = Math.max(1, parseInt(String(row.quantity)) || 1);
    const rawPrice = row.purchase_price;
    const parsedPrice = rawPrice === undefined || rawPrice === null || String(rawPrice).trim() === ''
      ? null
      : Number(rawPrice);
    const purchase_price = parsedPrice !== null && Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : null;
    const purchased_at = row.purchased_at ? String(row.purchased_at) : null;
    const notes = row.notes ? String(row.notes) : null;
    const storage_location = row.storage_location ? String(row.storage_location) : null;
    const acquisition_source = row.acquisition_source ? String(row.acquisition_source) : null;
    const is_complete = row.is_complete === 'false' || row.is_complete === false ? 0 : 1;
    const missing_pieces = parseInt(String(row.missing_pieces)) || 0;

    stmts.push(c.env.DB.prepare(`
      INSERT INTO user_collection
        (user_id, set_num, quantity, condition, purchase_price, purchased_at,
         notes, storage_location, acquisition_source, is_complete, missing_pieces, last_modified)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT (user_id, set_num) DO UPDATE SET
        quantity = EXCLUDED.quantity,
        condition = EXCLUDED.condition,
        purchase_price = COALESCE(EXCLUDED.purchase_price, user_collection.purchase_price),
        purchased_at = COALESCE(EXCLUDED.purchased_at, user_collection.purchased_at),
        notes = COALESCE(EXCLUDED.notes, user_collection.notes),
        storage_location = COALESCE(EXCLUDED.storage_location, user_collection.storage_location),
        acquisition_source = COALESCE(EXCLUDED.acquisition_source, user_collection.acquisition_source),
        is_complete = EXCLUDED.is_complete,
        missing_pieces = EXCLUDED.missing_pieces,
        last_modified = datetime('now'),
        deleted_at = NULL
    `).bind(userId, set_num, quantity, condition, purchase_price, purchased_at,
        notes, storage_location, acquisition_source, is_complete, missing_pieces));
    if (!overwrite) ownedSets.add(key);
  }

  // Batch write — D1 batch limit is 100 statements per call.
  for (let i = 0; i < stmts.length; i += 100) {
    await c.env.DB.batch(stmts.slice(i, i + 100));
  }

  const imported = stmts.length;
  const allDuplicates = imported === 0 && skipped === rows.length;
  if (imported > 0) {
    c.executionCtx.waitUntil(triggerGoogleSync(userId, c));
  }
  return c.json({ imported, skipped, errors: errors.slice(0, 20), allDuplicates });
});

// GET /api/collection/:id
app.get('/:id', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const check = await c.env.DB.prepare(
    'SELECT id FROM user_collection WHERE id=? AND user_id=? AND deleted_at IS NULL'
  ).bind(id, userId).first();
  if (!check) return c.json({ error: 'Not found' }, 404);

  const item = await c.env.DB.prepare(`
    SELECT uc.*, s.name, s.theme, s.year, s.pieces, s.minifigs,
      s.retail_price, s.current_value, s.forecast_2y, s.forecast_5y, s.image_url
    FROM user_collection uc
    JOIN lego_sets s ON s.set_num = uc.set_num
    WHERE uc.id=? AND uc.user_id=? AND uc.deleted_at IS NULL
  `).bind(id, userId).first<Record<string, unknown>>();
  return c.json({ item: item ? { ...item, retired: !!item.retired, is_complete: !!item.is_complete } : null });
});

// PATCH /api/collection/:id
app.patch('/:id', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const check = await c.env.DB.prepare(
    'SELECT id FROM user_collection WHERE id=? AND user_id=? AND deleted_at IS NULL'
  ).bind(id, userId).first();
  if (!check) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>();

  if ('quantity' in body) {
    const q = body.quantity;
    if (typeof q !== 'number' || !Number.isInteger(q) || q < 1) {
      return c.json({ error: 'Quantity must be an integer >= 1' }, 400);
    }
  }
  if ('condition' in body) {
    const cond = body.condition;
    const validConditions = ['new', 'used_good', 'used_acceptable', 'sealed'];
    if (typeof cond !== 'string' || !validConditions.includes(cond)) {
      return c.json({ error: 'Invalid condition' }, 400);
    }
  }
  if ('purchase_price' in body) {
    const p = body.purchase_price;
    if (p !== null && (typeof p !== 'number' || p < 0)) {
      return c.json({ error: 'Purchase price must be a number >= 0' }, 400);
    }
  }
  if ('purchased_at' in body && body.purchased_at) {
    const pa = body.purchased_at;
    if (typeof pa !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(pa) || isNaN(Date.parse(pa))) {
      return c.json({ error: 'Purchased at must be a valid YYYY-MM-DD date string' }, 400);
    }
  }
  if ('missing_pieces' in body) {
    const mp = body.missing_pieces;
    if (typeof mp !== 'number' || !Number.isInteger(mp) || mp < 0) {
      return c.json({ error: 'Missing pieces must be an integer >= 0' }, 400);
    }
  }

  const ALLOWED = ['quantity','condition','purchase_price','purchased_at','notes',
                   'storage_location','acquisition_source','is_complete','missing_pieces'];
  const fields: string[] = [];
  const vals: unknown[] = [];
  for (const key of ALLOWED) {
    if (key in body) {
      fields.push(`${key}=?`);
      vals.push(key === 'is_complete' ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (!fields.length) return c.json({ error: 'No fields to update' }, 400);
  fields.push(`last_modified=datetime('now')`);
  vals.push(id, userId);

  await c.env.DB.prepare(
    `UPDATE user_collection SET ${fields.join(',')} WHERE id=? AND user_id=?`
  ).bind(...vals).run();

  const item = await c.env.DB.prepare(
    'SELECT * FROM user_collection WHERE id=? AND user_id=? AND deleted_at IS NULL'
  ).bind(id, userId).first<Record<string, unknown>>();
  c.executionCtx.waitUntil(triggerGoogleSync(userId, c));
  return c.json({ item: item ? { ...item, is_complete: !!item.is_complete } : null });
});

// DELETE /api/collection/:id
app.delete('/:id', async (c) => {
  const userId = c.get('userId');
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'Invalid id' }, 400);

  const check = await c.env.DB.prepare(
    'SELECT id FROM user_collection WHERE id=? AND user_id=? AND deleted_at IS NULL'
  ).bind(id, userId).first();
  if (!check) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare(
    `UPDATE user_collection SET deleted_at=datetime('now') WHERE id=? AND user_id=?`
  ).bind(id, userId).run();
  logEvent(c.env, 'set_removed', userId);
  c.executionCtx.waitUntil(triggerGoogleSync(userId, c));
  return c.body(null, 204);
});

export { app as collectionRoute };
