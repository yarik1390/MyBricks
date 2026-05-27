import { db } from 'hatchable';
import { formulaValuation } from 'lib/valuation.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const { q = '', theme = '', limit = '30' } = req.query;
  const lim = Math.min(parseInt(limit, 10) || 30, 100);

  let rows = [];
  const params = [];
  let sql = `SELECT * FROM lego_sets WHERE 1=1`;
  let i = 1;
  if (q) {
    sql += ` AND (name ILIKE $${i} OR set_num ILIKE $${i})`;
    params.push(`%${q}%`); i++;
  }
  if (theme) {
    sql += ` AND theme = $${i++}`;
    params.push(theme);
  }
  sql += ` ORDER BY year DESC NULLS LAST LIMIT $${i}`;
  params.push(lim);

  const local = await db.query(sql, params);
  rows = local.rows;

  // Optionally augment with Rebrickable live results
  if (q && process.env.REBRICKABLE_API_KEY) {
    try {
      const url = `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(q)}&key=${process.env.REBRICKABLE_API_KEY}&page_size=20`;
      const rb = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (rb.ok) {
        const data = await rb.json();
        const localNums = new Set(rows.map(r => r.set_num));
        for (const s of (data.results || [])) {
          if (localNums.has(s.set_num)) continue;
          const vals = formulaValuation({ pieces: s.num_parts, year: s.year, theme: s.theme_id, retired: false });
          rows.push({
            set_num: s.set_num,
            name: s.name,
            year: s.year,
            theme: null,
            pieces: s.num_parts,
            minifigs: s.num_minifigs || 0,
            image_url: s.set_img_url,
            ...vals,
          });
        }
      }
    } catch (_) { /* non-critical */ }
  }

  return res.json({ sets: rows.slice(0, lim) });
}