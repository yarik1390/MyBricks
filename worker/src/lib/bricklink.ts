import type { Env } from '../types';
import { fetchTracked } from './http';

export interface BrickLinkPricing {
  current_value: number;
  lot_count: number;
  min_price: number | null;
  max_price: number | null;
}

// KV-cached entries may predate fields added later (min/max price) — missing
// fields parse as undefined, which D1's bind() rejects. Normalize on read.
const finiteOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function normalizeNewPricing(raw: Partial<BrickLinkPricing> | null): BrickLinkPricing | null {
  if (!raw || typeof raw !== 'object') return null;
  const current_value = finiteOrNull(raw.current_value);
  if (current_value === null) return null;
  return {
    current_value,
    lot_count: finiteOrNull(raw.lot_count) ?? 0,
    min_price: finiteOrNull(raw.min_price),
    max_price: finiteOrNull(raw.max_price),
  };
}

const brickLinkPriceUrl = (type: 'SET' | 'MINIFIG' | 'PART', no: string) =>
  `https://api.bricklink.com/api/store/v1/items/${type}/${encodeURIComponent(no)}/price`;

async function oauthHeader(
  method: string,
  url: string,
  queryParams: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  token: string,
  tokenSecret: string,
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: '1.0',
  };

  const all = { ...queryParams, ...oauth };
  const paramStr = Object.keys(all).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`)
    .join('&');

  const baseString = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(paramStr)].join('&');
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(baseString));
  oauth.oauth_signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  return 'OAuth ' + Object.entries(oauth)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(', ');
}

export interface BrickLinkUsedPricing {
  used_value: number;
  lot_count: number;
  min_price: number | null;
  max_price: number | null;
}

function normalizeUsedPricing(raw: Partial<BrickLinkUsedPricing> | null): BrickLinkUsedPricing | null {
  if (!raw || typeof raw !== 'object') return null;
  const used_value = finiteOrNull(raw.used_value);
  if (used_value === null) return null;
  return {
    used_value,
    lot_count: finiteOrNull(raw.lot_count) ?? 0,
    min_price: finiteOrNull(raw.min_price),
    max_price: finiteOrNull(raw.max_price),
  };
}

export async function fetchUsedPricing(
  setNum: string,
  env: Env,
  options: { recordHealth?: boolean; retries?: number; timeoutMs?: number } = {},
): Promise<BrickLinkUsedPricing | null> {
  if (!env.BRICKLINK_CONSUMER_KEY) return null;
  const blNum = setNum.includes('-') ? setNum : `${setNum}-1`;
  try {
    const cacheKey = `bl:used:${blNum}`;
    if (env.CACHE_KV) {
      const cached = normalizeUsedPricing(await env.CACHE_KV.get(cacheKey, 'json'));
      if (cached) return cached;
    }

    const baseUrl = brickLinkPriceUrl('SET', blNum);
    const queryParams = { guide_type: 'sold', new_or_used: 'U', currency_code: 'USD' };
    const authHeader = await oauthHeader(
      'GET', baseUrl, queryParams,
      env.BRICKLINK_CONSUMER_KEY, env.BRICKLINK_CONSUMER_SECRET,
      env.BRICKLINK_TOKEN, env.BRICKLINK_TOKEN_SECRET,
    );
    const resp = await fetchTracked(env, 'bricklink', `${baseUrl}?${new URLSearchParams(queryParams)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }, {
      okStatuses: [404],
      record: options.recordHealth !== false,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
    });
    // 404 → set has no used sold-guide entry (genuine no-data). Any other non-ok
    // or API-error status is transient/credential — throw so a source outage is
    // distinguishable from real no-data and reported accurately in run health.
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`bricklink used-sold HTTP ${resp.status}`);
    const body = await resp.json() as { meta?: { code: number }; data?: Record<string, unknown> };
    if (body.meta?.code !== 200) throw new Error(`bricklink used-sold API code ${body.meta?.code ?? 'none'}`);
    if (!body.data) return null;
    const d = body.data;
    const lotCount = Number(d.unit_quantity ?? 0);
    if (lotCount < 3) return null;
    const used = parseFloat(String(d.qty_avg_price || d.avg_price || '')) || null;
    if (!used) return null;
    const minPrice = parseFloat(String(d.min_price || '')) || null;
    const maxPrice = parseFloat(String(d.max_price || '')) || null;
    const result = { used_value: used, lot_count: lotCount, min_price: minPrice, max_price: maxPrice };
    if (env.CACHE_KV) env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 21600 }).catch(() => {});
    return result;
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function fetchSetPricing(
  setNum: string,
  env: Env,
  options: { recordHealth?: boolean; retries?: number; timeoutMs?: number } = {},
): Promise<BrickLinkPricing | null> {
  if (!env.BRICKLINK_CONSUMER_KEY) return null;

  // BrickLink item numbers always include the variant suffix (e.g. "75192-1")
  const blNum = setNum.includes('-') ? setNum : `${setNum}-1`;

  try {
    const cacheKey = `bl:new:${blNum}`;
    if (env.CACHE_KV) {
      const cached = normalizeNewPricing(await env.CACHE_KV.get(cacheKey, 'json'));
      if (cached) return cached;
    }

    const baseUrl = brickLinkPriceUrl('SET', blNum);
    const queryParams = { guide_type: 'sold', new_or_used: 'N', currency_code: 'USD' };

    const authHeader = await oauthHeader(
      'GET', baseUrl, queryParams,
      env.BRICKLINK_CONSUMER_KEY, env.BRICKLINK_CONSUMER_SECRET,
      env.BRICKLINK_TOKEN, env.BRICKLINK_TOKEN_SECRET,
    );

    const resp = await fetchTracked(env, 'bricklink', `${baseUrl}?${new URLSearchParams(queryParams)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }, {
      okStatuses: [404],
      record: options.recordHealth !== false,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
    });
    // A 404 means the set genuinely has no BrickLink sold-guide entry → no data
    // (a legitimate reason to back the set off). Any OTHER non-ok status is a
    // transient/credential failure (429/5xx after retries, or 401/403) — THROW
    // so callers can tell "the source failed" apart from "the set has no data"
    // and never stamp a 90-day no-data backoff on a transient blip.
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`bricklink new-sold HTTP ${resp.status}`);

    const body = await resp.json() as { meta?: { code: number }; data?: Record<string, unknown> };
    if (body.meta?.code !== 200) throw new Error(`bricklink new-sold API code ${body.meta?.code ?? 'none'}`);
    if (!body.data) return null; // code 200 but empty guide → genuine no-data

    const d = body.data;
    const lotCount = Number(d.unit_quantity ?? 0);
    if (lotCount < 5) return null; // require ≥5 sold lots for reliable pricing (genuine no-data)

    const current = parseFloat(String(d.qty_avg_price || d.avg_price || '')) || null;
    if (!current) return null; // lots present but no usable price → no-data

    const minPrice = parseFloat(String(d.min_price || '')) || null;
    const maxPrice = parseFloat(String(d.max_price || '')) || null;

    const result = { current_value: current, lot_count: lotCount, min_price: minPrice, max_price: maxPrice };
    if (env.CACHE_KV) env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 21600 }).catch(() => {});
    return result;
  } catch (err) {
    // Re-throw transient failures (network/abort/HTTP/API) so the caller can
    // distinguish a source outage from genuine no-data. The no-key guard sits
    // outside the try, so "not configured" still returns null (not an error).
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export interface PartPricing {
  price_new: number | null; // per-unit NEW sold avg (qty-weighted), USD
  qty_new: number;          // sold lot count backing the price
}

/**
 * NEW-condition per-unit sold price for a single part in a single color, from
 * the BrickLink price guide. Powers the part_prices cache behind the part-out
 * (sum-of-parts) value. NEW only (1 call/part) to stay light on the shared
 * BrickLink budget; the part-out headline is a sealed-set metric. KV-cached for
 * a week — part prices drift slowly, and the cache is reused across every set
 * containing the part.
 */
export async function fetchPartPricing(
  partNum: string,
  colorId: number,
  env: Env,
  options: { recordHealth?: boolean; retries?: number; timeoutMs?: number } = {},
): Promise<PartPricing | null> {
  if (!env.BRICKLINK_CONSUMER_KEY) return null;
  try {
    const cacheKey = `bl:part:${partNum}:${colorId}`;
    if (env.CACHE_KV) {
      const cached = await env.CACHE_KV.get(cacheKey, 'json') as PartPricing | null;
      if (cached && typeof cached.price_new === 'number') return cached;
    }

    const baseUrl = brickLinkPriceUrl('PART', partNum);
    const queryParams = { color_id: String(colorId), guide_type: 'sold', new_or_used: 'N', currency_code: 'USD' };
    const authHeader = await oauthHeader(
      'GET', baseUrl, queryParams,
      env.BRICKLINK_CONSUMER_KEY, env.BRICKLINK_CONSUMER_SECRET,
      env.BRICKLINK_TOKEN, env.BRICKLINK_TOKEN_SECRET,
    );
    const resp = await fetchTracked(env, 'bricklink', `${baseUrl}?${new URLSearchParams(queryParams)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }, {
      okStatuses: [404],
      record: options.recordHealth !== false,
      retries: options.retries,
      timeoutMs: options.timeoutMs,
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`BrickLink part guide failed: ${resp.status}`);
    const body = await resp.json() as { meta?: { code: number }; data?: Record<string, unknown> };
    if (body.meta?.code !== 200 || !body.data) return null;
    const d = body.data;
    const qty = Number(d.unit_quantity ?? 0);
    const price = parseFloat(String(d.qty_avg_price || d.avg_price || '')) || null;
    if (!price || price <= 0) return null;
    const result: PartPricing = { price_new: price, qty_new: qty };
    if (env.CACHE_KV) env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 7 * 86400 }).catch(() => {});
    return result;
  } catch (error) {
    throw error;
  }
}

export interface MinifigPricing {
  value: number | null; // NEW-condition qty-weighted sold avg, USD
  lots: number;        // sold lot count (market liquidity / confidence signal)
}

// NEW-condition minifig sold price from the BrickLink guide. Now also returns
// the sold lot count (free from the same call) so the rarity model can factor
// market liquidity. Returns null only on a hard failure (no key / bad response).
export async function fetchMinifigPricing(
  figNum: string,
  env: Env,
  options: { recordHealth?: boolean } = {},
): Promise<MinifigPricing | null> {
  if (!env.BRICKLINK_CONSUMER_KEY) return null;
  try {
    const baseUrl = brickLinkPriceUrl('MINIFIG', figNum);
    const queryParams = { guide_type: 'sold', new_or_used: 'N', currency_code: 'USD' };
    const authHeader = await oauthHeader(
      'GET', baseUrl, queryParams,
      env.BRICKLINK_CONSUMER_KEY, env.BRICKLINK_CONSUMER_SECRET,
      env.BRICKLINK_TOKEN, env.BRICKLINK_TOKEN_SECRET,
    );
    const resp = await fetchTracked(env, 'bricklink', `${baseUrl}?${new URLSearchParams(queryParams)}`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    }, { okStatuses: [404], record: options.recordHealth !== false });
    if (resp.status === 404) return { value: null, lots: 0 };
    if (!resp.ok) throw new Error(`BrickLink minifig guide failed: ${resp.status}`);
    const body = await resp.json() as { meta?: { code: number }; data?: Record<string, unknown> };
    if (body.meta?.code !== 200 || !body.data) return null;
    const d = body.data;
    const value = parseFloat(String(d.qty_avg_price || d.avg_price || '')) || null;
    const lots = Number(d.unit_quantity ?? 0) || 0;
    return { value, lots };
  } catch (error) {
    throw error;
  }
}
