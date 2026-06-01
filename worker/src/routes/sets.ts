import { Hono } from 'hono';
import OpenAI from 'openai';
import { requireMember } from '../auth';
import { formulaValuation } from '../lib/valuation';
import { fetchSetPricing } from '../lib/bricklink';
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

  if (q) {
    where.push(`(LOWER(name) LIKE LOWER(?) OR LOWER(set_num) LIKE LOWER(?))`);
    params.push(`%${q}%`, `%${q}%`);
  }
  if (theme) { where.push(`theme = ?`); params.push(theme); }
  if (retired === '1' || retired === 'true') where.push(`retired = 1`);

  const rangeFilter = (key: string, col: string) => {
    const v = parseInt(c.req.query(key) || '', 10);
    if (!isNaN(v)) {
      const op = key.startsWith('min_') ? '>=' : '<=';
      where.push(`${col} ${op} ?`);
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
      `SELECT * FROM lego_sets ${whereSQL} ORDER BY ${orderBy}, set_num LIMIT ? OFFSET ?`
    ).bind(...params, lim, offset).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT CAST(COUNT(*) AS INTEGER) AS total FROM lego_sets ${whereSQL}`
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
          const vals = formulaValuation({ pieces: s.num_parts, year: s.year, theme: null, retired: false });
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
    const entry = userId
      ? await c.env.DB.prepare('SELECT * FROM user_collection WHERE user_id=? AND set_num=? AND deleted_at IS NULL').bind(userId, set.set_num).first()
      : null;

    // Non-blocking BrickLink refresh when price is missing or stale
    const needsRefresh = set.valuation_method !== 'market'
      || !set.valuation_expires_at
      || new Date(set.valuation_expires_at as string) < new Date();
    if (needsRefresh && c.env.BRICKLINK_CONSUMER_KEY) {
      c.executionCtx.waitUntil(
        fetchSetPricing(set.set_num as string, c.env).then(p => {
          if (!p) return;
          const retired = !!set.retired;
          const yr = retired ? 0.15 : 0.10;
          const forecast_2y = Math.round(p.current_value * Math.pow(1 + yr, 2) * 100) / 100;
          const forecast_5y = Math.round(p.current_value * Math.pow(1 + yr, 5) * 100) / 100;
          return c.env.DB.prepare(`
            UPDATE lego_sets SET
              current_value=?, forecast_2y=?, forecast_5y=?,
              valuation_method='market',
              valuation_expires_at=datetime('now', '+7 days')
            WHERE set_num=?
          `).bind(p.current_value, forecast_2y, forecast_5y, set.set_num).run();
        }).catch(() => {})
      );
    }

    return c.json({ set: { ...set, retired: !!set.retired }, entry: entry || null });
  }

  if (!c.env.REBRICKABLE_API_KEY) return c.json({ error: 'Set not found' }, 404);

  try {
    const url = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(setnum)}/`;
    const rb = await fetch(url, { headers: { 'Authorization': `key ${c.env.REBRICKABLE_API_KEY}` } });
    if (!rb.ok) return c.json({ error: 'Set not found' }, 404);
    const s = await rb.json() as { set_num: string; name: string; year: number; num_parts: number; num_minifigs: number; set_img_url: string };
    const vals = formulaValuation({ pieces: s.num_parts, year: s.year, retired: false });
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
    return c.json({ set: row, entry: null });
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

  const prompt = `Generate an eBay listing for this LEGO set. Return JSON only with keys: title, description, suggested_price (number), price_reasoning (string).

Set: ${set.name}
Set number: ${set.set_num}
Theme: ${set.theme || 'LEGO'}
Year: ${set.year}
Pieces: ${set.pieces}
Minifigs: ${set.minifigs || 0}
Condition: ${conditionLabel[condition] || condition}
Is complete: ${entry?.is_complete !== 0 ? 'Yes' : `No (${entry?.missing_pieces || '?'} pieces missing)`}
BrickLink market price (new): ${blPrice}${ebayPrice ? `\neBay recent sales: ${ebayPrice}` : ''}
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

export { app as setsRoute };
