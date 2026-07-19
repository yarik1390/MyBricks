import type { Env } from '../types';

/**
 * Central AI model + gateway configuration.
 *
 * One place to (a) choose the model per task and (b) route SERVER-key provider
 * calls through Cloudflare AI Gateway for caching, analytics, rate limiting and
 * spend limits. See the project doc "MyBricks — AI Integration Plan (at scale)".
 *
 * Routing policy (Phase 1):
 *  - SERVER-key calls (valuation cron Gemini, all server OpenAI) -> through the
 *    gateway when configured (the cost WE pay for and want to cache/cap/observe).
 *  - BYOK calls (user-supplied Gemini/OpenAI keys in scan + advisor) -> stay
 *    DIRECT to the provider: we don't proxy users' keys/images through our
 *    gateway, and per-key responses wouldn't share a cache anyway.
 *  - The gateway is OPT-IN: when AI_GATEWAY_ACCOUNT_ID/AI_GATEWAY_ID are unset
 *    the helpers fall back to calling providers directly, so the worker behaves
 *    exactly as before until the gateway is provisioned.
 */

// Per-task model selection. The scanner needs stronger multimodal reasoning, so
// it stays on Flash; text/JSON tasks use the cheaper Flash-Lite. All migrated
// off the deprecated gemini-2.0-flash.
export const MODELS = {
  scan: 'gemini-2.5-flash',
  advisor: 'gemini-2.5-flash-lite',
  valuation: 'gemini-2.5-flash-lite',
  listing: 'gemini-2.5-flash-lite',
  openaiFallback: 'gpt-4o-mini',
  // OpenRouter cheap valuation fallback. Resilience model: try an ORDERED POOL of
  // capable FREE models (each verified to currently exist on OpenRouter), falling
  // through to the next on error/empty/unparseable, then escalate to a cheap PAID
  // model app-side as the reliability backstop. A 200-with-empty does NOT trigger
  // OpenRouter's own models[] fallback, so the cron iterates the pool itself. Free
  // availability churns; any one working free model keeps us at $0, and the paid
  // backstop guarantees a result — cheap without sacrificing reliability.
  openrouterFreePool: [
    'nvidia/nemotron-3-super-120b-a12b:free', // verified: clean JSON, strong instruction-following
    'meta-llama/llama-3.3-70b-instruct:free', // very reliable general instruct, solid JSON adherence
    'openai/gpt-oss-120b:free',               // strong open reasoning model, good JSON adherence
  ],
  openrouterPaid: 'deepseek/deepseek-chat',
  // VISION-capable free OpenRouter pool for the photo-scan cascade (the text pool
  // above is NOT multimodal). Verified to currently accept image input on
  // OpenRouter; tried in order before the paid gpt-4o-mini backstop.
  scanOpenrouterVisionPool: [
    'google/gemma-4-31b-it:free',          // large, strong general multimodal + world knowledge
    'google/gemma-4-26b-a4b-it:free',      // MoE sibling (4B active) — fast, same family
    'nvidia/nemotron-nano-12b-v2-vl:free', // dedicated vision-language model
  ],
  // Cheap PAID vision tier tried before the gpt-4o-mini backstop: at
  // $0.075/M in + $0.20/M out it is ~2.6× cheaper than gpt-4o-mini
  // ($0.15/$0.60) for the same structured-JSON identification task. Runs on
  // OpenRouter credits; the OpenAI backstop still guarantees a result if the
  // whole OpenRouter path is down.
  scanOpenrouterPaid: 'mistralai/mistral-small-3.2-24b-instruct',
} as const;

// Shared photo-scan instruction. Used by BOTH the Gemini scan (gemini.ts) and the
// OpenAI-compatible vision cascade (scan.ts) so every provider returns the same
// shape. The key change vs the old prompt: when no set number is visible (built
// sets), the model describes the set by name/theme/year so we can resolve it
// against the catalog search index instead of needing an exact number.
export const SCAN_SYSTEM_PROMPT =
  'You are a LEGO product-identification expert. Identify the LEGO set(s) AND any LEGO minifigure(s) shown in the image. ' +
  'For sets: if a box or printed set number is visible, return just the digits in set_num (e.g. "75192"); ' +
  'if it is a built set with no visible number, identify it by its official set name, theme, and approximate release year. ' +
  'For minifigures: identify each by its character or official minifig name (e.g. "Darth Vader", "Hermione Granger") and its theme. ' +
  'Return ONLY raw JSON (no markdown fences) in this shape: ' +
  '{ "sets": [ { "set_num": string|null, "name": string, "theme": string|null, "year": number|null, "confidence": "high"|"medium"|"low"|"none", "reasoning": string } ], ' +
  '"minifigs": [ { "name": string, "theme": string|null, "confidence": "high"|"medium"|"low"|"none", "reasoning": string } ] }. ' +
  'Use empty arrays when none are present, and confidence "none" when unsure.';

// Shelf Snap: one wide photo of a display shelf / cabinet -> EVERY set on it.
// Same JSON shape as SCAN_SYSTEM_PROMPT so the whole matching pipeline is
// shared; the differences are exhaustiveness (list them all, not the best one)
// and tolerance for tiny/partial views where no number is readable.
export const SHELF_SCAN_PROMPT =
  'You are a LEGO product-identification expert. This photo shows a COLLECTION on a shelf, cabinet or table. ' +
  'Identify EVERY distinct LEGO set visible — built/displayed models AND boxed sets. Do not stop at the most prominent one. ' +
  'For each: if a printed set number is readable, return just the digits in set_num; otherwise identify by official set name, ' +
  'theme, and approximate release year from the model\'s appearance (most display sets have no visible number — a confident ' +
  'name identification is expected and useful). List at most 25 sets, largest/clearest first. Ignore loose parts and non-LEGO items. ' +
  'Return ONLY raw JSON (no markdown fences) in this shape: ' +
  '{ "sets": [ { "set_num": string|null, "name": string, "theme": string|null, "year": number|null, "confidence": "high"|"medium"|"low"|"none", "reasoning": string } ], ' +
  '"minifigs": [] }. ' +
  'Use confidence "none" only when you cannot even guess the set; prefer "low" with your best name guess.';

/**
 * Effective OpenRouter FREE pools. The daily model-refresh cron validates the
 * curated pools above against OpenRouter's live catalog (dropping models that
 * vanished or lost their :free variant, appending a few discovered free ones)
 * and publishes the result to KV. Consumers call this instead of reading the
 * MODELS constants directly; when KV is empty/unavailable (fresh deploy, KV
 * outage, tests) the curated constants are the fallback, so behavior can only
 * improve, never regress.
 */
export async function getOpenRouterPools(env?: Env): Promise<{ vision: string[]; text: string[] }> {
  const fallback = {
    vision: [...MODELS.scanOpenrouterVisionPool],
    text: [...MODELS.openrouterFreePool],
  };
  const kv = env?.CACHE_KV;
  if (!kv) return fallback;
  if (_poolsCache && Date.now() - _poolsCache.at < 5 * 60_000) return _poolsCache.pools;
  try {
    const stored = await kv.get<{ vision?: string[]; text?: string[] }>('ai:or-free-pools', 'json');
    const pools = {
      vision: stored?.vision?.length ? stored.vision : fallback.vision,
      text: stored?.text?.length ? stored.text : fallback.text,
    };
    _poolsCache = { pools, at: Date.now() };
    return pools;
  } catch {
    return fallback;
  }
}
let _poolsCache: { pools: { vision: string[]; text: string[] }; at: number } | null = null;

export function __resetOpenRouterPoolsCacheForTests(): void {
  _poolsCache = null;
}

const GEMINI_DIRECT = 'https://generativelanguage.googleapis.com';

// Cloudflare AI Gateway base: https://gateway.ai.cloudflare.com/v1/{acct}/{gw}
// Returns null when unconfigured so callers fall back to the provider directly.
function gatewayBase(env?: Env): string | null {
  const acct = env?.AI_GATEWAY_ACCOUNT_ID;
  const gw = env?.AI_GATEWAY_ID;
  return acct && gw ? `https://gateway.ai.cloudflare.com/v1/${acct}/${gw}` : null;
}

/**
 * Google AI Studio (Gemini) REST URL.
 * @param routeThroughGateway pass true only for SERVER-key calls; BYOK callers
 *        pass false (default) to hit Google directly.
 */
export function geminiUrl(
  model: string,
  opts: { env?: Env; method?: 'generateContent' | 'streamGenerateContent'; query?: string; routeThroughGateway?: boolean } = {},
): string {
  const { env, method = 'generateContent', query = '', routeThroughGateway = false } = opts;
  const path = `v1beta/models/${model}:${method}${query}`;
  const base = routeThroughGateway ? gatewayBase(env) : null;
  return base ? `${base}/google-ai-studio/${path}` : `${GEMINI_DIRECT}/${path}`;
}

/**
 * OpenAI SDK baseURL override for SERVER-key calls. Returns the gateway-wrapped
 * /openai base when configured, else undefined (SDK uses its default).
 * BYOK OpenAI callers should pass undefined to stay direct.
 */
export function openAIServerBaseURL(env?: Env): string | undefined {
  const base = gatewayBase(env);
  return base ? `${base}/openai` : undefined;
}

// Optional header for an authenticated gateway (BYOK-with-auth). Empty otherwise.
export function gatewayHeaders(env?: Env): Record<string, string> {
  return env?.AI_GATEWAY_TOKEN ? { 'cf-aig-authorization': `Bearer ${env.AI_GATEWAY_TOKEN}` } : {};
}

// Tags a SERVER-key gateway call with custom metadata for AI Gateway analytics
// segmentation (e.g. { workload: 'valuation-cron' } vs { workload: 'scan-shared' }).
// This is the forward hook for per-workload / per-user spend budgets — the
// gateway records the metadata regardless of whether a budget references it yet.
// Harmless on direct (non-gateway) calls: providers ignore the unknown header.
export function gatewayMetadataHeader(meta: Record<string, string | number | boolean>): Record<string, string> {
  return { 'cf-aig-metadata': JSON.stringify(meta) };
}

/**
 * OpenRouter base URL. Routes through the Cloudflare AI Gateway's OpenRouter
 * provider path when the gateway is configured (keeps caching, $/day spend cap,
 * and analytics); otherwise calls OpenRouter directly. Used with the OpenAI SDK
 * as baseURL — OpenRouter is OpenAI-compatible and preserves its `models`
 * fallback-array extension through the provider-native gateway path.
 */
export function openRouterBaseURL(env?: Env): string {
  const base = gatewayBase(env);
  return base ? `${base}/openrouter` : 'https://openrouter.ai/api/v1';
}
