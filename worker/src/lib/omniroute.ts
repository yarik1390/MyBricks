import OpenAI from 'openai';
import type { Env } from '../types';

/**
 * Dedicated OmniRoute combo for Brickvault scan recognition (created in the
 * OmniRoute gateway: id b46bdc30-228e-4fac-aa85-a2d27517178a). Calling this
 * alias routes through the combo's priority chain — today: OpenRouter
 * google/gemini-3.5-flash-lite (live hard-image benchmark 5/5, ~1.8s,
 * ~$0.0007/scan), then the Antigravity Gemini 3.7 subscription lane ($0
 * marginal cost) as a bonus when it is healthy. Reordering the combo's legs in
 * the OmniRoute dashboard re-prices recognition without a Brickvault deploy.
 */
export const OMNIROUTE_SCAN_COMBO = 'brickvault-scan-vision';
const DEFAULT_BASE_URL = 'https://omniroute-production-5920.up.railway.app/v1';
const RETRIES = 0;

export function omniRouteEnabled(env: Env): boolean {
  return !!(env.OMNIROUTE_API_KEY ?? '').trim();
}

export function omniRouteBaseURL(env: Env): string {
  const configured = (env.OMNIROUTE_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!configured) return DEFAULT_BASE_URL;
  const url = new URL(configured);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  if (url.protocol !== 'https:' && !local) throw new Error('OmniRoute base URL must use HTTPS');
  return configured;
}

export function omniRouteClient(env: Env): OpenAI | null {
  const apiKey = (env.OMNIROUTE_API_KEY ?? '').trim();
  if (!apiKey) return null;
  return new OpenAI({
    apiKey,
    baseURL: omniRouteBaseURL(env),
    maxRetries: RETRIES,
    defaultHeaders: {
      'X-OmniRoute-No-Cache': 'true',
    },
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (response.ok) assertOmniRouteHeaders(response.headers);
      return response;
    },
  });
}

/**
 * OmniRoute combo legs vary (OpenRouter anchor or Antigravity subscription
 * lane), so the old single-route pin no longer applies. What must still hold
 * is that a REAL upstream leg answered: provider+model headers must be present
 * and the response must not be an OmniRoute cache hit. Recognition accuracy is
 * gated downstream by the catalog matcher, not by these headers.
 */
export function assertOmniRouteHeaders(headers: Headers): void {
  const provider = (headers.get('x-omniroute-provider') ?? '').trim().toLowerCase();
  const model = (headers.get('x-omniroute-model') ?? '').trim().toLowerCase();
  const cacheHit = (headers.get('x-omniroute-cache-hit') ?? '').trim().toLowerCase();
  if (!provider || !model) {
    throw new Error(`OmniRoute route mismatch (${provider || 'missing'}/${model || 'missing'})`);
  }
  if (cacheHit !== 'false') {
    throw new Error(`OmniRoute cache status rejected (${cacheHit || 'missing'})`);
  }
}
