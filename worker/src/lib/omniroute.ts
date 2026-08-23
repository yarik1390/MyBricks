import OpenAI from 'openai';
import type { Env } from '../types';

export const OMNIROUTE_SCAN_MODEL = 'antigravity/gemini-3.5-flash-low';
export const OMNIROUTE_ROUTE_PROVIDER = 'antigravity';
export const OMNIROUTE_ROUTE_MODEL = 'gemini-3.5-flash-low';
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
 * OmniRoute can route one model id to many accounts/providers. Scan accuracy was
 * established specifically for the Antigravity Gemini route, so a silent route
 * change is a failed attempt and must fall through to the next provider.
 */
export function assertOmniRouteHeaders(headers: Headers): void {
  const provider = (headers.get('x-omniroute-provider') ?? '').trim().toLowerCase();
  const model = (headers.get('x-omniroute-model') ?? '').trim().toLowerCase();
  const cacheHit = (headers.get('x-omniroute-cache-hit') ?? '').trim().toLowerCase();
  if (provider !== OMNIROUTE_ROUTE_PROVIDER || model !== OMNIROUTE_ROUTE_MODEL) {
    throw new Error(`OmniRoute route mismatch (${provider || 'missing'}/${model || 'missing'})`);
  }
  if (cacheHit !== 'false') {
    throw new Error(`OmniRoute cache status rejected (${cacheHit || 'missing'})`);
  }
}
