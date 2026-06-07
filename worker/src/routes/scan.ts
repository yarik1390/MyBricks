import { Hono } from 'hono';
import OpenAI from 'openai';
import { optionalMember } from '../auth';
import { callGeminiScan } from '../lib/gemini';
import { enrichSetRecord } from '../lib/market-sources';
import { recordIntegrationAttempt } from '../lib/integration-health';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Free-tier server-key limit; bypassed when the user supplies their own Gemini/OpenAI key.
const SCAN_HOURLY_LIMIT = 20;

app.use('*', optionalMember);

app.post('/identify', async (c) => {
  const userId = c.get('userId') || '';
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
    return c.json({ identified: true, set: enrichSetRecord({ ...(r as Record<string, unknown>), retired: !!(r as Record<string, unknown>).retired }), confidence: 'high', reasoning: 'Barcode matched in catalog.' });
  }

  if (mode !== 'image') return c.json({ error: 'mode must be image or barcode' }, 400);
  if (!image) return c.json({ error: 'image required' }, 400);
  if (image.length > 2_000_000) return c.json({ error: 'Image too large (max ~1.5 MB)' }, 413);

  // Gemini path: user's own Gemini API key — uses their own quota, no rate limit here.
  const geminiKey = c.req.header('X-Gemini-Key');
  if (geminiKey) {
    const res = await callGeminiScan(image, geminiKey, c.env);
    if (!res || !res.sets || !res.sets.length) {
      return c.json({ identified: false, reasoning: 'Gemini could not identify any sets in the image.' });
    }
    const geminiCandidates = res.sets.filter(s => s.confidence !== 'none');
    const geminiNums = [...new Set(geminiCandidates.flatMap(s => [s.set_num, s.set_num + '-1']))];
    let geminiByNum = new Map<string, Record<string, unknown>>();
    if (geminiNums.length) {
      const placeholders = geminiNums.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(
        `SELECT * FROM lego_sets WHERE set_num IN (${placeholders})`
      ).bind(...geminiNums).all<Record<string, unknown>>();
      geminiByNum = new Map(results.map(r => [r.set_num as string, r]));
    }
    const matchedSets: Record<string, unknown>[] = [];
    let topConfidence = 'none';
    let reasoning = '';
    for (const candidate of geminiCandidates) {
      const r = geminiByNum.get(candidate.set_num) ?? geminiByNum.get(candidate.set_num + '-1');
      if (r) {
        matchedSets.push(enrichSetRecord({ ...r, retired: !!r.retired, confidence: candidate.confidence, reasoning: candidate.reasoning }));
        if (topConfidence === 'none' || candidate.confidence === 'high') {
          topConfidence = candidate.confidence;
          reasoning = candidate.reasoning;
        }
      }
    }
    if (!matchedSets.length) {
      return c.json({ identified: false, reasoning: 'Sets identified by Gemini were not found in local catalog.' });
    }
    return c.json({ identified: true, sets: matchedSets, confidence: topConfidence, reasoning, model: 'gemini-2.0-flash' });
  }

  const openaiKey = c.req.header('X-OpenAI-Key');
  if (!openaiKey && !userId) {
    return c.json({ error: 'Sign in or add your own Gemini/OpenAI key for photo scanning.' }, 401);
  }

  if (!openaiKey) {
    // OpenAI path — rate-limited per user.
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

    if ((rl?.hit_count || 0) >= SCAN_HOURLY_LIMIT) {
      return c.json({ error: `Rate limit: ${SCAN_HOURLY_LIMIT} photo scans per hour. Set up your own API key to unlock unlimited scanning.` }, 429);
    }
  }

  const finalOpenAIKey = openaiKey || c.env.OPENAI_API_KEY;
  if (!finalOpenAIKey) {
    return c.json({ error: 'No OpenAI API key configured.' }, 500);
  }
  const openai = new OpenAI({ apiKey: finalOpenAIKey });

  const openaiMessages: Parameters<typeof openai.chat.completions.create>[0]['messages'] = [
    { role: 'system', content: 'You are a LEGO product-identification expert. Identify all the LEGO sets visible in this image. Return ONLY raw JSON in this format: { "sets": [ { "set_num": "...", "name": "...", "confidence": "high|medium|low|none", "reasoning": "..." } ] }' },
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: image } },
      { type: 'text', text: 'Identify all the LEGO sets.' },
    ]},
  ];

  async function callOpenAI() {
    return openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 256,
      response_format: { type: 'json_object' },
      messages: openaiMessages,
    });
  }

  let res: { sets?: Array<{ set_num: string; name: string; confidence: string; reasoning: string }> };
  try {
    let result = await callOpenAI().catch(async (e: Error & { status?: number }) => {
      if (e.status && e.status >= 500) {
        await new Promise(r => setTimeout(r, 500));
        return callOpenAI();
      }
      throw e;
    });
    res = JSON.parse(result.choices[0].message.content!.trim());
    await recordIntegrationAttempt(c.env, 'openai', true);
  } catch (e) {
    await recordIntegrationAttempt(c.env, 'openai', false, e);
    console.warn('[scan] AI parse failed:', (e as Error).message);
    return c.json({ identified: false, reasoning: 'Could not parse AI response.' });
  }

  if (!res || !res.sets || !res.sets.length) {
    return c.json({ identified: false, reasoning: 'OpenAI could not identify any sets in the image.' });
  }

  // Resolve every candidate (and its "-1" variant) in a single query to avoid an
  // N+1 round-trip per identified set.
  const candidates = res.sets.filter(s => s.confidence !== 'none');
  const allNums = [...new Set(candidates.flatMap(s => [s.set_num, s.set_num + '-1']))];
  let byNum = new Map<string, Record<string, unknown>>();
  if (allNums.length) {
    const placeholders = allNums.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM lego_sets WHERE set_num IN (${placeholders})`
    ).bind(...allNums).all<Record<string, unknown>>();
    byNum = new Map(results.map(r => [r.set_num as string, r]));
  }

  const matchedSets: Record<string, unknown>[] = [];
  let topConfidence = 'none';
  let reasoning = '';
  for (const candidate of candidates) {
    // Prefer the exact set_num, then the "-1" variant.
    const r = byNum.get(candidate.set_num) ?? byNum.get(candidate.set_num + '-1');
    if (r) {
      matchedSets.push(enrichSetRecord({ ...r, retired: !!r.retired, confidence: candidate.confidence, reasoning: candidate.reasoning }));
      if (topConfidence === 'none' || candidate.confidence === 'high') {
        topConfidence = candidate.confidence;
        reasoning = candidate.reasoning;
      }
    }
  }

  if (!matchedSets.length) {
    return c.json({ identified: false, reasoning: 'Sets identified by OpenAI were not found in local catalog.' });
  }

  return c.json({ identified: true, sets: matchedSets, confidence: topConfidence, reasoning, model: 'gpt-4o-mini' });
});

export { app as scanRoute };
