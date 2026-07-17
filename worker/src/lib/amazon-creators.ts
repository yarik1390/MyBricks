import type { Env } from '../types';
import type { AmazonCachedOffer, AmazonMarket } from './amazon';
import { recordIntegrationHealth } from './integration-health';

/**
 * Amazon Creators API client (the PA-API 5 successor; PA-API retired May 2026).
 *
 * Auth: OAuth2 client-credentials (LWA) — Credential ID + Secret from Associates
 * Central, scope `creatorsapi::default`, token cached in KV (~1h validity; Amazon
 * requires caching — re-fetching per call burns the quota).
 * API: POST https://creatorsapi.amazon/catalog/v1/searchItems with the target
 * marketplace in the `x-marketplace` header (one endpoint for all locales).
 *
 * Eligibility: an approved Associates account with >= 10 qualifying sales in the
 * trailing 30 days. Below that, credentials are suspended — every call 403s, so
 * the caller keeps AMAZON_CREATORS_ENABLED off until the account qualifies.
 *
 * COMPLIANCE: offers are cached in KV for <= 24h and NEVER persisted to D1 —
 * Associates terms forbid storing/republishing price data beyond a day, so an
 * Amazon price is an ephemeral acquisition signal, never a valuation comp and
 * never part of retail_price_history.
 */

// Credential region (NA/EU/FE) sets the LWA token host; the product endpoint is
// shared. Marketplaces map onto the credential's region.
const TOKEN_HOSTS: Record<string, string> = {
  NA: 'https://api.amazon.com/auth/o2/token',
  EU: 'https://api.amazon.co.uk/auth/o2/token',
  FE: 'https://api.amazon.co.jp/auth/o2/token',
};

const MARKET_REGION: Record<AmazonMarket, keyof typeof TOKEN_HOSTS> = {
  US: 'NA', CA: 'NA',
  FR: 'EU', GB: 'EU', DE: 'EU',
  AU: 'FE',
};

const MARKETPLACE_HEADER: Record<AmazonMarket, string> = {
  US: 'www.amazon.com',
  CA: 'www.amazon.ca',
  FR: 'www.amazon.fr',
  GB: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  AU: 'www.amazon.com.au',
};

const API_BASE = 'https://creatorsapi.amazon/catalog/v1';

export function creatorsTokenEndpoint(market: AmazonMarket): string {
  return TOKEN_HOSTS[MARKET_REGION[market] || 'EU'];
}

async function getAccessToken(env: Env, market: AmazonMarket): Promise<string | null> {
  const region = MARKET_REGION[market] || 'EU';
  const cacheKey = `amazon:creators:token:${region}`;
  if (env.CACHE_KV) {
    const cached = await env.CACHE_KV.get(cacheKey).catch(() => null);
    if (cached) return cached;
  }
  const res = await fetch(creatorsTokenEndpoint(market), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: env.AMAZON_CREATORS_PUBLIC_KEY,
      client_secret: env.AMAZON_CREATORS_PRIVATE_KEY,
      scope: 'creatorsapi::default',
    }),
  });
  if (!res.ok) throw new Error(`creators token HTTP ${res.status}`);
  const data = await res.json<{ access_token?: string; expires_in?: number }>();
  if (!data.access_token) throw new Error('creators token missing access_token');
  if (env.CACHE_KV) {
    // Cache until shortly before expiry (Amazon: cache the token, don't re-mint).
    const ttl = Math.max(60, Math.min(3600, Number(data.expires_in) || 3600) - 60);
    await env.CACHE_KV.put(cacheKey, data.access_token, { expirationTtl: ttl }).catch(() => {});
  }
  return data.access_token;
}

// The response is parsed defensively: probe the PA-API-style shapes without
// trusting any one of them, and return null rather than a half-read offer.
const asNum = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

function itemTitle(item: Record<string, any>): string {
  return String(item?.itemInfo?.title?.displayValue ?? item?.title ?? '');
}

function extractPrice(item: Record<string, any>): { amount: number; currency: string; availability: string | null } | null {
  const listings = item?.offersV2?.listings ?? item?.offers?.listings ?? [];
  const list = Array.isArray(listings) ? listings : [listings];
  for (const listing of list) {
    if (!listing) continue;
    const price = listing.price ?? {};
    const amount = asNum(price?.money?.amount) ?? asNum(price?.amount) ?? asNum(price?.value);
    if (amount == null) continue;
    const currency = String(price?.money?.currencyCode ?? price?.currencyCode ?? price?.currency ?? 'USD').toUpperCase();
    const availabilityRaw = listing.availability?.type ?? listing.availability ?? null;
    const availability = availabilityRaw == null ? null : String(availabilityRaw);
    return { amount, currency, availability };
  }
  return null;
}

/**
 * Search the Creators API for a LEGO set's live Amazon offer on one marketplace.
 * Identity discipline mirrors the rest of the pricing engine: the item title
 * must contain the bare set number, or the offer is discarded — a wrong-item
 * price is worse than no price. Returns null on any failure (non-fatal source).
 */
export async function fetchAmazonCreatorsOffer(
  env: Env,
  set: { set_num: string; name?: string | null },
  market: AmazonMarket,
): Promise<AmazonCachedOffer | null> {
  if (!env.AMAZON_CREATORS_PUBLIC_KEY || !env.AMAZON_CREATORS_PRIVATE_KEY) return null;
  const baseNum = set.set_num.replace(/-\d+$/, '');
  try {
    const token = await getAccessToken(env, market);
    if (!token) return null;

    const partnerTag = market === 'FR' ? (env.AMAZON_PARTNER_TAG_FR_WEB || undefined) : undefined;
    const res = await fetch(`${API_BASE}/searchItems`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'x-marketplace': MARKETPLACE_HEADER[market],
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        keywords: `LEGO ${baseNum}`,
        itemCount: 5,
        ...(partnerTag ? { partnerTag, partnerType: 'Associates' } : {}),
        resources: [
          'itemInfo.title',
          'offersV2.listings.price',
          'offersV2.listings.availability',
          'images.primary.medium',
        ],
      }),
    });
    if (res.status === 401 || res.status === 403) {
      // Suspended/ineligible credentials (the 10-sales/30-days gate) — surface
      // as a health failure so the admin panel explains why offers stopped.
      throw new Error(`creators API access denied (HTTP ${res.status}) — check Associates eligibility`);
    }
    if (!res.ok) throw new Error(`creators searchItems HTTP ${res.status}`);
    const data = await res.json<Record<string, any>>();
    const items: Record<string, any>[] = data?.searchResult?.items ?? data?.items ?? [];

    for (const item of items) {
      const title = itemTitle(item);
      if (!title.includes(baseNum)) continue; // identity check — never price the wrong item
      const price = extractPrice(item);
      if (!price) continue;
      await recordIntegrationHealth(env, 'amazon', { ok: 1, fail: 0 }).catch(() => {});
      return {
        asin: String(item.asin ?? ''),
        price: price.amount,
        currency: price.currency,
        availability: price.availability,
        url: String(item.detailPageURL ?? item.detailPageUrl ?? `https://${MARKETPLACE_HEADER[market]}/dp/${item.asin ?? ''}`),
        fetched_at: new Date().toISOString(),
      };
    }
    // Clean response, no identity-matched offer — an OK call, just no data.
    await recordIntegrationHealth(env, 'amazon', { ok: 1, fail: 0 }).catch(() => {});
    return null;
  } catch (e) {
    await recordIntegrationHealth(env, 'amazon', { ok: 0, fail: 1, lastError: (e as Error).message }).catch(() => {});
    console.warn(`[amazon-creators] ${set.set_num} (${market}) failed:`, (e as Error).message);
    return null;
  }
}
