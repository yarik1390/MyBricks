import type { Env } from '../types';
import { fetchTracked } from './http';
import { sourceEnabled } from './source-config';

const EBAY_MARKETPLACE_ID = 'EBAY_US';
const MIN_VALID_SOLD_COMPS = 3;

let tokenCache: { token: string; expiresAt: number; scope: string } | null = null;

export interface EbayConditionPricing {
  value: number | null;
  sample_count: number;
  valid_count: number;
  filtered_count: number;
}

interface EbayListingItem {
  title?: string;
  price?: {
    value?: string | number;
    currency?: string;
    currencyCode?: string;
  };
}

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

export function isEbayAccessError(error?: string | null): boolean {
  return !!error && /HTTP 401|HTTP 403|invalid[_ -]?client|invalid[_ -]?scope|access denied|insufficient permissions|not authorized|unauthorized|marketplace insights access/i.test(error);
}

async function ebayErrorMessage(resp: Response, context: string): Promise<string> {
  const body = await resp.text().catch(() => '');
  let detail = body.trim();
  if (detail) {
    try {
      const parsed = JSON.parse(detail) as {
        error?: string;
        error_description?: string;
        errors?: Array<{ message?: string; longMessage?: string; errorId?: number; domain?: string }>;
      };
      const first = parsed.errors?.[0];
      detail = parsed.error_description
        || parsed.error
        || first?.longMessage
        || first?.message
        || detail;
      if (first?.errorId || first?.domain) {
        detail = `${detail} (${[first.domain, first.errorId].filter(Boolean).join(' ')})`;
      }
    } catch {
      detail = detail.slice(0, 240);
    }
  }
  return `${context} HTTP ${resp.status}${detail ? `: ${detail}` : ''}`;
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

  if (!resp.ok) {
    throw new Error(await ebayErrorMessage(resp, 'eBay OAuth'));
  }
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
  // Accessory listings that quote the set number they fit. A keyword search
  // for a popular set is dominated by these (the UCS Falcon's "asking price"
  // came out at $89.95 from LED kits), so they must never count as the set.
  // "light-up" / "light up" stay allowed: several real set names contain them.
  /\bled\b/i,
  /\blight(?:ing)?\s+(?:kit|set)\b/i,
  /\blighting\b/i,
  /\b(?:display|wall)\s+(?:stand|mount|frame|shelf)\b/i,
  /\bstand\s+(?:for|only)\b/i,
  /\bacrylic\b/i,
  /\bdust\s*(?:proof|cover)\b/i,
  /\bcompatible\b/i,
  /\b(?:kit|stand|case|lights?|upgrade)\s+for\b/i,
  /\bupgrade\s+(?:kit|pack)\b/i,
  /\bnot\s+included\b/i,
  /\bposter\b/i,
];

export function isValidLegoSetSaleTitle(title: string, setNum: string): boolean {
  const normalized = String(title || '').replace(/\s+/g, ' ').trim();
  if (!titleHasSetNumber(normalized, setNum)) return false;
  return !BAD_TITLE_PATTERNS.some(re => re.test(normalized));
}

function priceFromListing(item: EbayListingItem, setNum: string): number | null {
  if (!isValidLegoSetSaleTitle(item.title || '', setNum)) return null;
  const currency = item.price?.currency || item.price?.currencyCode || 'USD';
  if (String(currency).toUpperCase() !== 'USD') return null;
  const value = Number(item.price?.value ?? NaN);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const EBAY_SCOPE_BASIC = 'https://api.ebay.com/oauth/api_scope';

export interface EbayActiveListings {
  ask_value: number | null;
  ask_qty: number;
  error?: string | null;
}

/**
 * Supply-side signal: median asking price and count of current eBay listings
 * via the Browse API. The basic api_scope is
 * available to every eBay keyset, so this works wherever OAuth works at all.
 */
export async function fetchEbayActiveListings(
  setNum: string,
  setName: string,
  env: Env,
  options: { recordHealth?: boolean } = {},
): Promise<EbayActiveListings | null> {
  void setName;
  if (!hasConfiguredEbaySecrets(env)) return null;
  // Honor the master eBay source switch on every path (crons already gate this;
  // user-facing set-detail refreshes used to bypass it).
  if (!(await sourceEnabled(env, 'ebay'))) return null;

  let token: string | null = null;
  try {
    token = await getEbayApplicationToken(env, EBAY_SCOPE_BASIC, options);
  } catch (error) {
    return { ask_value: null, ask_qty: 0, error: (error as Error).message || String(error) };
  }
  if (!token) return { ask_value: null, ask_qty: 0, error: 'eBay OAuth token request failed.' };

  const params = new URLSearchParams({
    q: cleanKeywords(setNum),
    limit: '50',
    filter: 'buyingOptions:{FIXED_PRICE},conditions:{NEW}',
  });

  try {
    const resp = await fetchTracked(
      env,
      'ebay',
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
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
      return { ask_value: null, ask_qty: 0, error: await ebayErrorMessage(resp, 'eBay Browse') };
    }

    const data = await resp.json() as {
      itemSummaries?: Array<{ title?: string; price?: { value?: string | number; currency?: string } }>;
    };
    const prices = (data.itemSummaries || [])
      .map(item => priceFromListing(item, setNum))
      .filter((price): price is number => price != null);
    const summary = summarizeSoldPrices(prices);
    return { ask_value: summary.value, ask_qty: summary.sample_count, error: null };
  } catch (error) {
    return { ask_value: null, ask_qty: 0, error: (error as Error).message || String(error) };
  }
}

export function buildEbayAskUpdate(
  db: D1Database,
  setNum: string,
  listings: EbayActiveListings | null | undefined,
): D1PreparedStatement | null {
  if (!listings || listings.error) return null;
  return db.prepare(`
    UPDATE lego_sets SET
      ebay_ask_value=?,
      ebay_ask_qty=?,
      ebay_ask_cached_at=datetime('now')
    WHERE set_num=?
  `).bind(listings.ask_value, listings.ask_qty, setNum);
}

export function __resetEbayTokenCacheForTests() {
  tokenCache = null;
}
