import { db } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['GET', 'PATCH'];

const ADJECTIVES = ['Cosmic','Neon','Golden','Stellar','Atomic','Crystal','Lunar','Solar','Turbo','Hyper','Electric','Phantom','Vivid','Arctic','Blazing'];
const NOUNS = ['Builder','Architect','Vault','Collector','Master','Ranger','Knight','Scout','Pilot','Explorer','Curator','Engineer','Maker','Wizard','Legend'];

function fnv32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h;
}

function seedName(userId) {
  const h1 = fnv32(userId);
  const h2 = fnv32(userId + '|2');
  return ADJECTIVES[h1 % ADJECTIVES.length] + ' ' + NOUNS[h2 % NOUNS.length];
}

export default async function (req, res) {
  const userId = getCallerId(req);

  if (req.method === 'GET') {
    const [prefs, stats] = await Promise.all([
      db.query('SELECT * FROM user_prefs WHERE user_id=$1', [userId]),
      db.query(`
        SELECT COUNT(*) as set_count,
          COALESCE(SUM(s.current_value * uc.quantity), 0) as total_value,
          COALESCE(SUM(COALESCE(uc.purchase_price,0) * uc.quantity), 0) as total_paid
        FROM user_collection uc
        JOIN lego_sets s ON s.set_num = uc.set_num
        WHERE uc.user_id=$1 AND uc.deleted_at IS NULL
      `, [userId]),
    ]);
    const p = prefs.rows[0] || {};
    return res.json({
      handle: req.member?.handle || null,
      display_name: p.display_name || seedName(userId),
      currency: p.currency || 'USD',
      notify_price_drops: p.notify_price_drops !== false,
      portfolio_stats: {
        set_count: parseInt(stats.rows[0].set_count, 10),
        total_value: parseFloat(stats.rows[0].total_value),
        total_paid: parseFloat(stats.rows[0].total_paid),
      },
    });
  }

  // PATCH
  const { display_name, currency, notify_price_drops } = req.body;
  if (display_name && display_name.length > 40) return res.status(400).json({ error: 'display_name max 40 chars' });
  await db.query(`
    INSERT INTO user_prefs (user_id, display_name, currency, notify_price_drops, updated_at)
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (user_id) DO UPDATE SET
      display_name = COALESCE($2, user_prefs.display_name),
      currency = COALESCE($3, user_prefs.currency),
      notify_price_drops = COALESCE($4, user_prefs.notify_price_drops),
      updated_at = now()
  `, [userId, display_name || null, currency || null, notify_price_drops ?? null]);
  return res.json({ ok: true });
}