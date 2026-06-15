import { Hono } from 'hono';
import OpenAI from 'openai';
import { optionalMember } from '../auth';
import { callGeminiScan } from '../lib/gemini';
import { enrichSetRecord } from '../lib/market-sources';
import { recordIntegrationAttempt } from '../lib/integration-health';
import { logEvent } from '../lib/analytics';
import { MODELS, openAIServerBaseURL, openRouterBaseURL, gatewayHeaders, gatewayMetadataHeader, SCAN_SYSTEM_PROMPT } from '../lib/llm';
import { recordAiUsage } from '../lib/ai-usage';
import { verifyTurnstileToken } from '../lib/turnstile';
import { matchSetsToCatalog, matchMinifigsToCatalog, type DescribedSet, type DescribedMinifig } from '../lib/scan-match';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Free-tier server-key limit; bypassed when the user supplies their own Gemini/OpenAI key.
const SCAN_HOURLY_LIMIT = 20;

function openAIIdentificationMessage(error: unknown): string {
  const status = typeof (error as { status?: unknown })?.status === 'number'
    ? (error as { status: number }).status
    : 0;
  const message = error instanceof Error ? error.message : String(error || '');

  if (status === 401 || status === 403 || /api key|unauthorized|forbidden|permission/i.test(message)) {
    return 'OpenAI key could not be used. Check the key in Settings or try a Gemini key.';
  }
  if (status === 429 || /quota|rate limit/i.test(message)) {
    return 'OpenAI quota or rate limit was reached. Try again later or use your own Gemini/OpenAI key.';
  }
  if (status >= 500 || /timeout|network|fetch/i.test(message)) {
    return 'AI identification service is temporarily unavailable. Try again in a moment.';
  }
  if (/json|parse|unexpected token/i.test(message)) {
    return 'Could not read the AI response. Try another photo with the set number or box art clearly visible.';
  }
  return 'AI identification failed. Try another photo, barcode scan, or catalog search.';
}

// Describe LEGO set(s) in an image via any OpenAI-compatible client (OpenRouter
// free vision models or OpenAI gpt-4o-mini). Returns AI-described sets + usage.
async function openaiVisionDescribe(
  client: OpenAI,
  model: string,
  image: string,
): Promise<{ sets: DescribedSet[]; minifigs: DescribedMinifig[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const messages: Parameters<typeof client.chat.completions.create>[0]['messages'] = [
    { role: 'system', content: SCAN_SYSTEM_PROMPT },
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: image } },
      { type: 'text', text: 'Identify the LEGO set(s) and minifigure(s) in this image.' },
    ] },
  ];
  const completion = await client.chat.completions.create({
    model,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages,
  });
  const text = completion.choices[0]?.message?.content;
  let sets: DescribedSet[] = [];
  let minifigs: DescribedMinifig[] = [];
  if (text) {
    try {
      const parsed = JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as { sets?: DescribedSet[]; minifigs?: DescribedMinifig[] };
      sets = Array.isArray(parsed?.sets) ? parsed.sets : [];
      minifigs = Array.isArray(parsed?.minifigs) ? parsed.minifigs : [];
    } catch { /* model returned prose instead of JSON — treat as no result */ }
  }
  return { sets, minifigs, usage: completion.usage };
}

// Cost-tiered vision cascade for the SHARED (keyless) scan: server Gemini on the
// free tier first, then OpenRouter free vision models, then the paid gpt-4o-mini
// backstop. Records each call in the ai_usage ledger + integration health.
async function describeSharedScan(env: Env, image: string): Promise<{ sets: DescribedSet[]; minifigs: DescribedMinifig[]; model: string } | { error: string }> {
  const meta = { ...gatewayHeaders(env), ...gatewayMetadataHeader({ workload: 'scan-shared' }) };

  // 1. Server Gemini (free tier) — routed through the gateway when configured.
  if (env.GEMINI_API_KEY) {
    try {
      const r = await callGeminiScan(image, env.GEMINI_API_KEY, env, { routeThroughGateway: true });
      await recordAiUsage(env, 'gemini', MODELS.scan, null);
      await recordIntegrationAttempt(env, 'gemini', true);
      if (r?.sets?.length || r?.minifigs?.length) {
        return { sets: (r.sets ?? []) as DescribedSet[], minifigs: (r.minifigs ?? []) as DescribedMinifig[], model: MODELS.scan };
      }
    } catch (e) {
      await recordIntegrationAttempt(env, 'gemini', false, e);
      console.warn('[scan] server Gemini failed:', (e as Error).message);
    }
  }

  // 2. OpenRouter free vision models (tried in order).
  if (env.OPENROUTER_API_KEY) {
    const orc = new OpenAI({ apiKey: env.OPENROUTER_API_KEY, baseURL: openRouterBaseURL(env), defaultHeaders: meta });
    for (const model of MODELS.scanOpenrouterVisionPool) {
      try {
        const { sets, minifigs, usage } = await openaiVisionDescribe(orc, model, image);
        await recordAiUsage(env, 'openrouter', model, usage);
        if (sets.length || minifigs.length) {
          await recordIntegrationAttempt(env, 'openrouter', true);
          return { sets, minifigs, model };
        }
      } catch (e) {
        console.warn(`[scan] OpenRouter ${model} failed:`, (e as Error).message);
      }
    }
  }

  // 3. Paid backstop: server OpenAI gpt-4o-mini.
  if (env.OPENAI_API_KEY) {
    const oac = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: openAIServerBaseURL(env), defaultHeaders: meta });
    try {
      const { sets, minifigs, usage } = await openaiVisionDescribe(oac, MODELS.openaiFallback, image);
      await recordAiUsage(env, 'openai', MODELS.openaiFallback, usage);
      await recordIntegrationAttempt(env, 'openai', true);
      return { sets, minifigs, model: MODELS.openaiFallback };
    } catch (e) {
      await recordIntegrationAttempt(env, 'openai', false, e);
      console.warn('[scan] OpenAI fallback failed:', (e as Error).message);
      return { error: openAIIdentificationMessage(e) };
    }
  }

  return { error: 'AI identification is temporarily unavailable. Try a barcode scan, or add your own Gemini/OpenAI key.' };
}

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
    logEvent(c.env, 'scan_used', userId, { setNum: String((r as Record<string, unknown>).set_num || '') });
    return c.json({ identified: true, set: enrichSetRecord({ ...(r as Record<string, unknown>), retired: !!(r as Record<string, unknown>).retired }), confidence: 'high', reasoning: 'Barcode matched in catalog.' });
  }

  if (mode !== 'image') return c.json({ error: 'mode must be image or barcode' }, 400);
  if (!image) return c.json({ error: 'image required' }, 400);
  if (image.length > 2_000_000) return c.json({ error: 'Image too large (max ~1.5 MB)' }, 413);

  const geminiKey = c.req.header('X-Gemini-Key');
  const openaiKey = c.req.header('X-OpenAI-Key');

  const NOT_FOUND = "Couldn't confidently identify a set. Try a clearer photo, include the box number, or scan the barcode.";
  // Match AI-described sets to the catalog (exact number, then FTS name search)
  // and shape the response. Shared by every provider path below.
  const respondMatched = async (describedSets: DescribedSet[], describedMinifigs: DescribedMinifig[], model: string) => {
    const setMatch = await matchSetsToCatalog(c.env, describedSets);
    const figMatch = await matchMinifigsToCatalog(c.env, describedMinifigs);
    if (!setMatch.sets.length && !figMatch.minifigs.length) return c.json({ identified: false, reasoning: NOT_FOUND });
    const firstId = String((setMatch.sets[0] as Record<string, unknown>)?.set_num || (figMatch.minifigs[0] as Record<string, unknown>)?.fig_num || '');
    logEvent(c.env, 'scan_used', userId, { setNum: firstId });
    return c.json({ identified: true, sets: setMatch.sets, minifigs: figMatch.minifigs, confidence: setMatch.topConfidence, reasoning: setMatch.reasoning, model });
  };

  // 1. BYOK Gemini — the user's own key, called directly on their quota.
  if (geminiKey) {
    let res: Awaited<ReturnType<typeof callGeminiScan>> = null;
    try { res = await callGeminiScan(image, geminiKey, c.env); }
    catch (e) { console.warn('[scan] BYOK Gemini failed:', (e as Error).message); }
    const sets = res?.sets ?? [];
    const minifigs = res?.minifigs ?? [];
    if (!sets.length && !minifigs.length) return c.json({ identified: false, reasoning: NOT_FOUND });
    return respondMatched(sets as DescribedSet[], minifigs as DescribedMinifig[], MODELS.scan);
  }

  // Shared (server-key) scanning requires sign-in; BYOK OpenAI needs only the key.
  if (!openaiKey && !userId) {
    return c.json({ error: 'Sign in or add your own Gemini/OpenAI key for photo scanning.' }, 401);
  }

  // 2. BYOK OpenAI — the user's own key, called directly.
  if (openaiKey) {
    const client = new OpenAI({ apiKey: openaiKey });
    let described: { sets: DescribedSet[]; minifigs: DescribedMinifig[] } = { sets: [], minifigs: [] };
    try { described = await openaiVisionDescribe(client, MODELS.openaiFallback, image); }
    catch (e) { return c.json({ identified: false, reasoning: openAIIdentificationMessage(e) }); }
    if (!described.sets.length && !described.minifigs.length) return c.json({ identified: false, reasoning: NOT_FOUND });
    return respondMatched(described.sets, described.minifigs, MODELS.openaiFallback);
  }

  // 3. SHARED keyless path: Turnstile (opt-in) + per-user rate limit + the
  //    cost-tiered vision cascade (Gemini free -> OpenRouter free -> gpt-4o-mini).
  if (c.env.TURNSTILE_SECRET_KEY) {
    const verified = await verifyTurnstileToken(
      c.req.header('cf-turnstile-token'),
      c.env.TURNSTILE_SECRET_KEY,
      c.req.header('cf-connecting-ip'),
    );
    if (!verified) {
      return c.json({ error: 'Could not verify the request. Refresh and try again, or add your own Gemini/OpenAI key for unlimited scanning.' }, 403);
    }
  }

  {
    // Per-user hourly cap on the shared server quota.
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
    if ((rl?.hit_count || 0) > SCAN_HOURLY_LIMIT) {
      return c.json({ error: `Rate limit: ${SCAN_HOURLY_LIMIT} photo scans per hour. Set up your own API key to unlock unlimited scanning.` }, 429);
    }
  }

  const desc = await describeSharedScan(c.env, image);
  if ('error' in desc) return c.json({ identified: false, reasoning: desc.error });
  if (!desc.sets.length && !desc.minifigs.length) return c.json({ identified: false, reasoning: NOT_FOUND });
  return respondMatched(desc.sets, desc.minifigs, desc.model);
});

export { app as scanRoute };
