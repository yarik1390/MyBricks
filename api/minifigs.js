import { db } from 'hatchable';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const { series = '', q = '' } = req.query;
  const lim = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const userId = req.member?.id || req.headers['x-hatchable-user-id'];

  // Page query: $1 = userId, then filters, then limit/offset.
  const pageParams = [userId];
  const pageWhere = [];
  let pi = 2;
  if (series) { pageWhere.push(`m.series = $${pi++}`); pageParams.push(series); }
  if (q) { pageWhere.push(`m.name ILIKE $${pi++}`); pageParams.push(`%${q}%`); }
  const pageWhereSQL = pageWhere.length ? `WHERE ${pageWhere.join(' AND ')}` : '';
  pageParams.push(lim, offset);

  // Count query: filters only, numbered from $1.
  const countParams = [];
  const countWhere = [];
  let ci = 1;
  if (series) { countWhere.push(`m.series = $${ci++}`); countParams.push(series); }
  if (q) { countWhere.push(`m.name ILIKE $${ci++}`); countParams.push(`%${q}%`); }
  const countWhereSQL = countWhere.length ? `WHERE ${countWhere.join(' AND ')}` : '';

  const [pageRes, countRes] = await Promise.all([
    db.query(
      `SELECT m.*, COALESCE(um.quantity, 0) as owned_qty
       FROM minifigs m
       LEFT JOIN user_minifigs um ON um.fig_num = m.fig_num AND um.user_id = $1
       ${pageWhereSQL}
       ORDER BY m.rarity DESC, m.name
       LIMIT $${pi} OFFSET $${pi + 1}`,
      pageParams
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM minifigs m ${countWhereSQL}`, countParams),
  ]);

  const total = countRes.rows[0].total;
  return res.json({
    minifigs: pageRes.rows,
    total,
    hasMore: offset + pageRes.rows.length < total,
  });
}
