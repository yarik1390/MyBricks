import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  const userId = getCallerId(req);
  const { rows, overwrite = false } = req.body;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required' });
  }
  if (rows.length > 500) {
    return res.status(400).json({ error: 'max 500 rows per import' });
  }

  let imported = 0, skipped = 0;
  const errors = [];

  for (const row of rows) {
    const set_num = String(row.set_num || '').trim();
    if (!set_num) { errors.push({ row, reason: 'missing set_num' }); continue; }

    const catalog = await db.query('SELECT 1 FROM lego_sets WHERE set_num = $1', [set_num]);
    if (!catalog.rows.length) {
      errors.push({ set_num, reason: 'set not in catalog' });
      skipped++;
      continue;
    }

    if (!overwrite) {
      const owned = await db.query(
        'SELECT id FROM user_collection WHERE user_id=$1 AND set_num=$2 AND deleted_at IS NULL',
        [userId, set_num]
      );
      if (owned.rows.length) { skipped++; continue; }
    }

    const validConds = ['new', 'used_good', 'used_acceptable', 'sealed'];
    const condition = validConds.includes(row.condition) ? row.condition : 'new';
    const quantity = Math.max(1, parseInt(row.quantity) || 1);
    const purchase_price = parseFloat(row.purchase_price) || null;
    const purchased_at = row.purchased_at ? new Date(row.purchased_at) : null;
    const notes = row.notes || null;
    const storage_location = row.storage_location || null;
    const acquisition_source = row.acquisition_source || null;
    const is_complete = row.is_complete === 'false' || row.is_complete === false ? false : true;
    const missing_pieces = parseInt(row.missing_pieces) || 0;

    await db.query(`
      INSERT INTO user_collection
        (user_id, set_num, quantity, condition, purchase_price, purchased_at,
         notes, storage_location, acquisition_source, is_complete, missing_pieces, last_modified)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
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
        last_modified = now(),
        deleted_at = NULL
    `, [userId, set_num, quantity, condition, purchase_price, purchased_at,
        notes, storage_location, acquisition_source, is_complete, missing_pieces]);

    imported++;
  }

  return res.json({ imported, skipped, errors: errors.slice(0, 20) });
}
