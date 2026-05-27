import { db } from 'hatchable';

export const access = 'member';
export const methods = ['GET'];

export default async function (req, res) {
  const r = await db.query(`
    SELECT theme, COUNT(*) as cnt
    FROM lego_sets
    WHERE theme IS NOT NULL AND theme != ''
    GROUP BY theme
    ORDER BY cnt DESC
    LIMIT 50
  `);
  return res.json({ themes: r.rows.map(r => r.theme) });
}