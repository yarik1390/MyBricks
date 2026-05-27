import { db, ai } from 'hatchable';
import { getCallerId } from 'lib/caller.js';

export const access = 'member';
export const methods = ['POST'];

export default async function (req, res) {
  const userId = getCallerId(req);
  const { mode, image, barcode } = req.body;

  if (mode === 'barcode') {
    if (!barcode) return res.status(400).json({ error: 'barcode required' });
    const r = await db.query('SELECT * FROM lego_sets WHERE upc = $1', [barcode]);
    if (!r.rows.length) {
      return res.json({ identified: false, reasoning: 'Barcode not in catalog. Try a photo scan instead.' });
    }
    return res.json({ identified: true, set: r.rows[0], confidence: 'high', reasoning: 'Barcode matched in catalog.' });
  }

  if (mode !== 'image') return res.status(400).json({ error: 'mode must be image or barcode' });
  if (!image) return res.status(400).json({ error: 'image required' });

  // Rate limit 20/hour per user
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  await db.query(`
    INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
    VALUES ($1, 'scan_image', $2, 1)
    ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
  `, [userId, windowStart.toISOString()]);
  const rl = await db.query(
    'SELECT hit_count FROM rate_limits WHERE user_id=$1 AND endpoint=$2 AND window_start=$3',
    [userId, 'scan_image', windowStart.toISOString()]
  );
  if ((rl.rows[0]?.hit_count || 0) > 20) {
    return res.status(429).json({ error: 'Rate limit: 20 photo scans per hour.' });
  }

  const result = await ai.generateText({
    purpose: 'lego-identify',
    model: 'gpt',
    userId,
    messages: [
      { role: 'system', content: 'You are a LEGO product-identification expert. Return JSON only: { "set_num": "...", "name": "...", "confidence": "high|medium|low|none", "reasoning": "..." }' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: 'Identify this LEGO set.' }] },
    ],
    maxTokens: 256,
  });

  let identified;
  try {
    identified = JSON.parse(result.text.replace(/```json?\n?|```/g, '').trim());
  } catch {
    return res.json({ identified: false, reasoning: 'Could not parse AI response.' });
  }

  if (identified.confidence === 'none' || !identified.set_num) {
    return res.json({ identified: false, confidence: 'none', reasoning: identified.reasoning });
  }

  let set = null;
  for (const sn of [identified.set_num, identified.set_num + '-1']) {
    const r = await db.query('SELECT * FROM lego_sets WHERE set_num = $1', [sn]);
    if (r.rows.length) { set = r.rows[0]; break; }
  }

  return res.json({ identified: !!set, set, confidence: identified.confidence, reasoning: identified.reasoning });
}