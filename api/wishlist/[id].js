import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['DELETE', 'POST'];

export default async function (req, res) {
  const userId = getCallerId(req);
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  if (req.method === 'DELETE') {
    await db.query('DELETE FROM user_wishlist WHERE id=$1 AND user_id=$2', [id, userId]);
    return res.status(204).send('');
  }

  // POST — mark alert as read
  await db.query(
    'UPDATE wishlist_alerts SET read_at=now() WHERE id=$1 AND user_id=$2',
    [id, userId]
  );
  return res.json({ ok: true });
}