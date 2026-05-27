import { db } from 'hatchable';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const { series } = req.query;
  const params = [];
  let sql = `SELECT m.*, COALESCE(um.quantity, 0) as owned_qty
    FROM minifigs m
    LEFT JOIN user_minifigs um ON um.fig_num = m.fig_num AND um.user_id = $1
    WHERE 1=1`;
  params.push(req.member.id);
  if (series) { sql += ` AND m.series = $2`; params.push(series); }
  sql += ` ORDER BY m.rarity DESC, m.name`;
  const r = await db.query(sql, params);
  return res.json({ minifigs: r.rows });
}