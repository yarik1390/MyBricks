import type { Env } from '../types';
import { fetchTracked } from './http';

const EBAY_SCOPE_MARKETPLACE_INSIGHTS = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';
const EBAY_MARKETPLACE_ID = 'EBAY_US';
const MIN_VALID_SOLD_COMPS = 3;

let tokenCache: { token: string; expiresAt: number; scope: string } | null = null;

export type EbaySoldStatus = 'ok' | 'partial' | 'no_data' | 'unconfigured' | 'unauthorized' | 'error';
export type EbaySoldCondition = 'new' | 'used';

export interface EbayConditionPricing {
  value: number | null;
  sample_count: number;
  valid_count: number;
  filtered_count: number;
  error?: string | null;
}

export interface EbaySoldPrices {
  source: 'marketplace_insights';
  status: EbaySoldStatus;
  new_value: number | null;
  used_value: number | null;
  new_sample_count: number;
  used_sample_count: number;
  error?: string | null;
}

interface MarketplaceSaleItem {
  title?: string;
  price?: {
    value?: string | number;
    currency?: string;
    currencyCode?: string;
  };
}

const USED_CONDITIONS = 'USED_EXCELLENT|USED_VERY_GOOD|USED_GOOD|USED_ACCEPTABLE';

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const mid = Math.floor(values.length / 2);
  if (values.length % 2) return values[mid];
  return (values[mid - 1] + values[mid]) / 2;
}

export function summarizeSoldPrices(prices: number[]): EbayConditionPricing {
  const sorted = prices.filter(p => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  if (sorted.length < MIN_VALID_SOLD_COMPS) {
    return { value: null, sample_count: sorted.length, valid_count: sorted.length, filtered_count: sorted.length };
  }

  const rawMedian = median(sorted);
  if (!rawMedian) {
    return { value: null, sample_count: sorted.length, valid_count: sorted.length, filtered_count: sorted.length };
  }

  const filtered = sorted.filter(p => p >= rawMedian / 3 && p <= rawMedian * 3);
  if (filtered.length < MIN_VALID_SOLD_COMPS) {
    return { value: null, sample_count: filtered.length, valid_count: sorted.length, filtered_count: filtered.length };
  }

  const value = median(filtered);
  return {
    value: value == null ? null : roundMoney(value),
    sample_count: filtered.length,
    valid_count: sorted.length,
    filtered_count: filtered.length,
  };
}

function hasConfiguredEbaySecrets(env: Env): boolean {
  return !!(
    env.EBAY_APP_ID &&
    env.EBAY_CLIENT_SECRET &&
    !env.EBAY_APP_ID.includes('dummy') &&
    !env.EBAY_CLIENT_SECRET.includes('dummy')
  );
}

async function getEbayApplicationToken(
  env: Env,
  scope: string,
  options: { recordHealth?: boolean } = {},
): Promise<string | null> {
  if (!hasConfiguredEbaySecrets(env)) return null;
  if (tokenCache && tokenCache.scope === scope && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const credentials = btoa(`${env.EBAY_APP_ID}:${env.EBAY_CLIENT_SECRET}`);
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope });
  const resp = await fetchTracked(env, 'ebay', 'https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body,
  }, { retries: 1, timeoutMs: 8000, record: options.recordHealth !== false });

  if (!resp.ok) return null;
  const data = await resp.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) return null;

  tokenCache = {
    token: data.access_token,
    scope,
    expiresAt: Date.now() + Math.max(60, data.expires_in ?? 7200) * 1000,
  };
  return tokenCache.token;
}

function cleanKeywords(setNum: string): string {
  return `LEGO ${setNum.replace(/-1$/i, '')}`.slice(0, 80);
}

function titleHasSetNumber(title: string, setNum: string): boolean {
  const base = String(setNum || '').replace(/-1$/i, '').replace(/[^\d]/g, '');
  if (!base) return false;
  const re = new RegExp(`(^|[^0-9])${base}(?:-1)?([^0-9]|$)`, 'i');
  return re.test(title);
}

const BAD_TITLE_PATTERNS = [
  /\binstructions?\b/i,
  /\bmanual\b/i,
  /\b(empty\s+)?box\s+only\b/i,
  /\bbox\s+no\s+set\b/i,
  /\b(no|without)\s+(mini)?fig/i,
  /\bmini(?:fig|figure)s?\s+only\b/i,
  /\bparts?\s+only\b/i,
  /\bpieces?\s+only\b/i,
  /\bincomplete\b/i,
  /\bmissing\b/i,
  /\breplacement\b/i,
  /\bstickers?\b/i,
  /\bdecals?\b/i,
  /\bcustom\b/i,
  /\bmoc\b/i,
  /\bbulk\s+lot\b/i,
  /\blot\s+of\b/i,
  /\bdisplay\s+case\b/i,
  /\bcase\s+only\b/i,
];

export function isValidLegoSetSaleTitle(title: string, setNum: string): boolean {
  const normalized = String(title || '').replace(/\s+/g, ' ').trim();
  if (!titleHasSetNumber(normalized, setNum)) return false;
  return !BAD_TITLE_PATTERNS.some(re => re.test(normalized));
}

function priceFromSale(item: MarketplaceSaleItem, setNum: string): number | null {
  if (!isValidLegoSetSaleTitle(item.title || '', setNum)) return null;
  const currency = item.price?.currency || item.price?.currencyCode || 'USD';
  if (String(currency).toUpperCase() !== 'USD') return null;
  const value = Number(item.price?.value ?? NaN);
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function fetchMarketplaceInsightsCondition(
  token: string,
  setNum: string,
  condition: EbaySoldCondition,
  env: Env,
  options: { recordHealth?: boolean } = {},
): Promise<EbayConditionPricing> {
  const params = new URLSearchParams({
    q: cleanKeywords(setNum),
    limit: '50',
    filter: condition === 'new' ? 'conditions:{NEW}' : `conditions:{${USED_CONDITIONS}}`,
  });
  const resp = await fetchTracked(
    env,
    'ebay',
    `https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE_ID,
      },
    },
    { retries: 1, timeoutMs: 10000, record: options.recordHealth !== false },
  );

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const data = await resp.json() as { itemSales?: MarketplaceSaleItem[] };
  const prices = (data.itemSales || [])
    .map(item => priceFromSale(item, setNum))
    .filter((price): price is number => price != null);
  return summarizeSoldPrices(prices);
}

export async function fetchEbaySoldPrices(
  setNum: string,
  setName: string,
  env: Env,
  options: { recordHealth?: boolean } = {},
): Promise<EbaySoldPrices> {
  void setName;
  if (!hasConfiguredEbaySecrets(env)) {
    return {
      source: 'marketplace_insights',
      status: 'unconfigured',
      new_value: null,
      used_value: null,
      new_sample_count: 0,
      used_sample_count: 0,
      error: 'EBAY_APP_ID and EBAY_CLIENT_SECRET are required for eBay sold comps.',
    };
  }

  let token: string | null = null;
  try {
    token = await getEbayApplicationToken(env, EBAY_SCOPE_MARKETPLACE_INSIGHTS, options);
  } catch (error) {
    const message = (error as Error).message || String(error);
    return {
      source: 'marketplace_insights',
      status: /401|403|authorized|scope|permission/i.test(message) ? 'unauthorized' : 'error',
      new_value: null,
      used_value: null,
      new_sample_count: 0,
      used_sample_count: 0,
      error: message,
    };
  }
  if (!token) {
    return {
      source: 'marketplace_insights',
      status: 'unauthorized',
      new_value: null,
      used_value: null,
      new_sample_count: 0,
      used_sample_count: 0,
      error: 'eBay OAuth token request failed.',
    };
  }

  const [newResult, usedResult] = await Promise.all([
    fetchMarketplaceInsightsCondition(token, setNum, 'new', env, options).catch((error) => ({
      value: null,
      sample_count: 0,
      valid_count: 0,
      filtered_count: 0,
      error: (error as Error).message || String(error),
    })),
    fetchMarketplaceInsightsCondition(token, setNum, 'used', env, options).catch((error) => ({
      value: null,
      sample_count: 0,
      valid_count: 0,
      filtered_count: 0,
      error: (error as Error).message || String(error),
    })),
  ]);

  const hasValue = newResult.value != null || usedResult.value != null;
  const hadSamples = newResult.valid_count > 0 || usedResult.valid_count > 0;
  const errors = [newResult.error, usedResult.error].filter(Boolean).join('; ') || null;
  const unauthorized = /401|403|authorized|scope|permission/i.test(errors || '');
  const status: EbaySoldStatus = hasValue
    ? (newResult.value != null && usedResult.value != null ? 'ok' : 'partial')
    : errors
      ? (unauthorized ? 'unauthorized' : 'error')
      : hadSamples
        ? 'no_data'
        : 'no_data';

  return {
    source: 'marketplace_insights',
    status,
    new_value: newResult.value,
    used_value: usedResult.value,
    new_sample_count: newResult.sample_count,
    used_sample_count: usedResult.sample_count,
    error: errors,
  };
}

export function ebaySoldNewValue(prices: EbaySoldPrices | null | undefined): number | null {
  return prices?.new_value ?? null;
}

export function ebaySoldUsedValue(prices: EbaySoldPrices | null | undefined): number | null {
  return prices?.used_value ?? null;
}

export function ebaySoldAttempted(prices: EbaySoldPrices | null | undefined): boolean {
  return !!prices && prices.status !== 'unconfigured';
}

export function ebaySoldHasValue(prices: EbaySoldPrices | null | undefined): boolean {
  return ebaySoldNewValue(prices) != null || ebaySoldUsedValue(prices) != null;
}

export function buildEbaySoldUpdate(
  db: D1Database,
  setNum: string,
  prices: EbaySoldPrices | null | undefined,
): D1PreparedStatement | null {
  if (!prices || prices.status === 'unconfigured') return null;
  const attempted = ebaySoldAttempted(prices) ? 1 : 0;
  const hasNewValue = prices.new_value != null ? 1 : 0;
  return db.prepare(`
    UPDATE lego_sets SET
      ebay_new_value=COALESCE(?, ebay_new_value),
      ebay_new_qty=CASE WHEN ? IS NULL THEN ebay_new_qty ELSE ? END,
      ebay_new_cached_at=CASE WHEN ? = 1 THEN datetime('now') ELSE ebay_new_cached_at END,
      ebay_used_value=COALESCE(?, ebay_used_value),
      ebay_used_qty=CASE WHEN ? IS NULL THEN ebay_used_qty ELSE ? END,
      ebay_used_cached_at=CASE WHEN ? = 1 THEN datetime('now') ELSE ebay_used_cached_at END,
      ebay_value=COALESCE(?, ebay_value),
      ebay_cached_at=CASE WHEN ? = 1 THEN datetime('now') ELSE ebay_cached_at END
    WHERE set_num=?
  `).bind(
    prices.new_value,
    prices.new_sample_count, prices.new_sample_count,
    attempted,
    prices.used_value,
    prices.used_sample_count, prices.used_sample_count,
    attempted,
    prices.new_value,
    hasNewValue,
    setNum,
  );
}

export function __resetEbayTokenCacheForTests() {
  tokenCache = null;
}
