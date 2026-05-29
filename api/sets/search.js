import { db } from 'hatchable';
import { formulaValuation } from 'lib/valuation.js';

export const access = 'member';
export const methods = ['GET'];

const SORTS = {
  value_desc: 'current_value DESC NULLS LAST',
  roi_desc:   '(current_value / NULLIF(retail_price, 0)) DESC NULLS LAST',
  year_desc:  'year DESC NULLS LAST',
  az:         'name ASC',
};

export default async function (req, res) {
  const { q = '', theme = '', retired = '', sort = 'value_desc' } = req.query;
  const lim = Math.min(parseInt(req.query.limit, 10) || 24, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const orderBy = SORTS[sort] || SORTS.value_desc;

  // Shared WHERE clause for both count and page queries
  const where = [];
  const params = [];
  let i = 1;
  if (q) {
    where.push(`(name ILIKE $${i} OR set_num ILIKE $${i})`);
    params.push(`%${q}%`); i++;
  }
  if (theme) { where.push(`theme = $${i++}`); params.push(theme); }
  if (retired === '1' || retired === 'true') where.push(`retired = true`);

  // Numeric range filters (advanced filter sheet). Each is optional.
  const rangeFilter = (key, col) => {
    const v = parseInt(req.query[key], 10);
    if (!isNaN(v)) {
      const op = key.startsWith('min_') ? '>=' : '<=';
      where.push(`${col} ${op} $${i++}`);
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
    db.query(
      `SELECT * FROM lego_sets ${whereSQL} ORDER BY ${orderBy}, set_num LIMIT $${i} OFFSET $${i + 1}`,
      [...params, lim, offset]
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM lego_sets ${whereSQL}`, params),
  ]);

  let rows = pageRes.rows;
  let total = countRes.rows[0].total;

  // On the first page of a search, augment with live Rebrickable results
  if (q && offset === 0 && rows.length < lim && process.env.REBRICKABLE_API_KEY) {
    try {
      const url = `https://rebrickable.com/api/v3/lego/sets/?search=${encodeURIComponent(q)}&key=${process.env.REBRICKABLE_API_KEY}&page_size=20`;
      const rb = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (rb.ok) {
        const data = await rb.json();
        const seen = new Set(rows.map(r => r.set_num));
        for (const s of (data.results || [])) {
          if (seen.has(s.set_num)) continue;
          const vals = formulaValuation({ pieces: s.num_parts, year: s.year, theme: s.theme_id, retired: false });
          rows.push({
            set_num: s.set_num, name: s.name, year: s.year, theme: null,
            pieces: s.num_parts, minifigs: s.num_minifigs || 0,
            image_url: s.set_img_url, ...vals,
          });
        }
        rows = rows.slice(0, lim);
        total = Math.max(total, offset + rows.length);
      }
    } catch (_) { /* non-critical */ }
  }

  return res.json({ sets: rows, total, hasMore: offset + rows.length < total });
}
