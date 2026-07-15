import type { Env } from '../types';
import { pricesapiEnabled } from './pricing-flags';
import {
  recordIntegrationAttempt,
  isIntegrationBlocked,
  setIntegrationBlock,
} from './integration-health';
import { pickKey, recordKeyCall } from './pricesapi-keys';
import { isPlausibleMarketValue } from './valuation';

// ---------------------------------------------------------------------------
// pricesAPI.io client — live retail + marketplace offers across major retailers.
//
//   GET https://api.pricesapi.io/api/v1/products/search?q=…&country=…&limit=…
//   Authorization: Bearer pricesapi_…
//
// This is NOT a value anchor. It answers "where can I buy this now and for how
// much", feeding the deal signal, in-stock truth, and wishlist price-drop alerts.
// Calls are SYNCHRONOUS and cold ones take 30–90s, so this is cron-only (never on
// a request path). Each key has a ~1000/month budget tracked by lib/pricesapi-keys.
// The helper FAILS OPEN to null on any error — pricing never depends on it.
// ---------------------------------------------------------------------------

const PA_BASE = 'https://api.pricesapi.io/api/v1';
const DEFAULT_TIMEOUT_MS = 95_000; // cold calls run 30–90s; doc recommends ~95s
const CACHE_TTL_S = 43_200; // 12h — spare the precious monthly budget

export interface PricesApiResult {
  /** Headline candidate price (the "retail" anchor). */
  retail_value: number | null;
  /** Cheapest in-stock offer across merchants. */
  lowest_offer: number | null;
  /** True when live purchasable offers exist (and the offers stage wasn't degraded). */
  in_stock: boolean;
  /** Seller of the cheapest offer — the buy-CTA destination. */
  best_merchant: string | null;
  /** Number of merchant offers returned for the top candidate. */
  offer_count: number;
  /** ISO country/market the result came from. */
  market: string;
  currency: string;
  item_price: number | null;
  delivered_price: number | null;
  offer_url: string | null;
  matched_title: string | null;
}

interface PaOffer {
  seller?: string;
  seller_url?: string;
  price?: number;
  currency?: string;
  shipping?: number | null;
  condition?: string;
  url?: string;
}

interface PaCandidate {
  pid?: number;
  title?: string;
  source?: string;
  price?: number;
  currency?: string;
  offerCount?: number;
  offers?: PaOffer[];
  upc?: string;
  gtin?: string;
}

interface PaResponse {
  success?: boolean;
  data?: { query?: string; country?: string; products?: PaCandidate[] };
  meta?: { degraded?: boolean; cache_source?: string };
  // Error body
  error?: string;
  code?: string;
}

export interface PricesApiOptions {
  country?: string;
  limit?: number;
  offersLimit?: number;
  timeoutMs?: number;
  setNum?: string;
  setName?: string;
  upc?: string | null;
}

function market(env: Env, opts: PricesApiOptions): string {
  return (opts.country || env.PRICESAPI_MARKET || 'us').toLowerCase();
}

function titleTokens(value: string): string[] {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter(token => token.length > 2 && !['lego', 'set', 'with', 'the', 'and'].includes(token));
}

export function pricesApiCandidateMatches(candidate: PaCandidate, opts: PricesApiOptions): boolean {
  if (!opts.setNum && !opts.upc) return true;
  const candidateUpc = String(candidate.upc || candidate.gtin || '').replace(/\D/g, '');
  const expectedUpc = String(opts.upc || '').replace(/\D/g, '');
  if (expectedUpc && candidateUpc && candidateUpc === expectedUpc) return true;
  const title = String(candidate.title || '');
  const base = String(opts.setNum || '').replace(/-\d+$/, '');
  if (!base || !new RegExp(`(?:#|\\b)${base}(?:\\b|-)`, 'i').test(title)) return false;
  const expected = titleTokens(String(opts.setName || ''));
  if (!expected.length) return true;
  const actual = new Set(titleTokens(title));
  return expected.filter(token => actual.has(token)).length / expected.length >= 0.5;
}

function normalize(resp: PaResponse, country: string, opts: PricesApiOptions): PricesApiResult | null {
  const candidate = resp.data?.products?.find(product => pricesApiCandidateMatches(product, opts));
  if (!candidate) return null;

  const retail =
    typeof candidate.price === 'number' && candidate.price > 0 ? candidate.price : null;

  // Offers are returned cheapest-first, but don't assume — pick the true min of
  // positive offer prices, and carry its seller as the buy destination.
  const offers = (candidate.offers ?? []).filter(
    (o): o is PaOffer & { price: number } => typeof o.price === 'number' && o.price > 0,
  );
  const delivered = (offer: PaOffer & { price: number }) => offer.price + Math.max(0, Number(offer.shipping || 0));
  offers.sort((a, b) => delivered(a) - delivered(b));
  const cheapest = offers[0] ?? null;

  const offerCount = Number(candidate.offerCount ?? offers.length) || 0;
  // Stock truth: live purchasable offers exist and the offers stage wasn't degraded.
  const inStock = offerCount > 0 && offers.length > 0 && resp.meta?.degraded !== true;

  // Plausibility gate (shared with the valuation sources) so a junk scrape never
  // poisons the deal signal.
  const retailValue = retail && isPlausibleMarketValue(retail, {}) ? retail : null;
  const deliveredPrice = cheapest ? delivered(cheapest) : null;
  const lowestOffer =
    deliveredPrice && isPlausibleMarketValue(deliveredPrice, {}) ? deliveredPrice : null;

  return {
    retail_value: retailValue,
    lowest_offer: lowestOffer,
    in_stock: inStock,
    best_merchant: cheapest?.seller ?? candidate.source ?? null,
    offer_count: offerCount,
    market: country,
    currency: cheapest?.currency || candidate.currency || 'USD',
    item_price: cheapest?.price ?? retailValue,
    delivered_price: lowestOffer,
    offer_url: cheapest?.url || cheapest?.seller_url || null,
    matched_title: candidate.title || null,
  };
}

/**
 * Search pricesAPI for a product. Returns null on any failure (disabled, blocked,
 * all keys drained, network/parse error, no match). Never throws.
 *
 * Caches successful normalized results in KV (`pa:<country>:<query>`, 12h) to
 * spare the precious per-key monthly budget.
 */
export async function pricesApiSearch(
  query: string,
  env: Env,
  opts: PricesApiOptions = {},
): Promise<PricesApiResult | null> {
  if (!pricesapiEnabled(env)) return null;
  if (await isIntegrationBlocked(env, 'pricesapi')) return null;

  const country = market(env, opts);
  const cacheKey = `pa:${country}:${query.toLowerCase()}`;
  if (env.CACHE_KV) {
    try {
      const cached = await env.CACHE_KV.get<PricesApiResult>(cacheKey, 'json');
      if (cached) return cached;
    } catch {
      /* cache miss is fine */
    }
  }

  const picked = await pickKey(env);
  if (!picked) {
    // All keys drained for the month — record so admin sees the pool is empty.
    await recordIntegrationAttempt(env, 'pricesapi', false, 'all keys drained for the month');
    return null;
  }

  const limit = Math.max(1, Math.min(opts.limit ?? 1, 5));
  const offersLimit = Math.max(1, Math.min(opts.offersLimit ?? 10, 20));
  const params = new URLSearchParams({
    q: query,
    country,
    limit: String(limit),
    offers_limit: String(offersLimit),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(`${PA_BASE}/products/search?${params}`, {
      headers: { Authorization: `Bearer ${picked.key}` },
      signal: controller.signal,
    });

    // 403 CREDITS_EXCEEDED (monthly drained) or 401 INVALID_API_KEY (dead) →
    // retire this key for the month and let the next cron pick another.
    if (resp.status === 403 || resp.status === 401) {
      await recordKeyCall(env, picked, { exhausted: true });
      await recordIntegrationAttempt(env, 'pricesapi', false, `key exhausted (HTTP ${resp.status})`);
      return null;
    }
    // 429 RATE_LIMIT_EXCEEDED — per-minute cap (6/min free). Brief block, no drain.
    if (resp.status === 429) {
      await recordKeyCall(env, picked);
      await setIntegrationBlock(env, 'pricesapi', 1);
      await recordIntegrationAttempt(env, 'pricesapi', false, 'rate limited (HTTP 429)');
      return null;
    }
    // 503 SCRAPER_* — transient, no bill. Respect Retry-After-ish backoff.
    if (resp.status === 503) {
      await setIntegrationBlock(env, 'pricesapi', 1);
      await recordIntegrationAttempt(env, 'pricesapi', false, 'scraper unavailable (HTTP 503)');
      return null;
    }
    if (!resp.ok) {
      await recordKeyCall(env, picked);
      await recordIntegrationAttempt(env, 'pricesapi', false, `HTTP ${resp.status}`);
      return null;
    }

    // A billed call — count it against the key's monthly budget.
    await recordKeyCall(env, picked);
    const body = (await resp.json()) as PaResponse;
    const result = normalize(body, country, opts);
    await recordIntegrationAttempt(env, 'pricesapi', true);

    if (result && env.CACHE_KV) {
      env.CACHE_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: CACHE_TTL_S }).catch(() => {});
    }
    return result;
  } catch (e) {
    // Timeouts/aborts/network — don't drain the key (cold-call abort is common).
    await recordIntegrationAttempt(env, 'pricesapi', false, (e as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
