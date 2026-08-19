import type { Env } from '../types';
import { fetchTracked, fetchWithRetry } from './http';
import { MODELS, geminiUrl, gatewayHeaders, SCAN_SYSTEM_PROMPT } from './llm';

// Calls Gemini (MODELS.scan) with a user-supplied Gemini API key (free from Google
// AI Studio: https://aistudio.google.com/apikey). The free tier gives ~1500
// requests/day, so scans run on the user's own quota — not the server's OpenAI
// key — and don't count against the shared rate limit.
export async function callGeminiScan(
  imageDataUrl: string,
  apiKey: string,
  env?: Env,
  // routeThroughGateway: true only for SERVER-key callers (the keyless scan
  // cascade). BYOK callers leave it false to hit Google directly.
  // prompt: overrides the default single-set instruction (e.g. SHELF_SCAN_PROMPT).
  // timeoutMs/model: the keyless cascade runs on a deadline and its route step
  // names the model, so both must be overridable. Defaults keep BYOK callers —
  // which have no cascade behind them — on the old generous behaviour.
  opts: { routeThroughGateway?: boolean; prompt?: string; timeoutMs?: number; model?: string } = {},
): Promise<{
  sets?: Array<{ set_num: string | null; name: string; theme?: string | null; year?: number | null; confidence: string; reasoning: string }>;
  minifigs?: Array<{ name: string; theme?: string | null; confidence: string; reasoning: string }>;
} | null> {
  const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const [, mimeType, b64data] = match;

  const body = {
    contents: [{
      parts: [
        { text: opts.prompt || SCAN_SYSTEM_PROMPT },
        { inline_data: { mime_type: mimeType, data: b64data } },
      ],
    }],
    // Force JSON so weaker/edge responses don't return prose (parse still strips fences).
    generationConfig: { responseMimeType: 'application/json' },
  };

  try {
    const fetcher = env ? fetchTracked.bind(null, env, 'gemini') : fetchWithRetry;
    const resp = await fetcher(
      // Server-key cascade routes through the gateway when configured; BYOK scans
      // call Google directly (don't proxy the user's key/image through our gateway).
      geminiUrl(opts.model || MODELS.scan, { env, routeThroughGateway: opts.routeThroughGateway }),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          ...(opts.routeThroughGateway ? gatewayHeaders(env) : {}),
        },
        body: JSON.stringify(body),
      },
      // Vision calls with a base64 image take longer; give them headroom.
      //
      // When a caller passes a deadline it gets ONE attempt: inside the cascade
      // the retry is the next step, and retrying here instead doubled the worst
      // case to 60s against a client that gives up at 30 — which is what made
      // scans time out rather than fall through.
      { timeoutMs: opts.timeoutMs ?? 30000, retries: opts.timeoutMs ? 0 : 1 },
    );
    if (!resp.ok) {
      console.warn('[gemini] API error:', resp.status, await resp.text().catch(() => ''));
      return null;
    }
    const data = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    return JSON.parse(text.replace(/```json?\n?|```/g, '').trim());
  } catch (e) {
    console.warn('[gemini] parse error:', (e as Error).message);
    return null;
  }
}

export async function callGeminiValuation(
  setNum: string,
  setName: string,
  apiKey: string,
  env?: Env,
  // routeThroughGateway: true only for SERVER-key callers (the valuation cron);
  // BYOK callers (on-demand refresh/revalue in sets.ts) leave it false to hit
  // Google directly with the user's key.
  opts: { routeThroughGateway?: boolean } = {},
): Promise<{ current_value: number; used_value: number; ebay_value: number } | null> {
  const body = {
    contents: [{
      parts: [
        {
          text: `Estimate the current market valuation in USD for Lego set ${setNum} ${setName}. Provide average sold prices for: 1. Sealed/New box 2. Used/Good box 3. Recent average sales price on eBay. Return JSON only: { "current_value": number, "used_value": number, "ebay_value": number }`,
        },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
    }
  };

  try {
    const fetcher = env ? fetchTracked.bind(null, env, 'gemini') : fetchWithRetry;
    const resp = await fetcher(
      // Route through the gateway only for server-key calls; BYOK stays direct.
      geminiUrl(MODELS.valuation, { env, routeThroughGateway: opts.routeThroughGateway }),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
          ...(opts.routeThroughGateway ? gatewayHeaders(env) : {}),
        },
        body: JSON.stringify(body),
      },
      { timeoutMs: 20000, retries: 1 },
    );
    if (!resp.ok) {
      console.warn('[gemini-val] API error:', resp.status, await resp.text().catch(() => ''));
      return null;
    }
    const data = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    const parsed = JSON.parse(text.replace(/```json?\n?|```/g, '').trim()) as { current_value: number; used_value: number; ebay_value: number };
    if (typeof parsed.current_value === 'number' && typeof parsed.used_value === 'number' && typeof parsed.ebay_value === 'number') {
      return parsed;
    }
    return null;
  } catch (e) {
    console.warn('[gemini-val] parse error:', (e as Error).message);
    return null;
  }
}

