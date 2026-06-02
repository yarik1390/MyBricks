import { Hono } from 'hono';
import { requireMember } from '../auth';
import { formulaValuation } from '../lib/valuation';
import type { Env, Variables } from '../types';
import { runSyncProcess } from './google-sync';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

async function triggerGoogleSync(userId: string, c: any) {
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
  const { results } = await c.env.DB.prepare(`
    SELECT
      uc.id, uc.set_num, uc.quantity, uc.condition, uc.purchase_price,
      uc.notes, uc.added_at, uc.purchased_at, uc.last_modified,
      uc.storage_location, uc.acquisition_source, uc.is_complete, uc.missing_pieces,
      s.name, s.theme, s.year, s.pieces, s.minifigs,
      s.retail_price, s.current_value, s.forecast_2y, s.forecast_5y,
      s.image_url, s.retired
    FROM user_collection uc
    JOIN lego_sets s ON s.set_num = uc.set_num
    WHERE uc.user_id = ? AND uc.deleted_at IS NULL
    ORDER BY uc.added_at DESC
  `).bind(userId).all<Record<string, unknown>>();

  const items = results.map(row => {
    let annualizedRoi = null;
    if (row.purchased_at && Number(row.purchase_price) > 0 && Number(row.current_value) > 0) {
      const years = (Date.now() - new Date(row.purchased_at as string).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (years >= 0.08) {
        annualizedRoi = Math.pow(Number(row.current_value) / Number(row.purchase_price), 1 / years) - 1;
      }
    }
    return { ...row, retired: !!row.retired, is_complete: !!row.is_complete, annualized_roi: annualizedRoi } as Record<string, unknown>;
  });

  const totalValue = items.reduce((s, r) => s + (Number(r.current_value) || 0) * Number(r.quantity), 0);
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

  const lastModified = (items[0]?.last_modified || items[0]?.added_at || null) as string | null;
  const etag = `${count}-${lastModified ? new Date(lastModified).getTime() : 0}`;

  if (c.req.header('if-none-match') === etag) return new Response('', { status: 304 });
  return new Response(JSON.stringify({
    items,
    total_value: totalValue,
    total_paid: totalPaid,
    count,
    minifig_count: minifigCount,
    fig_value: figValue,
    fig_count: figCount,
    total_value_with_figs: totalValue + figValue
  }), {
    headers: { 'Content-Type': 'application/json', 'ETag': etag },
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
  c.executionCtx.waitUntil(triggerGoogleSync(userId, c));
  return c.json({ item }, 201);
});

// GET /api/collection/export
app.get('/export', async (c) => {
  const userId = c.get('userId');
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
    'current_value','retail_price','roi_pct',
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
      r.current_value ?? '', r.retail_price ?? '', roi,
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
    },
  });
});

// GET /api/collection/history
app.get('/history', async (c) => {
  const userId = c.get('userId');
  const days = Math.min(parseInt(c.req.query('days') || '90', 10), 365);
  const { results } = await c.env.DB.prepare(`
    SELECT snapshot_date, total_value, total_paid, set_count
    FROM portfolio_snapshots
    WHERE user_id = ? AND snapshot_date >= DATE('now', ? )
    ORDER BY snapshot_date ASC
  `).bind(userId, `-${days} days`).all();
  return c.json({ snapshots: results });
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
  if (!overwrite) {
    const { results: owned } = await c.env.DB.prepare(
      'SELECT set_num FROM user_collection WHERE user_id=? AND deleted_at IS NULL'
    ).bind(userId).all<{ set_num: string }>();
    ownedSets = new Set(owned.map(r => r.set_num));
  }

  let skipped = 0;
  const errors: unknown[] = [];
  const stmts: D1PreparedStatement[] = [];
  const validConds = ['new', 'used_good', 'used_acceptable', 'sealed'];

  for (const row of rows as Record<string, unknown>[]) {
    const set_num = String(row.set_num || '').trim();
    if (!set_num) { errors.push({ row, reason: 'missing set_num' }); continue; }

    let catalog = await c.env.DB.prepare('SELECT 1 FROM lego_sets WHERE set_num=?').bind(set_num).first();
    if (!catalog && c.env.REBRICKABLE_API_KEY) {
      try {
        const url = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(set_num)}/`;
        const rb = await fetch(url, { headers: { 'Authorization': `key ${c.env.REBRICKABLE_API_KEY}` } });
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
        }
      } catch (e) {
        console.warn(`[import] Rebrickable fallback failed for ${set_num}:`, (e as Error).message);
      }
    }

    if (!catalog) { errors.push({ set_num, reason: 'set not in catalog' }); skipped++; continue; }

    if (!overwrite && ownedSets.has(set_num)) { skipped++; continue; }

    const condition = validConds.includes(String(row.condition)) ? String(row.condition) : 'new';
    const quantity = Math.max(1, parseInt(String(row.quantity)) || 1);
    const purchase_price = parseFloat(String(row.purchase_price)) || null;
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
    'SELECT * FROM user_collection WHERE id=?'
  ).bind(id).first<Record<string, unknown>>();
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
  c.executionCtx.waitUntil(triggerGoogleSync(userId, c));
  return new Response('', { status: 204 });
});

export { app as collectionRoute };
