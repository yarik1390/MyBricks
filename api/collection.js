import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['GET', 'POST'];

export default async function (req, res) {
  const userId = getCallerId(req);

  if (req.method === 'GET') {
    const result = await db.query(`
      SELECT
        uc.id, uc.set_num, uc.quantity, uc.condition, uc.purchase_price,
        uc.notes, uc.added_at, uc.purchased_at, uc.last_modified,
        s.name, s.theme, s.year, s.pieces, s.minifigs,
        s.retail_price, s.current_value, s.forecast_2y, s.forecast_5y,
        s.image_url, s.retired
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      WHERE uc.user_id = $1 AND uc.deleted_at IS NULL
      ORDER BY uc.added_at DESC
    `, [userId]);

    const items = result.rows.map(row => {
      let annualizedRoi = null;
      if (row.purchased_at && row.purchase_price > 0 && row.current_value > 0) {
        const years = (Date.now() - new Date(row.purchased_at).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (years >= 0.08) {
          annualizedRoi = Math.pow(row.current_value / row.purchase_price, 1 / years) - 1;
        }
      }
      return { ...row, annualized_roi: annualizedRoi };
    });

    const totalValue = items.reduce((s, r) => s + (Number(r.current_value) || 0) * r.quantity, 0);
    const totalPaid  = items.reduce((s, r) => s + (Number(r.purchase_price) || 0) * r.quantity, 0);
    const minifigCount = items.reduce((s, r) => s + (Number(r.minifigs) || 0) * r.quantity, 0);

    const count = items.length;
    const lastModified = items[0]?.last_modified || items[0]?.added_at || null;
    const etag = `${count}-${lastModified ? new Date(lastModified).getTime() : 0}`;

    if (req.headers['if-none-match'] === etag) return res.status(304).send('');
    res.setHeader('ETag', etag);
    return res.json({ items, total_value: totalValue, total_paid: totalPaid, count, minifig_count: minifigCount });
  }

  // POST — add/upsert
  const { set_num, quantity = 1, condition = 'new', purchase_price, notes, purchased_at } = req.body;
  if (!set_num) return res.status(400).json({ error: 'set_num required' });
  const validConditions = ['new', 'used_good', 'used_acceptable', 'sealed'];
  if (!validConditions.includes(condition)) return res.status(400).json({ error: 'Invalid condition' });

  const existing = await db.query(
    'SELECT 1 FROM lego_sets WHERE set_num = $1', [set_num]
  );
  if (!existing.rows.length) return res.status(404).json({ error: 'Set not found in catalog' });

  const r = await db.query(`
    INSERT INTO user_collection (user_id, set_num, quantity, condition, purchase_price, notes, purchased_at, last_modified)
    VALUES ($1, $2, $3, $4, $5, $6, $7, now())
    ON CONFLICT (user_id, set_num) DO UPDATE SET
      quantity = EXCLUDED.quantity,
      condition = EXCLUDED.condition,
      purchase_price = COALESCE(EXCLUDED.purchase_price, user_collection.purchase_price),
      notes = COALESCE(EXCLUDED.notes, user_collection.notes),
      purchased_at = COALESCE(EXCLUDED.purchased_at, user_collection.purchased_at),
      last_modified = now(),
      deleted_at = NULL
    RETURNING *
  `, [userId, set_num, quantity, condition, purchase_price || null, notes || null, purchased_at || null]);

  return res.status(201).json({ item: r.rows[0] });
}