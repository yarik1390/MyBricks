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
  // DeepSeek via the gateway's OpenAI-compatible endpoint: model is "<provider>/<model>".
  deepseek: 'deepseek/deepseek-chat',
} as const;

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

/**
 * Base URL for the gateway's OpenAI-compatible endpoint (one schema, many
 * providers via a "<provider>/<model>" model string, e.g. "deepseek/deepseek-chat").
 * Returns undefined when the gateway isn't configured, so callers that depend on
 * it (DeepSeek) cleanly skip. Used with the OpenAI SDK as baseURL.
 */
export function gatewayCompatBaseURL(env?: Env): string | undefined {
  const base = gatewayBase(env);
  return base ? `${base}/compat` : undefined;
}
