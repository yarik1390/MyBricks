import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['PUT', 'DELETE'];

// Persist per-user minifig ownership in user_minifigs (server-side, so it
// syncs across devices instead of living only in browser localStorage).
export default async function (req, res) {
  const userId = getCallerId(req);
  if (!userId) return res.status(401).json({ error: 'Sign in required' });

  const figNum = req.params.fignum;
  if (!figNum) return res.status(400).json({ error: 'fig_num required' });

  // Guard: the fig must exist in the catalog (FK would reject anyway).
  const exists = await db.query('SELECT 1 FROM minifigs WHERE fig_num=$1', [figNum]);
  if (!exists.rows.length) return res.status(404).json({ error: 'Minifig not found' });

  if (req.method === 'DELETE') {
    await db.query('DELETE FROM user_minifigs WHERE user_id=$1 AND fig_num=$2', [userId, figNum]);
    return res.status(204).send('');
  }

  // PUT — mark owned (optionally with quantity)
  const qty = Math.max(1, parseInt(req.body?.quantity, 10) || 1);
  await db.query(`
    INSERT INTO user_minifigs (user_id, fig_num, quantity)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, fig_num) DO UPDATE SET quantity = EXCLUDED.quantity
  `, [userId, figNum, qty]);
  return res.json({ ok: true, fig_num: figNum, quantity: qty });
}
