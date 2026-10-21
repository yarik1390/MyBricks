import OpenAI from 'openai';
import type { Env } from '../types';

/**
 * Dedicated OpenCodex combos for Brickvault scan recognition (hosted on Core01).
 * Single scan leads with Claude Sonnet 5.5 (or Gemini 3.8 Flash), while shelf
 * scan leads with Gemini 3.8 Flash (or Claude Sonnet 5.5). Reordering combo
 * legs in the OpenCodex dashboard re-prices recognition without a deploy.
 */
export const OPENCODEX_SCAN_COMBO = 'brickvault-scan-vision';
export const OPENCODEX_SHELF_COMBO = 'brickvault-shelf-vision';
/**
 * With the Workers VPC binding, the Worker reaches OpenCodex on Core01's
 * loopback through a private Cloudflare Tunnel. The URL host is resolved by
 * the VPC service (127.0.0.1:10100 on Core01), so nothing is exposed publicly.
 */
export const OPENCODEX_VPC_BASE_URL = 'http://127.0.0.1:10100/v1';
const RETRIES = 0;
const MODELS_TTL_MS = 5 * 60_000;
let modelsMemo: { ids: string[]; at: number } | null = null;

export function openCodexBaseURL(env: Env): string | null {
  if (env.OPENCODEX_VPC) return OPENCODEX_VPC_BASE_URL;
  const configured = (env.OPENCODEX_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!configured) return null;
  const target = configured;
  try {
    const url = new URL(target);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    if (url.protocol !== 'https:' && !local) {
      console.warn('[opencodex] base URL must use HTTPS:', target);
      return null;
    }
    return target;
  } catch (e) {
    console.warn('[opencodex] invalid base URL:', target, (e as Error).message);
    return null;
  }
}

export function openCodexConfigured(env: Env): boolean {
  return !!(env.OPENCODEX_API_KEY ?? '').trim() && openCodexBaseURL(env) !== null;
}

export function openCodexClient(env: Env): OpenAI | null {
  const apiKey = (env.OPENCODEX_API_KEY ?? '').trim();
  const baseURL = openCodexBaseURL(env);
  if (!apiKey || !baseURL) return null;

  const defaultHeaders: Record<string, string> = {
    'X-OpenCodex-No-Cache': 'true',
  };
  const vpc = env.OPENCODEX_VPC;
  if (vpc) {
    return new OpenAI({
      apiKey,
      baseURL,
      maxRetries: RETRIES,
      defaultHeaders,
      fetch: (input, init) => vpc.fetch(input as RequestInfo, init as RequestInit),
    });
  }
  // Public HTTPS route (e.g. behind Cloudflare Access) when no VPC binding exists.
  if (env.CF_ACCESS_CLIENT_ID) {
    defaultHeaders['CF-Access-Client-Id'] = env.CF_ACCESS_CLIENT_ID.trim();
  }
  if (env.CF_ACCESS_CLIENT_SECRET) {
    defaultHeaders['CF-Access-Client-Secret'] = env.CF_ACCESS_CLIENT_SECRET.trim();
  }

  return new OpenAI({
    apiKey,
    baseURL,
    maxRetries: RETRIES,
    defaultHeaders,
    fetch: (input, init) => fetch(input, init),
  });
}

/** Model ids the gateway serves (GET /models), for the admin route picker. */
export async function openCodexModels(env: Env): Promise<string[]> {
  if (modelsMemo && Date.now() - modelsMemo.at < MODELS_TTL_MS) return modelsMemo.ids;
  const client = openCodexClient(env);
  if (!client) return [OPENCODEX_SCAN_COMBO, OPENCODEX_SHELF_COMBO];
  try {
    const page = await client.models.list({ timeout: 5_000 });
    const ids = page.data.map((m) => m.id).filter(Boolean);
    if (!ids.includes(OPENCODEX_SCAN_COMBO)) ids.push(OPENCODEX_SCAN_COMBO);
    if (!ids.includes(OPENCODEX_SHELF_COMBO)) ids.push(OPENCODEX_SHELF_COMBO);
    ids.sort();
    modelsMemo = { ids, at: Date.now() };
    return ids;
  } catch (e) {
    console.warn('[opencodex] model list failed:', (e as Error).message);
    return [OPENCODEX_SCAN_COMBO, OPENCODEX_SHELF_COMBO];
  }
}
