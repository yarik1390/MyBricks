import { db } from 'hatchable';
import { formulaValuation } from 'lib/valuation.js';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const setnum = req.params.setnum;

  // Try DB — also try with -1 suffix
  let r = await db.query('SELECT * FROM lego_sets WHERE set_num = $1', [setnum]);
  if (!r.rows.length) {
    r = await db.query('SELECT * FROM lego_sets WHERE set_num = $1', [setnum + '-1']);
  }
  if (r.rows.length) return res.json({ set: r.rows[0] });

  // Try Rebrickable
  if (!process.env.REBRICKABLE_API_KEY) return res.status(404).json({ error: 'Set not found' });

  try {
    const url = `https://rebrickable.com/api/v3/lego/sets/${encodeURIComponent(setnum)}/`;
    const rb = await fetch(url, {
      headers: { 'Authorization': `key ${process.env.REBRICKABLE_API_KEY}` }
    });
    if (!rb.ok) return res.status(404).json({ error: 'Set not found' });
    const s = await rb.json();
    const vals = formulaValuation({ pieces: s.num_parts, year: s.year, retired: false });
    const row = {
      set_num: s.set_num, name: s.name, year: s.year, theme: null,
      pieces: s.num_parts, minifigs: s.num_minifigs || 0, image_url: s.set_img_url,
      ...vals, valuation_method: 'formula_bulk',
    };
    // Cache it
    await db.query(`
      INSERT INTO lego_sets (set_num, name, year, pieces, minifigs, image_url, retail_price, current_value, forecast_2y, forecast_5y, valuation_method, cached_at, source)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'formula_bulk',now(),'rebrickable')
      ON CONFLICT (set_num) DO UPDATE SET cached_at=now()
    `, [row.set_num, row.name, row.year, row.pieces, row.minifigs, row.image_url, row.retail_price, row.current_value, row.forecast_2y, row.forecast_5y]);
    return res.json({ set: row });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}