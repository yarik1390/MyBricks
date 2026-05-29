import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['GET'];

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export default async function (req, res) {
  const userId = getCallerId(req);

  const result = await db.query(`
    SELECT
      uc.id, uc.set_num, uc.quantity, uc.condition, uc.purchase_price,
      uc.purchased_at, uc.storage_location, uc.acquisition_source,
      uc.is_complete, uc.missing_pieces, uc.notes, uc.added_at,
      s.name, s.theme, s.year, s.pieces, s.minifigs,
      s.retail_price, s.current_value
    FROM user_collection uc
    JOIN lego_sets s ON s.set_num = uc.set_num
    WHERE uc.user_id = $1 AND uc.deleted_at IS NULL
    ORDER BY uc.added_at DESC
  `, [userId]);

  const headers = [
    'set_num','name','theme','year','pieces','minifigs',
    'condition','quantity','purchase_price','purchased_at',
    'current_value','retail_price','roi_pct',
    'storage_location','acquisition_source',
    'is_complete','missing_pieces','notes','added_at',
  ];

  const rows = result.rows.map(r => {
    const roi = r.purchase_price > 0 && r.current_value > 0
      ? ((r.current_value - r.purchase_price) / r.purchase_price * 100).toFixed(2)
      : '';
    return [
      r.set_num, r.name, r.theme, r.year, r.pieces, r.minifigs,
      r.condition, r.quantity, r.purchase_price ?? '', r.purchased_at ? r.purchased_at.toISOString().slice(0,10) : '',
      r.current_value ?? '', r.retail_price ?? '', roi,
      r.storage_location ?? '', r.acquisition_source ?? '',
      r.is_complete == null ? 'true' : String(r.is_complete), r.missing_pieces ?? 0,
      r.notes ?? '', r.added_at ? r.added_at.toISOString().slice(0,10) : '',
    ].map(csvCell).join(',');
  });

  const csv = [headers.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="brickvault-export.csv"');
  return res.send(csv);
}
