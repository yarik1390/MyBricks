import { Hono } from 'hono';
import OpenAI from 'openai';
import { optionalMember } from '../auth';
import { callGeminiScan } from '../lib/gemini';
import { enrichSetRecord } from '../lib/market-sources';
import { recordIntegrationAttempt } from '../lib/integration-health';
import { logEvent } from '../lib/analytics';
import { MODELS, gatewayHeaders, gatewayMetadataHeader, SCAN_SYSTEM_PROMPT, SHELF_SCAN_PROMPT } from '../lib/llm';
import { resolveRoute } from '../lib/llm-routing';
import { openAiCompatibleStep } from '../lib/llm-clients';
import { isMergeBudgetExhausted, mergeReportedCostUsd } from '../lib/merge-gateway';
import { recordAiUsage } from '../lib/ai-usage';
import { verifyTurnstileToken } from '../lib/turnstile';
import { matchSetsToCatalog, matchMinifigsToCatalog, type DescribedSet, type DescribedMinifig } from '../lib/scan-match';
import { CATALOG_COLS, MARKET_EXT_JOIN } from './sets';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Shared server-key scan limits; bypassed when the user supplies their own
// Gemini/OpenAI key (BYOK). Free users get a daily cap; supporters keep a higher
// hourly burst window.
const SCAN_DAILY_LIMIT = 20;        // free tier: 20 AI photo scans per day
const SCAN_HOURLY_LIMIT = 20;       // supporter burst window (× multiplier below)

// Shelf Snap returns up to this many sets from one photo. Also sizes the
// completion budget: ~25 sets × ~70 tokens of JSON each fits well inside 2400.
const SHELF_MAX_SETS = 25;

// Prompt override threaded through every vision provider. Default (empty)
// keeps the single-set SCAN_SYSTEM_PROMPT / 700-token behavior.
type ScanPromptOpts = { prompt?: string; maxTokens?: number };

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
  opts: ScanPromptOpts = {},
): Promise<{ sets: DescribedSet[]; minifigs: DescribedMinifig[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; rawUsage?: unknown }> {
  const messages: Parameters<typeof client.chat.completions.create>[0]['messages'] = [
    { role: 'system', content: opts.prompt || SCAN_SYSTEM_PROMPT },
    { role: 'user', content: [
      { type: 'image_url', image_url: { url: image } },
      { type: 'text', text: 'Identify the LEGO set(s) and minifigure(s) in this image.' },
    ] },
  ];
  const completion = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens || 700,
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
  return { sets, minifigs, usage: completion.usage, rawUsage: completion.usage };
}

/**
 * Vision cascade for the SHARED (keyless) scan, driven by the admin-tunable
 * route in `lib/llm-routing.ts` rather than a hardcoded if-chain.
 *
 * Each step names a provider + model and is tried in order; a step that errors,
 * or returns 200 with nothing usable, falls through to the next. "200 but
 * empty" deliberately counts as a miss — a provider that answers with no sets
 * has not identified anything, and treating it as success would strand the scan
 * on the cheapest tier.
 *
 * The `openrouter` step with an empty model id expands in place to the live
 * free-vision pool (refreshed daily into KV by the model-refresh cron), so that
 * position stays current without anyone editing the route.
 */
async function describeSharedScan(env: Env, image: string, opts: ScanPromptOpts = {}): Promise<{ sets: DescribedSet[]; minifigs: DescribedMinifig[]; model: string } | { error: string }> {
  const meta = { ...gatewayHeaders(env), ...gatewayMetadataHeader({ workload: 'scan-shared' }) };
  const steps = await resolveRoute(env, 'scan');
  let lastOpenAiError: unknown = null;

  for (const step of steps) {
    // Gemini speaks its own REST shape, not the OpenAI one — separate client.
    if (step.provider === 'gemini') {
      try {
        const r = await callGeminiScan(image, env.GEMINI_API_KEY ?? '', env, { routeThroughGateway: true, prompt: opts.prompt });
        await recordAiUsage(env, 'gemini', step.model, null);
        await recordIntegrationAttempt(env, 'gemini', true);
        if (r?.sets?.length || r?.minifigs?.length) {
          return { sets: (r.sets ?? []) as DescribedSet[], minifigs: (r.minifigs ?? []) as DescribedMinifig[], model: step.model };
        }
      } catch (e) {
        await recordIntegrationAttempt(env, 'gemini', false, e);
        console.warn('[scan] Gemini step failed:', (e as Error).message);
      }
      continue;
    }

    // Everything else is OpenAI-compatible; only the baseURL and key differ.
    const { client, models } = await openAiCompatibleStep(env, step, meta);
    if (!client) continue;
    for (const model of models) {
      try {
        const { sets, minifigs, usage, rawUsage } = await openaiVisionDescribe(client, model, image, opts);
        // Merge reports what the call actually cost; everyone else is estimated.
        const cost = step.provider === 'merge' ? mergeReportedCostUsd(rawUsage) : null;
        await recordAiUsage(env, step.provider, model, usage, cost);
        if (sets.length || minifigs.length) {
          await recordIntegrationAttempt(env, step.provider, true);
          return { sets, minifigs, model };
        }
      } catch (e) {
        if (step.provider === 'openai') lastOpenAiError = e;
        // A hard budget or a rejected key takes the whole provider out for this
        // request — no point walking its remaining models.
        const status = Number((e as { status?: unknown })?.status ?? 0);
        if (step.provider === 'merge' && isMergeBudgetExhausted(status)) {
          await recordIntegrationAttempt(env, 'merge', false, `HTTP ${status} (budget or key exhausted)`);
          console.warn(`[scan] Merge out of budget/key (HTTP ${status}) — skipping provider`);
          break;
        }
        console.warn(`[scan] ${step.provider} ${model} failed:`, (e as Error).message);
      }
    }
  }

  if (lastOpenAiError) {
    await recordIntegrationAttempt(env, 'openai', false, lastOpenAiError);
    return { error: openAIIdentificationMessage(lastOpenAiError) };
  }
  return { error: 'No AI provider is configured for photo identification.' };
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
      // Explicit catalog-card projection (shared with /api/sets/search) instead
      // of SELECT * — covers everything enrichSetRecord + the scan-result card need.
      r = await c.env.DB.prepare(`SELECT ${CATALOG_COLS} FROM lego_sets s ${MARKET_EXT_JOIN} WHERE s.upc=?`).bind(bc).first();
      if (r) break;
    }
    if (!r) return c.json({ identified: false, reasoning: 'Barcode not in catalog. Try a photo scan instead.' });
    logEvent(c.env, 'scan_used', userId, { setNum: String((r as Record<string, unknown>).set_num || '') });
    return c.json({ identified: true, set: enrichSetRecord({ ...(r as Record<string, unknown>), retired: !!(r as Record<string, unknown>).retired }), confidence: 'high', reasoning: 'Barcode matched in catalog.' });
  }

  if (mode !== 'image' && mode !== 'shelf') return c.json({ error: 'mode must be image, shelf or barcode' }, 400);
  if (!image) return c.json({ error: 'image required' }, 400);
  if (image.length > 2_000_000) return c.json({ error: 'Image too large (max ~1.5 MB)' }, 413);

  // Shelf Snap: same pipeline, exhaustive prompt + a completion budget sized
  // for up to SHELF_MAX_SETS sets instead of one.
  const shelfMode = mode === 'shelf';
  const promptOpts: ScanPromptOpts = shelfMode ? { prompt: SHELF_SCAN_PROMPT, maxTokens: 2400 } : {};

  const geminiKey = c.req.header('X-Gemini-Key');
  const openaiKey = c.req.header('X-OpenAI-Key');

  const NOT_FOUND = shelfMode
    ? "Couldn't identify any sets on that shelf. Try a closer, well-lit photo — a few sets at a time works best."
    : "Couldn't confidently identify a set. Try a clearer photo, include the box number, or scan the barcode.";
  // Match AI-described sets to the catalog (exact number, then FTS name search)
  // and shape the response. Shared by every provider path below.
  const respondMatched = async (describedSets: DescribedSet[], describedMinifigs: DescribedMinifig[], model: string) => {
    const setMatch = await matchSetsToCatalog(c.env, describedSets.slice(0, SHELF_MAX_SETS));
    const figMatch = await matchMinifigsToCatalog(c.env, describedMinifigs);
    if (!setMatch.sets.length && !figMatch.minifigs.length) return c.json({ identified: false, reasoning: NOT_FOUND });
    const firstId = String((setMatch.sets[0] as Record<string, unknown>)?.set_num || (figMatch.minifigs[0] as Record<string, unknown>)?.fig_num || '');
    logEvent(c.env, 'scan_used', userId, { setNum: firstId });
    return c.json({ identified: true, sets: setMatch.sets, minifigs: figMatch.minifigs, confidence: setMatch.topConfidence, reasoning: setMatch.reasoning, model });
  };

  // 1. BYOK Gemini — the user's own key, called directly on their quota.
  if (geminiKey) {
    let res: Awaited<ReturnType<typeof callGeminiScan>> = null;
    try { res = await callGeminiScan(image, geminiKey, c.env, { prompt: promptOpts.prompt }); }
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
    try { described = await openaiVisionDescribe(client, MODELS.openaiFallback, image, promptOpts); }
    catch (e) { return c.json({ identified: false, reasoning: openAIIdentificationMessage(e) }); }
    if (!described.sets.length && !described.minifigs.length) return c.json({ identified: false, reasoning: NOT_FOUND });
    return respondMatched(described.sets, described.minifigs, MODELS.openaiFallback);
  }

  // 3. SHARED keyless path: Turnstile (opt-in) + per-user rate limit + the
  //    cost-tiered vision cascade (Gemini free -> OpenRouter free -> gpt-4o-mini).
  // Turnstile tokens are bound to web hostnames and cannot be minted reliably
  // by the bundled Capacitor WebView (`https://localhost`). Authenticated
  // Android scans remain cost-bounded by the per-user quota below. The platform
  // header is not an auth boundary; a spoofed caller still needs a valid member
  // JWT and remains capped to the same daily quota.
  const authenticatedAndroid = c.req.header('X-Brickvault-Platform')?.toLowerCase() === 'android' && !!userId;
  if (c.env.TURNSTILE_SECRET_KEY && !authenticatedAndroid) {
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
    // Per-user cap on the shared server quota (BYOK above bypasses this entirely).
    // Free tier: 20 scans PER DAY (UTC-day bucket). Supporters keep a higher
    // HOURLY burst window so paid users aren't newly restricted.
    const pref = await c.env.DB.prepare(
      'SELECT is_supporter FROM user_prefs WHERE user_id=?'
    ).bind(userId).first<{ is_supporter: number }>();
    const isSupporter = !!pref?.is_supporter;
    const limit = isSupporter ? SCAN_HOURLY_LIMIT * 5 : SCAN_DAILY_LIMIT;
    const period = isSupporter ? 'hour' : 'day';
    const windowStart = new Date();
    if (isSupporter) windowStart.setMinutes(0, 0, 0);   // top of the hour
    else windowStart.setUTCHours(0, 0, 0, 0);           // start of the UTC day
    const ws = windowStart.toISOString();
    // Atomic increment+read (RETURNING) — closes the read-after-write race where
    // two concurrent scans could both slip past the cap.
    const rl = await c.env.DB.prepare(`
      INSERT INTO rate_limits (user_id, endpoint, window_start, hit_count)
      VALUES (?, 'scan_image', ?, 1)
      ON CONFLICT (user_id, endpoint, window_start) DO UPDATE SET hit_count = rate_limits.hit_count + 1
      RETURNING hit_count
    `).bind(userId, ws).first<{ hit_count: number }>();
    if ((rl?.hit_count || 0) > limit) {
      return c.json({ error: `Rate limit: ${limit} photo scans per ${period}. Add your own Gemini/OpenAI key for unlimited scanning.` }, 429);
    }
  }

  const desc = await describeSharedScan(c.env, image, promptOpts);
  if ('error' in desc) return c.json({ identified: false, reasoning: desc.error });
  if (!desc.sets.length && !desc.minifigs.length) return c.json({ identified: false, reasoning: NOT_FOUND });
  return respondMatched(desc.sets, desc.minifigs, desc.model);
});

export { app as scanRoute };
