import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['GET', 'PATCH', 'DELETE'];

export default async function (req, res) {
  const userId = getCallerId(req);
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  const check = await db.query(
    'SELECT id FROM user_collection WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
    [id, userId]
  );
  if (!check.rows.length) return res.status(404).json({ error: 'Not found' });

  if (req.method === 'GET') {
    const r = await db.query(`
      SELECT uc.*, s.name, s.theme, s.year, s.pieces, s.minifigs,
        s.retail_price, s.current_value, s.forecast_2y, s.forecast_5y, s.image_url
      FROM user_collection uc
      JOIN lego_sets s ON s.set_num = uc.set_num
      WHERE uc.id = $1 AND uc.user_id = $2 AND uc.deleted_at IS NULL
    `, [id, userId]);
    return res.json({ item: r.rows[0] });
  }

  if (req.method === 'PATCH') {
    const { quantity, condition, purchase_price, purchased_at, notes } = req.body;
    const fields = [];
    const vals = [];
    let i = 1;
    if (quantity !== undefined)       { fields.push(`quantity=$${i++}`);        vals.push(quantity); }
    if (condition !== undefined)      { fields.push(`condition=$${i++}`);       vals.push(condition); }
    if (purchase_price !== undefined) { fields.push(`purchase_price=$${i++}`); vals.push(purchase_price); }
    if (purchased_at !== undefined)   { fields.push(`purchased_at=$${i++}`);   vals.push(purchased_at); }
    if (notes !== undefined)          { fields.push(`notes=$${i++}`);           vals.push(notes); }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    fields.push(`last_modified=now()`);
    vals.push(id, userId);
    const r = await db.query(
      `UPDATE user_collection SET ${fields.join(',')} WHERE id=$${i++} AND user_id=$${i} RETURNING *`,
      vals
    );
    return res.json({ item: r.rows[0] });
  }

  // DELETE — soft delete
  await db.query(
    'UPDATE user_collection SET deleted_at = now() WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return res.status(204).send('');
}