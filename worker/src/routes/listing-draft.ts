import OpenAI from 'openai';
import type { Env } from '../types';
import { MODELS, geminiUrl, gatewayHeaders } from '../lib/llm';
import { recordIntegrationAttempt } from '../lib/integration-health';
import { fetchTracked } from '../lib/http';
import { enrichSetRecord } from '../lib/market-sources';
import { resolveRoute } from '../lib/llm-routing';
import { openAiCompatibleStep } from '../lib/llm-clients';
import { spendQuotaFailClosed } from '../lib/api-quota';
import { freeOnlySteps } from '../lib/ai-access';

const SYSTEM = 'You are an expert eBay seller specializing in LEGO. Return JSON only.';

/** Parse a model's JSON reply (fenced or bare, thinking text tolerated). */
export function parseDraft(text: string | null | undefined): ListingDraft {
  const raw = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json?\n?|```/g, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  const obj = JSON.parse(start >= 0 && end > start ? raw.slice(start, end + 1) : raw) as ListingDraft;
  if (!obj || typeof obj.title !== 'string' || typeof obj.description !== 'string') throw new Error('AI reply was not a listing draft');
  return obj;
}

export interface ListingDraft {
  title: string;
  description: string;
  suggested_price: number;
  price_reasoning: string;
}

type DraftCtx = {
  req: { header(name: string): string | undefined };
  env: Env;
};

// Build the AI prompt and call the configured provider (BYOK Gemini, BYOK/server
// OpenAI) to produce an eBay listing draft. Throws on any provider failure — the
// route handler maps that to a 500 — after recording the integration attempt.
// Extracted from the POST /:setnum/listing-draft handler (route wiring, auth and
// rate-limit stay there).
export async function generateListingDraft(
  c: DraftCtx,
  set: Record<string, unknown>,
  entry: Record<string, unknown> | null,
  /** Past the AI trial: free providers only (BYOK-first, 2026-11-08). */
  freeOnly = false,
): Promise<ListingDraft> {
  const condition = (entry?.condition as string) || 'used_good';
  const conditionLabel: Record<string, string> = {
    sealed: 'Factory Sealed', new: 'New / Open Box',
    used_good: 'Used - Good', used_acceptable: 'Used - Acceptable',
  };
  // The same headline the set page shows (set is enriched by the caller).
  const headline = Number(set.market_value) || Number(set.blended_value) || Number(set.current_value) || 0;
  const blPrice = headline ? `$${headline.toFixed(0)}` : 'unknown';
  const ebayNew = Number(set.ebay_new_value ?? set.ebay_value ?? 0);
  const ebayUsed = Number(set.ebay_used_value ?? 0);
  const ebayPrice = condition.startsWith('used') && ebayUsed > 0
    ? `$${ebayUsed.toFixed(0)} used sold`
    : ebayNew > 0
      ? `$${ebayNew.toFixed(0)} new sold`
      : null;

  const sourceName = set.valuation_method === 'market' ? 'BrickLink'
    : set.valuation_method === 'brickeconomy' ? 'BrickEconomy'
    : set.valuation_method === 'ai' ? 'AI estimate'
    : (set.valuation_method === 'ebay_rss' || set.valuation_method === 'ebay_sold') ? 'eBay Sold' : 'Estimated';
  const marketMeta = enrichSetRecord({ ...set });

  const prompt = `Generate an eBay listing for this LEGO set. Return JSON only with keys: title, description, suggested_price (number), price_reasoning (string).

Set: ${set.name}
Set number: ${set.set_num}
Theme: ${set.theme || 'LEGO'}
Year: ${set.year}
Pieces: ${set.pieces}
Minifigs: ${set.minifigs || 0}
Condition: ${conditionLabel[condition] || condition}
Is complete: ${entry?.is_complete !== 0 ? 'Yes' : `No (${entry?.missing_pieces || '?'} pieces missing)`}
${sourceName} market price (new): ${blPrice}${ebayPrice ? `\neBay recent sales: ${ebayPrice}` : ''}
Market confidence: ${marketMeta.confidence}; freshness: ${marketMeta.freshness}
Notes from owner: ${entry?.notes || 'none'}

Title: max 80 characters, include set number and name.
Description: 3-5 sentences covering set highlights, condition, and what's included.
suggested_price: a specific dollar amount number (no $ sign).
price_reasoning: one sentence explaining the price.`;

  const geminiKey = c.req.header('X-Gemini-Key');
  const openaiKey = c.req.header('X-OpenAI-Key');

  try {
    if (geminiKey) {
      const resp = await fetchTracked(
        c.env,
        'gemini',
        // BYOK listing draft: call Google directly with the user's key.
        geminiUrl(MODELS.listing),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 400, responseMimeType: 'application/json' },
          }),
        }
      );
      if (!resp.ok) throw new Error('Gemini request failed');
      const body = await resp.json() as Record<string, unknown>;
      const text = (body['candidates'] as { content: { parts: { text: string }[] } }[])?.[0]?.content?.parts?.[0]?.text ?? '{}';
      return parseDraft(text);
    }
    if (openaiKey) {
      // BYOK OpenAI stays direct, no gateway.
      const openai = new OpenAI({ apiKey: openaiKey });
      const result = await openai.chat.completions.create({
        model: MODELS.openaiFallback,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: prompt },
        ],
      });
      await recordIntegrationAttempt(c.env, 'openai', true);
      return parseDraft(result.choices[0].message.content);
    }
    // Server keys: the admin listing route (free models after the trial).
    const route = await resolveRoute(c.env, 'listing');
    const steps = freeOnly ? freeOnlySteps(route) : route;
    let lastError: unknown = new Error('No AI provider is configured');
    for (const step of steps) {
      try {
        if (step.provider === 'gemini') {
          if (!c.env.GEMINI_API_KEY || !(await spendQuotaFailClosed(c.env, 'gemini_paid'))) continue;
          const resp = await fetchTracked(c.env, 'gemini', geminiUrl(step.model || MODELS.listing, { env: c.env, routeThroughGateway: true }), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.env.GEMINI_API_KEY, ...gatewayHeaders(c.env) },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 400, responseMimeType: 'application/json' },
            }),
          });
          if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
          const body = await resp.json() as Record<string, unknown>;
          return parseDraft((body['candidates'] as { content: { parts: { text: string }[] } }[])?.[0]?.content?.parts?.[0]?.text);
        }
        const { client, models } = await openAiCompatibleStep(
          c.env,
          step.provider === 'openai' ? { ...step, model: step.model || MODELS.openaiFallback } : step,
          step.provider === 'openai' ? gatewayHeaders(c.env) : {},
          'text',
        );
        if (!client) continue;
        for (const model of models) {
          const result = await client.chat.completions.create({
            model,
            max_tokens: 600,
            ...(step.provider === 'workersai' ? {} : { response_format: { type: 'json_object' as const } }),
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user', content: prompt },
            ],
          });
          const draft = parseDraft(result.choices[0]?.message?.content);
          await recordIntegrationAttempt(c.env, step.provider, true);
          return draft;
        }
      } catch (e) {
        lastError = e;
        await recordIntegrationAttempt(c.env, step.provider, false, e).catch(() => {});
      }
    }
    throw lastError;
  } catch (e) {
    await recordIntegrationAttempt(c.env, geminiKey ? 'gemini' : 'openai', false, e);
    console.warn('[listing-draft] AI failed:', (e as Error).message);
    throw e;
  }
}
