import { Hono } from 'hono';
import { requireMember } from '../auth';
import type { Env, Variables } from '../types';
import { GRADE_PRICE_SHARE, gradeBox } from '../lib/box-grade';

// Box condition grading (mounted at /api/grade).
//
// POST /api/grade/box { image, set_num }  Pro, or any member with their own
// Gemini/OpenAI key (BYOK, unmetered). Pro on the shared key gets
// BOX_GRADE_DAILY_LIMIT grades a day.
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.use('*', requireMember);

export const BOX_GRADE_DAILY_LIMIT = 10;

app.post('/box', async (c) => {
  const userId = c.get('userId');
  const body = await c.req.json<{ image?: string; set_num?: string }>().catch(() => ({} as { image?: string; set_num?: string }));
  const image = typeof body.image === 'string' ? body.image : '';
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) return c.json({ error: 'A JPEG, PNG or WebP photo is required' }, 400);
  if (image.length > 2_000_000) return c.json({ error: 'Photo too large (max ~1.5 MB)' }, 413);

  const geminiKey = c.req.header('X-Gemini-Key') || null;
  const openaiKey = c.req.header('X-OpenAI-Key') || null;
  if (!geminiKey && !openaiKey) {
    const pref = await c.env.DB.prepare('SELECT is_supporter FROM user_prefs WHERE user_id = ?')
      .bind(userId).first<{ is_supporter: number }>().catch(() => null);
    if (!pref?.is_supporter) return c.json({ error: 'Box grading comes with Pro.', code: 'pro_required' }, 402);
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    const rl = await c.env.DB.prepare(
      `INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count) VALUES (?, 'box_grade', ?, 1)
       ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
       RETURNING hit_count`,
    ).bind(userId, day.toISOString()).first<{ hit_count: number }>();
    if ((rl?.hit_count ?? 0) > BOX_GRADE_DAILY_LIMIT) {
      return c.json({ error: `You've used today's ${BOX_GRADE_DAILY_LIMIT} box grades. Add your own Gemini key in Settings for more.` }, 429);
    }
  }

  const setNum = typeof body.set_num === 'string' ? body.set_num.slice(0, 20) : '';
  const set = setNum
    ? await c.env.DB.prepare('SELECT set_num, name FROM lego_sets WHERE set_num = ?').bind(setNum).first<{ set_num: string; name: string }>()
    : null;
  const result = await gradeBox(c.env, image, set ? `LEGO ${set.set_num} ${set.name}` : 'a LEGO set', { gemini: geminiKey, openai: openaiKey });
  if (!result) return c.json({ error: 'Could not grade this photo right now. Try again with the whole box in view.' }, 503);
  return c.json({ ...result, price_share: result.grade ? GRADE_PRICE_SHARE[result.grade] : null });
});

export { app as gradeRoute };
