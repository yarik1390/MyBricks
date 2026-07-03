import OpenAI from 'openai';
import type { Env } from '../types';
import { MODELS, geminiUrl, openAIServerBaseURL, gatewayHeaders } from '../lib/llm';
import { recordIntegrationAttempt } from '../lib/integration-health';
import { fetchTracked } from '../lib/http';
import { enrichSetRecord } from '../lib/market-sources';

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
): Promise<ListingDraft> {
  const condition = (entry?.condition as string) || 'used_good';
  const conditionLabel: Record<string, string> = {
    sealed: 'Factory Sealed', new: 'New / Open Box',
    used_good: 'Used - Good', used_acceptable: 'Used - Acceptable',
  };
  const blPrice = set.current_value ? `$${Number(set.current_value).toFixed(0)}` : 'unknown';
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
      return JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as ListingDraft;
    }
    const finalOpenAIKey = openaiKey || c.env.OPENAI_API_KEY;
    if (!finalOpenAIKey) throw new Error('OpenAI is not configured');
    const openai = new OpenAI({
      apiKey: finalOpenAIKey,
      // Server-key calls route through the gateway; BYOK OpenAI stays direct.
      baseURL: openaiKey ? undefined : openAIServerBaseURL(c.env),
      defaultHeaders: openaiKey ? undefined : gatewayHeaders(c.env),
    });
    const result = await openai.chat.completions.create({
      model: MODELS.openaiFallback,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert eBay seller specializing in LEGO. Return JSON only.' },
        { role: 'user', content: prompt },
      ],
    });
    await recordIntegrationAttempt(c.env, 'openai', true);
    return JSON.parse(result.choices[0].message.content!.trim()) as ListingDraft;
  } catch (e) {
    await recordIntegrationAttempt(c.env, geminiKey ? 'gemini' : 'openai', false, e);
    console.warn('[listing-draft] AI failed:', (e as Error).message);
    throw e;
  }
}
