import { Hono } from 'hono';
import OpenAI from 'openai';
import { requireMember } from '../auth';
import { callGeminiScan } from '../lib/gemini';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireMember);

app.post('/identify', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ mode?: string; image?: string; barcode?: string }>();
  const { mode, image, barcode } = body;

  if (mode === 'barcode') {
    if (!barcode) return c.json({ error: 'barcode required' }, 400);
    // Try the scanned value; also try EAN↔UPC conversion (EAN-13 starting with 0 == UPC-A without the leading 0).
    const candidates = [barcode];
    if (barcode.length === 13 && barcode.startsWith('0')) candidates.push(barcode.slice(1));
    else if (barcode.length === 12) candidates.push('0' + barcode);
    let r = null;
    for (const bc of candidates) {
      r = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE upc=?').bind(bc).first();
      if (r) break;
    }
    if (!r) return c.json({ identified: false, reasoning: 'Barcode not in catalog. Try a photo scan instead.' });
    return c.json({ identified: true, set: r, confidence: 'high', reasoning: 'Barcode matched in catalog.' });
  }

  if (mode !== 'image') return c.json({ error: 'mode must be image or barcode' }, 400);
  if (!image) return c.json({ error: 'image required' }, 400);

  // Gemini path: user's Google OAuth token — uses their own quota, no rate limit here.
  const googleToken = c.req.header('X-Google-Token');
  if (googleToken) {
    const identified = await callGeminiScan(image, googleToken);
    if (!identified) return c.json({ identified: false, reasoning: 'Gemini could not process the image.' });
    if (identified.confidence === 'none' || !identified.set_num) {
      return c.json({ identified: false, confidence: 'none', reasoning: identified.reasoning });
    }
    let set = null;
    for (const sn of [identified.set_num, identified.set_num + '-1']) {
      const r = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(sn).first<Record<string, unknown>>();
      if (r) { set = { ...r, retired: !!r.retired }; break; }
    }
    return c.json({ identified: !!set, set, confidence: identified.confidence, reasoning: identified.reasoning, model: 'gemini-1.5-flash' });
  }

  // OpenAI path — rate-limited per user: 20 scans/hour.
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const ws = windowStart.toISOString();

  await c.env.DB.prepare(`
    INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
    VALUES (?, 'scan_image', ?, 1)
    ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
  `).bind(userId, ws).run();

  const rl = await c.env.DB.prepare(
    'SELECT hit_count FROM rate_limits WHERE user_id=? AND endpoint=? AND window_start=?'
  ).bind(userId, 'scan_image', ws).first<{ hit_count: number }>();

  if ((rl?.hit_count || 0) >= 20) {
    return c.json({ error: 'Rate limit: 20 photo scans per hour. Sign in with Google to unlock unlimited scanning.' }, 429);
  }

  // Allow caller to supply their own OpenAI key (BYOK) to bypass the shared limit.
  const openaiKey = c.req.header('X-OpenAI-Key') || c.env.OPENAI_API_KEY;
  const openai = new OpenAI({ apiKey: openaiKey });

  let identified: { set_num?: string; name?: string; confidence?: string; reasoning?: string };
  try {
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 256,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a LEGO product-identification expert. Return JSON only: { "set_num": "...", "name": "...", "confidence": "high|medium|low|none", "reasoning": "..." }' },
        { role: 'user', content: [
          { type: 'image_url', image_url: { url: image } },
          { type: 'text', text: 'Identify this LEGO set.' },
        ]},
      ],
    });
    identified = JSON.parse(result.choices[0].message.content!.trim());
  } catch (e) {
    console.warn('[scan] AI parse failed:', (e as Error).message);
    return c.json({ identified: false, reasoning: 'Could not parse AI response.' });
  }

  if (identified.confidence === 'none' || !identified.set_num) {
    return c.json({ identified: false, confidence: 'none', reasoning: identified.reasoning });
  }

  let set = null;
  for (const sn of [identified.set_num, identified.set_num + '-1']) {
    const r = await c.env.DB.prepare('SELECT * FROM lego_sets WHERE set_num=?').bind(sn).first<Record<string, unknown>>();
    if (r) { set = { ...r, retired: !!r.retired }; break; }
  }

  return c.json({ identified: !!set, set, confidence: identified.confidence, reasoning: identified.reasoning, model: 'gpt-4o-mini' });
});

export { app as scanRoute };
