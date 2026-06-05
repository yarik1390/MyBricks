import { Hono } from 'hono';
import OpenAI from 'openai';
import { requireMember } from '../auth';
import { formulaValuation } from '../lib/valuation';
import { fetchSetPricing, fetchUsedPricing } from '../lib/bricklink';
import { fetchBricksetDetails } from '../lib/brickset';
import { fetchEbayPrice } from '../lib/ebay';
import { callGeminiValuation } from '../lib/gemini';
import { fetchBrickEconomyDetails } from '../lib/brickeconomy';
import { getCachedPriceTrend } from '../lib/price-trend';
import type { Env, Variables } from '../types';

interface ListingDraft {
  title: string;
  description: string;
  suggested_price: number;
  price_reasoning: string;
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

const SORTS: Record<string, string> = {
  value_desc: 'current_value DESC',
  roi_desc:   '(current_value / NULLIF(retail_price, 0)) DESC',
  year_desc:  'year DESC',
  az:         'name ASC',
};

// GET /api/sets/search
app.get('/search', async (c) => {
  const q = c.req.query('q') || '';
  const theme = c.req.query('theme') || '';
  const retired = c.req.query('retired') || '';
  const sort = c.req.query('sort') || 'value_desc';
  const lim = Math.min(parseInt(c.req.query('limit') || '24', 10), 100);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10), 0);
  const orderBy = SORTS[sort] || SORTS.value_desc;

  const where: string[] = [];
  const params: unknown[] = [];
  let fromSQL = 'lego_sets s';
  let orderBySQL = orderBy;

  if (q) {
    const cleanedQ = q.trim().replace(/[*"']/g, '').split(/\s+/).filter(Boolean).map(tok => `${tok}*`).join(' ');
    if (cleanedQ) {
      fromSQL = 'lego_sets s JOIN lego_sets_fts f ON s.rowid = f.rowid';
      where.push(`f.lego_sets_fts MATCH ?`);
      params.push(cleanedQ);
      orderBySQL = `f.rank, ${orderBy}`;
    }
  }
  if (theme) { where.push(`s.theme = ?`); params.push(theme); }
  if (retired === '1' || retired === 'true') where.push(`s.retired = 1`);

  const rangeFilter = (key: string, col: string) => {
    const v = parseInt(c.req.query(key) || '', 10);
    if (!isNaN(v)) {
      const op = key.startsWith('min_') ? '>=' : '<=';
      where.push(`s.${col} ${op} ?`);
      params.push(v);
    }
  };
  rangeFilter('min_year', 'year');
  rangeFilter('max_year', 'year');
  rangeFilter('min_pieces', 'pieces');
  rangeFilter('max_pieces', 'pieces');
  rangeFilter('min_value', 'current_value');
  rangeFilter('max_value', 'current_value');

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [pageRes, countRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.* FROM ${fromSQL} ${whereSQL} ORDER BY ${orderBySQL}, s.set_num LIMIT ? OFFSET ?`
    ).bind(...params, lim, offset).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM ${fromSQL} ${whereSQL}`
    ).bind(...params).first<{ total: number }>(),
  ]);

  let rows = pageRes.results.map(r => ({ ...r, retired: !!r.retired })) as Record<string, unknown>[];
  let total = countRes?.total ?? 0;

  if (q && offset === 0 && rows.length < lim && c.env.REBRICKABLE_API_KEY) {
    try {
      const url = `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(q)}&key=${c.env.REBRICKABLE_API_KEY}&page_size=20`;
      const rb = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (rb.ok) {
        const data = await rb.json() as { results?: Array<{ set_num: string; name: string; year: number; theme_id: number; num_parts: number; num_minifigs: number; set_img_url: string }> };
        const seen = new Set(rows.map(r => r.set_num as string));
        for (const s of (data.results || [])) {
          if (seen.has(s.set_num)) continue;
          const vals = formulaValuation({ pieces: s.num_parts, year: s.year, theme: null, retired: false, minifigs: s.num_minifigs || 0 });
          rows.push({
            set_num: s.set_num, name: s.name, year: s.year, theme: null,
            pieces: s.num_parts, minifigs: s.num_minifigs || 0,
            image_url: s.set_img_url, retired: false, ...vals,
          });
        }
        rows = rows.slice(0, lim);
        total = Math.max(total, offset + rows.length);
      }
    } catch (_) { /* non-critical */ }
  }

  return c.json({ sets: rows, total, hasMore: offset + rows.length < total });
});

// GET /api/sets/:setnum
app.get('/:setnum', async (c) => {
  const setnum = c.req.param('setnum');
  const userId = c.get('userId');

  let set = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setnum).first<Record<string, unknown>>();
  if (!set) set = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setnum + '-1').first<Record<string, unknown>>();

  if (set) {
    const activeSet = set;
    let resultSet: Record<string, unknown> = set;

    const entry = userId
      ? await c.env.DB.prepare('SELECT * FROM user_collection WHERE user_id=? AND set_num=? AND deleted_at IS NULL').bind(userId, activeSet.set_num).first()
      : null;

    const trend = await getCachedPriceTrend(activeSet.set_num as string, c.env);

    // Non-blocking/blocking BrickLink or Gemini refresh when price is missing or stale
    const geminiKey = c.req.header('X-Gemini-Key');
    const isBulk = (activeSet.valuation_method === 'formula_bulk');
    const needsRefresh = isBulk
      || !activeSet.valuation_expires_at
      || new Date(activeSet.valuation_expires_at as string) < new Date()
      || (!activeSet.ebay_value && !activeSet.ebay_cached_at);

    if (needsRefresh) {
      if (c.env.BRICKECONOMY_API_KEY) {
        // Fetch BrickEconomy + BrickLink + eBay in parallel for cross-validation.
        const refreshPromise = Promise.all([
          fetchBrickEconomyDetails(activeSet.set_num as string, c.env).catch(() => null),
          fetchSetPricing(activeSet.set_num as string, c.env).catch(() => null),
          fetchUsedPricing(activeSet.set_num as string, c.env).catch(() => null),
          fetchEbayPrice(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null),
        ]).then(async ([be, blp, u, e]) => {
          if (!be || be.current_value_new === null) return;
          const defaultYr = activeSet.retired ? 0.15 : 0.10;
          const yr = (be.rolling_growth_12months != null)
            ? Math.min(0.25, Math.max(0.02, be.rolling_growth_12months / 100))
            : defaultYr;
          const forecast_2y = be.forecast_value_new_2_years ?? Math.round(be.current_value_new * Math.pow(1 + yr, 2) * 100) / 100;
          const forecast_5y = Math.round(be.current_value_new * Math.pow(1 + yr, 5) * 100) / 100;

          let ebayVal = e;
          if (ebayVal === null && geminiKey) {
            const gemVal = await callGeminiValuation(activeSet.set_num as string, activeSet.name as string, geminiKey).catch(() => null);
            if (gemVal?.ebay_value) ebayVal = gemVal.ebay_value;
          }

          const supplementStmts: D1PreparedStatement[] = [
            c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, used_value=COALESCE(?, ?, used_value),
                ebay_value=COALESCE(?, ebay_value),
                bl_new_value=COALESCE(?, bl_new_value),
                bl_new_qty=COALESCE(?, bl_new_qty),
                bl_used_qty=COALESCE(?, bl_used_qty),
                retail_price=COALESCE(?, retail_price),
                forecast_2y=?, forecast_5y=?,
                valuation_method='brickeconomy',
                valuation_expires_at=datetime('now', '+1 day'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(
              be.current_value_new,
              u?.used_value ?? null, be.current_value_used,
              ebayVal,
              blp?.current_value ?? null,
              blp?.lot_count ?? null,
              u?.lot_count ?? null,
              be.retail_price_us,
              forecast_2y, forecast_5y,
              activeSet.set_num
            )
          ];
          await c.env.DB.batch(supplementStmts);
        }).catch(err => console.error('[bg-brickeconomy-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      } else if (c.env.BRICKLINK_CONSUMER_KEY) {
        const refreshPromise = Promise.all([
          fetchSetPricing(activeSet.set_num as string, c.env),
          fetchUsedPricing(activeSet.set_num as string, c.env),
          fetchEbayPrice(activeSet.set_num as string, activeSet.name as string, c.env)
        ]).then(async ([p, u, e]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          if (u) {
            supplementStmts.push(c.env.DB.prepare('UPDATE lego_sets SET used_value=?, bl_used_qty=? WHERE set_num=?').bind(u.used_value, u.lot_count, activeSet.set_num));
          }
          if (e !== null && e !== undefined) {
            supplementStmts.push(c.env.DB.prepare("UPDATE lego_sets SET ebay_value=?, ebay_cached_at=datetime('now') WHERE set_num=?").bind(e, activeSet.set_num));
          }
          if (p) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(p.current_value * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(p.current_value * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, bl_new_value=?, bl_new_qty=?,
                forecast_2y=?, forecast_5y=?,
                valuation_method='market',
                valuation_expires_at=datetime('now', '+1 day'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(p.current_value, p.current_value, p.lot_count, forecast_2y, forecast_5y, activeSet.set_num));
          }
          if (supplementStmts.length) {
            await c.env.DB.batch(supplementStmts);
          }
        }).catch(err => console.error('[bg-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      } else if (geminiKey) {
        const refreshPromise = Promise.all([
          callGeminiValuation(activeSet.set_num as string, activeSet.name as string, geminiKey).catch(() => null),
          fetchEbayPrice(activeSet.set_num as string, activeSet.name as string, c.env).catch(() => null)
        ]).then(async ([gemVal, ebayVal]) => {
          const supplementStmts: D1PreparedStatement[] = [];
          if (gemVal) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(gemVal.current_value * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(gemVal.current_value * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, used_value=?, ebay_value=COALESCE(?, ebay_value), forecast_2y=?, forecast_5y=?,
                valuation_method='ai',
                valuation_expires_at=datetime('now', '+1 day'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(gemVal.current_value, gemVal.used_value, gemVal.ebay_value || null, forecast_2y, forecast_5y, activeSet.set_num));
          } else if (ebayVal !== null) {
            const yr = activeSet.retired ? 0.15 : 0.10;
            const forecast_2y = Math.round(ebayVal * Math.pow(1 + yr, 2) * 100) / 100;
            const forecast_5y = Math.round(ebayVal * Math.pow(1 + yr, 5) * 100) / 100;
            supplementStmts.push(c.env.DB.prepare(`
              UPDATE lego_sets SET
                current_value=?, forecast_2y=?, forecast_5y=?,
                valuation_method='ebay_rss',
                valuation_expires_at=datetime('now', '+1 day'),
                cached_at=datetime('now')
              WHERE set_num=?
            `).bind(ebayVal, forecast_2y, forecast_5y, activeSet.set_num));
          }
          if (ebayVal !== null) {
            supplementStmts.push(c.env.DB.prepare("UPDATE lego_sets SET ebay_value=?, ebay_cached_at=datetime('now') WHERE set_num=?").bind(ebayVal, activeSet.set_num));
          }
          if (supplementStmts.length) {
            await c.env.DB.batch(supplementStmts);
          }
        }).catch(err => console.error('[bg-gemini-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      } else {
        const refreshPromise = fetchEbayPrice(activeSet.set_num as string, activeSet.name as string, c.env).then(async (ebayVal) => {
          const yr = activeSet.retired ? 0.15 : 0.10;
          const hasVal = (ebayVal !== null && ebayVal !== undefined);
          const forecast_2y = hasVal ? Math.round(ebayVal * Math.pow(1 + yr, 2) * 100) / 100 : null;
          const forecast_5y = hasVal ? Math.round(ebayVal * Math.pow(1 + yr, 5) * 100) / 100 : null;
          await c.env.DB.prepare(`
            UPDATE lego_sets SET
              current_value = COALESCE(?, current_value),
              ebay_value = ?,
              forecast_2y = COALESCE(?, forecast_2y),
              forecast_5y = COALESCE(?, forecast_5y),
              valuation_method = 'ebay_rss',
              ebay_cached_at = datetime('now'),
              valuation_expires_at = datetime('now', '+1 day'),
              cached_at = datetime('now')
            WHERE set_num=?
          `).bind(ebayVal, ebayVal, forecast_2y, forecast_5y, activeSet.set_num).run();
        }).catch(err => console.error('[bg-ebay-rss-reval] failed:', err));

        c.executionCtx.waitUntil(refreshPromise);
      }
    }

    const brickset = await fetchBricksetDetails(resultSet.set_num as string, c.env).catch(() => null);
    if (brickset) {
      const bsUpdates: D1PreparedStatement[] = [];
      if (brickset.minifigs !== null && brickset.minifigs > 0 && !resultSet.minifigs) {
        bsUpdates.push(c.env.DB.prepare('UPDATE lego_sets SET minifigs=? WHERE set_num=?').bind(brickset.minifigs, resultSet.set_num));
        resultSet.minifigs = brickset.minifigs;
      }
      if (brickset.retired === true && !resultSet.retired) {
        bsUpdates.push(c.env.DB.prepare('UPDATE lego_sets SET retired=1 WHERE set_num=?').bind(resultSet.set_num));
        resultSet.retired = 1;
      }
      if (brickset.usRetailPrice && !resultSet.retail_price) {
        bsUpdates.push(c.env.DB.prepare('UPDATE lego_sets SET retail_price=? WHERE set_num=?').bind(brickset.usRetailPrice, resultSet.set_num));
        resultSet.retail_price = brickset.usRetailPrice;
      }
      if (bsUpdates.length) await c.env.DB.batch(bsUpdates);
    }
    return c.json({ set: { ...resultSet, retired: !!resultSet.retired, trend, brickset }, entry: entry || null });
  }

  if (!c.env.REBRICKABLE_API_KEY) return c.json({ error: 'Set not found' }, 404);

  try {
    const url = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(setnum)}/`;
    const rb = await fetch(url, { headers: { 'Authorization': `key ${c.env.REBRICKABLE_API_KEY}` } });
    if (!rb.ok) return c.json({ error: 'Set not found' }, 404);
    const s = await rb.json() as { set_num: string; name: string; year: number; num_parts: number; num_minifigs: number; set_img_url: string };
    const vals = formulaValuation({ pieces: s.num_parts, year: s.year, retired: false, minifigs: s.num_minifigs || 0 });
    const row = {
      set_num: s.set_num, name: s.name, year: s.year, theme: null,
      pieces: s.num_parts, minifigs: s.num_minifigs || 0, image_url: s.set_img_url,
      ...vals, valuation_method: 'formula_bulk', retired: false,
    };
    await c.env.DB.prepare(`
      INSERT INTO lego_sets (set_num,name,year,pieces,minifigs,image_url,retail_price,current_value,forecast_2y,forecast_5y,valuation_method,cached_at,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,'formula_bulk',datetime('now'),'rebrickable')
      ON CONFLICT (set_num) DO UPDATE SET cached_at=datetime('now')
    `).bind(row.set_num, row.name, row.year, row.pieces, row.minifigs, row.image_url,
            row.retail_price, row.current_value, row.forecast_2y, row.forecast_5y).run();
    const brickset = await fetchBricksetDetails(row.set_num, c.env).catch(() => null);
    if (brickset && brickset.minifigs !== null && brickset.minifigs > 0) {
      await c.env.DB.prepare('UPDATE lego_sets SET minifigs=? WHERE set_num=?')
        .bind(brickset.minifigs, row.set_num)
        .run();
      row.minifigs = brickset.minifigs;
    }
    return c.json({ set: { ...row, brickset }, entry: null });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

// GET /api/sets/:setnum/history
app.get('/:setnum/history', async (c) => {
  const setNum = c.req.param('setnum');
  const days = Math.min(parseInt(c.req.query('days') || '90', 10), 365);
  const { results } = await c.env.DB.prepare(`
    SELECT snapshot_date, current_value
    FROM set_value_history
    WHERE set_num = ? AND snapshot_date >= DATE('now', ?)
    ORDER BY snapshot_date ASC
  `).bind(setNum, `-${days} days`).all();
  return c.json({ history: results, days });
});

// POST /api/sets/:setnum/listing-draft — generate eBay listing copy via AI
app.post('/:setnum/listing-draft', async (c) => {
  const userId = c.get('userId');
  const setNum = c.req.param('setnum');

  const [set, entry] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setNum).first<Record<string, unknown>>(),
    c.env.DB.prepare(
      'SELECT condition, purchase_price, notes, is_complete, missing_pieces FROM user_collection WHERE user_id=? AND set_num=? AND deleted_at IS NULL'
    ).bind(userId, setNum).first<Record<string, unknown>>(),
  ]);
  if (!set) return c.json({ error: 'Set not found' }, 404);

  const condition = (entry?.condition as string) || 'used_good';
  const conditionLabel: Record<string, string> = {
    sealed: 'Factory Sealed', new: 'New / Open Box',
    used_good: 'Used - Good', used_acceptable: 'Used - Acceptable',
  };
  const blPrice = set.current_value ? `$${Number(set.current_value).toFixed(0)}` : 'unknown';
  const ebayPrice = set.ebay_value ? `$${Number(set.ebay_value).toFixed(0)}` : null;

  const sourceName = set.valuation_method === 'market' ? 'BrickLink'
    : set.valuation_method === 'brickeconomy' ? 'BrickEconomy'
    : set.valuation_method === 'ai' ? 'AI estimate'
    : set.valuation_method === 'ebay_rss' ? 'eBay Sold' : 'Estimated';

  const prompt = `Generate an eBay listing for this LEGO set. Return JSON only with keys: title, description, suggested_price (number), price_reasoning (string).

Set: ${set.name}
Set number: ${set.set_num}
Theme: ${set.theme || 'LEGO'}
Year: ${set.year}
Pieces: ${set.pieces}
Minifigs: ${set.minifigs || 0}
Condition: ${conditionLabel[condition] || condition}
Is complete: ${entry?.is_complete !== 0 ? 'Yes' : `No (${entry?.missing_pieces || '?'} pieces missing)`}
${sourceName} market price (new): ${blPrice}${ebayPrice ? `\neBay recent sales: ${ebayPrice}` : ''}
Notes from owner: ${entry?.notes || 'none'}

Title: max 80 characters, include set number and name.
Description: 3-5 sentences covering set highlights, condition, and what's included.
suggested_price: a specific dollar amount number (no $ sign).
price_reasoning: one sentence explaining the price.`;

  const geminiKey = c.req.header('X-Gemini-Key');
  let draft: ListingDraft;

  try {
    if (geminiKey) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 400, responseMimeType: 'application/json' },
          }),
        }
      );
      if (!resp.ok) throw new Error('Gemini request failed');
      const body = await resp.json() as Record<string, unknown>;
      const text = (body['candidates'] as { content: { parts: { text: string }[] } }[])?.[0]?.content?.parts?.[0]?.text ?? '{}';
      draft = JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as ListingDraft;
    } else {
      const openai = new OpenAI({ apiKey: c.env.OPENAI_API_KEY });
      const result = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are an expert eBay seller specializing in LEGO. Return JSON only.' },
          { role: 'user', content: prompt },
        ],
      });
      draft = JSON.parse(result.choices[0].message.content!.trim()) as ListingDraft;
    }
  } catch (e) {
    console.warn('[listing-draft] AI failed:', (e as Error).message);
    return c.json({ error: 'Could not generate listing' }, 500);
  }

  return c.json(draft);
});

// POST /api/sets/:setnum/revalue
app.post('/:setnum/revalue', async (c) => {
  const userId = c.get('userId');
  const setnum = c.req.param('setnum');

  // Rate limiting (5 per hour)
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const ws = windowStart.toISOString();

  await c.env.DB.prepare(`
    INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
    VALUES (?, 'revalue', ?, 1)
    ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
  `).bind(userId, ws).run();

  const rl = await c.env.DB.prepare(
    'SELECT hit_count FROM rate_limits WHERE user_id=? AND endpoint=? AND window_start=?'
  ).bind(userId, 'revalue', ws).first<{ hit_count: number }>();

  if (rl && rl.hit_count > 5) {
    return c.json({ error: 'Rate limit: 5 revaluations per hour.' }, 429);
  }

  let set = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setnum).first<Record<string, unknown>>();
  if (!set) {
    set = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(setnum + '-1').first<Record<string, unknown>>();
  }
  if (!set) {
    return c.json({ error: 'Set not found' }, 404);
  }

  let pricing: { current_value: number } | null = null;
  let blPricing: { current_value: number; lot_count?: number } | null = null;
  let usedPricing: { used_value: number; lot_count?: number } | null = null;
  let ebayPrice: number | null = null;
  let valMethod = 'market';

  const geminiKey = c.req.header('X-Gemini-Key');

  let beDetails: Awaited<ReturnType<typeof fetchBrickEconomyDetails>> = null;

  if (c.env.BRICKECONOMY_API_KEY) {
    // Run all market sources in parallel — BrickEconomy is primary but BL is
    // fetched alongside it to populate bl_new_value for the price strip.
    const [be, blp, u, e] = await Promise.all([
      fetchBrickEconomyDetails(set.set_num as string, c.env).catch(() => null),
      fetchSetPricing(set.set_num as string, c.env).catch(() => null),
      fetchUsedPricing(set.set_num as string, c.env).catch(() => null),
      fetchEbayPrice(set.set_num as string, set.name as string, c.env).catch(() => null),
    ]);
    beDetails = be;
    blPricing = blp;
    usedPricing = u || (be?.current_value_used ? { used_value: be.current_value_used } : null);
    ebayPrice = e;

    if (ebayPrice === null && geminiKey) {
      const gemVal = await callGeminiValuation(set.set_num as string, set.name as string, geminiKey).catch(() => null);
      if (gemVal?.ebay_value) ebayPrice = gemVal.ebay_value;
    }

    if (beDetails?.current_value_new != null) {
      pricing = { current_value: beDetails.current_value_new };
      valMethod = 'brickeconomy';
    }
  }

  if (!pricing) {
    if (c.env.BRICKLINK_CONSUMER_KEY) {
      const [p, u, e] = await Promise.all([
        blPricing ? Promise.resolve(blPricing) : fetchSetPricing(set.set_num as string, c.env).catch(() => null),
        usedPricing ? Promise.resolve(usedPricing) : fetchUsedPricing(set.set_num as string, c.env).catch(() => null),
        ebayPrice !== null ? Promise.resolve(ebayPrice) : fetchEbayPrice(set.set_num as string, set.name as string, c.env).catch(() => null),
      ]);
      blPricing = p as typeof blPricing;
      usedPricing = u as typeof usedPricing;
      ebayPrice = e as typeof ebayPrice;
      pricing = blPricing;
      valMethod = 'market';
    } else {
      if (geminiKey) {
        const gemVal = await callGeminiValuation(set.set_num as string, set.name as string, geminiKey);
        if (gemVal) {
          pricing = { current_value: gemVal.current_value };
          usedPricing = { used_value: gemVal.used_value };
          valMethod = 'ai';
          ebayPrice = gemVal.ebay_value || null;

          if (pricing && set.retail_price) {
            const pieceCount = Number(set.pieces ?? 0);
            const maxCapMultiplier = pieceCount > 500 ? 8 : 15;
            if (pricing.current_value < 0.3 * Number(set.retail_price) || pricing.current_value > maxCapMultiplier * Number(set.retail_price)) {
              pricing.current_value = Number(set.retail_price);
            }
          }
        }
      }
      if (ebayPrice === null) {
        ebayPrice = await fetchEbayPrice(set.set_num as string, set.name as string, c.env).catch(() => null);
      }
    }
  }

  if (!pricing && ebayPrice !== null) {
    pricing = { current_value: ebayPrice };
    valMethod = 'ebay_rss';
  }

  const supplementStmts: D1PreparedStatement[] = [];
  if (usedPricing) {
    supplementStmts.push(
      c.env.DB.prepare('UPDATE lego_sets SET used_value=? WHERE set_num=?')
        .bind(usedPricing.used_value, set.set_num)
    );
  }
  if (ebayPrice !== null && ebayPrice !== undefined) {
    supplementStmts.push(
      c.env.DB.prepare("UPDATE lego_sets SET ebay_value=?, ebay_cached_at=datetime('now') WHERE set_num=?")
        .bind(ebayPrice, set.set_num)
    );
  }
  if (blPricing) {
    supplementStmts.push(
      c.env.DB.prepare('UPDATE lego_sets SET bl_new_value=?, bl_new_qty=? WHERE set_num=?')
        .bind(blPricing.current_value, blPricing.lot_count, set.set_num)
    );
  }
  if (usedPricing?.lot_count) {
    supplementStmts.push(
      c.env.DB.prepare('UPDATE lego_sets SET bl_used_qty=? WHERE set_num=?')
        .bind(usedPricing.lot_count, set.set_num)
    );
  }
  if (pricing) {
    // Use rolling 12-month growth from BrickEconomy when available for dynamic forecasts.
    const defaultYr = set.retired ? 0.15 : 0.10;
    const yr = (beDetails?.rolling_growth_12months != null)
      ? Math.min(0.25, Math.max(0.02, (beDetails.rolling_growth_12months as number) / 100))
      : defaultYr;

    let forecast_2y = Math.round(pricing.current_value * Math.pow(1 + yr, 2) * 100) / 100;
    let forecast_5y = Math.round(pricing.current_value * Math.pow(1 + yr, 5) * 100) / 100;
    let retailPrice: number | null = null;

    if (valMethod === 'brickeconomy' && beDetails) {
      if (beDetails.forecast_value_new_2_years !== null) {
        forecast_2y = beDetails.forecast_value_new_2_years;
      }
      if (beDetails.retail_price_us !== null) {
        retailPrice = beDetails.retail_price_us;
      }
    }

    supplementStmts.push(
      c.env.DB.prepare(`
        UPDATE lego_sets SET
          current_value=?, forecast_2y=?, forecast_5y=?,
          retail_price=COALESCE(?, retail_price),
          valuation_method=?,
          valuation_expires_at=datetime('now', '+7 days'),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(pricing.current_value, forecast_2y, forecast_5y, retailPrice, valMethod, set.set_num)
    );
  }

  if (supplementStmts.length) {
    await c.env.DB.batch(supplementStmts);
  }

  const updatedSet = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(set.set_num).first<Record<string, unknown>>();
  const trend = updatedSet ? await getCachedPriceTrend(updatedSet.set_num as string, c.env) : null;
  return c.json({ set: updatedSet ? { ...updatedSet, retired: !!updatedSet.retired, trend } : null });
});

export { app as setsRoute };
