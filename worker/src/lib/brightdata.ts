import type { Env } from '../types';
import { isValidLegoSetSaleTitle, summarizeSoldPrices } from './ebay';
import { brightDataSoldEnabled } from './pricing-flags';
import { pickKey, recordKeyCall } from './brightdata-keys';

// Bright Data Web Unlocker REST contract (verified): POST /request with a Bearer
// token, body { zone, url, format:"raw", method, country }. format "raw" returns
// the unlocked page HTML in the response body. Zone is account-specific
// (web_unlocker1 by default for this account; override via BRIGHTDATA_ZONE).
const BD_ENDPOINT = 'https://api.brightdata.com/request';
const DEFAULT_ZONE = 'web_unlocker1';

export interface EbaySoldScrapeResult {
  status: 'ok' | 'no_data' | 'disabled' | 'error';
  new_value: number | null;
  new_count: number;
  /** Most-recent sale date among the matched comps (YYYY-MM-DD), when captured. */
  new_last_sold?: string | null;
  error?: string | null;
}

const NAME_STOP = new Set([
  'lego', 'the', 'set', 'ideas', 'star', 'wars', 'ultimate', 'collector', 'series',
  'building', 'kit', 'new', 'sealed', 'retired', 'creator', 'expert', 'icons', 'and',
  'with', 'edition',
]);

function nameTokens(name: string): string[] {
  return (name.toLowerCase().match(/[a-z]+/g) || []).filter(t => t.length >= 4 && !NAME_STOP.has(t));
}

// Stricter than isValidLegoSetSaleTitle alone: also require a distinctive set-name
// token and drop multi-number parts/compatibility listings. Phase-0 validation
// showed bare-number matching pollutes collision-prone old set numbers (e.g.
// "10018" appearing in parts-compatibility lists and other UCS listings).
function titleMatches(title: string, setNum: string, name: string): boolean {
  if (!isValidLegoSetSaleTitle(title, setNum)) return false;
  if (new Set(title.match(/\b\d{4,6}\b/g) || []).size >= 3) return false;
  const toks = nameTokens(name);
  if (toks.length) {
    const tl = title.toLowerCase();
    if (!toks.some(t => tl.includes(t))) return false;
  }
  return true;
}

// Parse eBay sold-search HTML into title/price pairs in document order. eBay's
// current markup is s-card__title / s-card__price (was s-item__*); try s-card,
// fall back to s-item. Skips the leading "Shop on eBay" placeholder card.
function parseCards(html: string): Array<{ title: string; price: number }> {
  const pair = (titles: string[], prices: string[]) => {
    const out: Array<{ title: string; price: number }> = [];
    const n = Math.min(titles.length, prices.length);
    for (let i = 0; i < n; i++) {
      const t = titles[i].replace(/\s+/g, ' ').trim();
      if (/^shop on ebay/i.test(t)) continue;
      const p = parseFloat(prices[i].replace(/,/g, ''));
      if (Number.isFinite(p) && p > 0) out.push({ title: t, price: p });
    }
    return out;
  };
  let titles = [...html.matchAll(/s-card__title[^>]*>(?:\s*<[^>]+>)*\s*([^<]{5,170})/g)].map(m => m[1]);
  let prices = [...html.matchAll(/s-card__price[^>]*>(?:\s*<[^>]+>)*\s*\$([\d,]+\.\d{2})/g)].map(m => m[1]);
  let pairs = pair(titles, prices);
  if (!pairs.length) {
    titles = [...html.matchAll(/class="s-item__title"[^>]*>(?:\s*<[^>]+>)*\s*([^<]{5,170})/g)].map(m => m[1]);
    prices = [...html.matchAll(/class="s-item__price"[^>]*>(?:\s*<[^>]+>)*\s*\$([\d,]+\.\d{2})/g)].map(m => m[1]);
    pairs = pair(titles, prices);
  }
  return pairs;
}

async function unlock(env: Env, url: string, token: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(BD_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone: env.BRIGHTDATA_ZONE || DEFAULT_ZONE,
        url,
        format: 'raw',
        method: 'GET',
        country: 'US',
      }),
      signal: ctrl.signal,
    });
    return { status: resp.status, body: await resp.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Scrape eBay US NEW-condition SOLD comps for a set via Bright Data Web Unlocker,
 * filter titles (set number + distinctive name token, drop parts/multi-number),
 * and summarize to a median (>=3 comps, outliers trimmed — reuses lib/ebay.ts).
 * Retries once on the ~30% transient unlocker failures. Returns new_value to be
 * written to ebay_new_value as a CORROBORATING sold source.
 */
export async function fetchEbaySoldViaBrightData(
  setNum: string,
  setName: string,
  env: Env,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<EbaySoldScrapeResult> {
  if (!brightDataSoldEnabled(env)) return { status: 'disabled', new_value: null, new_count: 0 };
  const base = setNum.replace(/-\d+$/, '');
  const q = encodeURIComponent(`LEGO ${base} ${setName || ''}`.trim());
  const url = `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=1000&_ipg=60`;
  const retries = options.retries ?? 1;
  let lastErr: string | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Rotate across the pooled tokens, each call spends one token's monthly
    // budget; a drained/dead token is marked exhausted so the next attempt picks
    // a different one. Null = every token is out of budget for the month.
    const picked = await pickKey(env);
    if (!picked) { lastErr = 'no live Bright Data token (monthly budget drained)'; break; }
    try {
      const { status, body } = await unlock(env, url, picked.key, options.timeoutMs ?? 60000);
      // Auth / payment / forbidden → this token is dead or out of credits: mark it
      // exhausted (so pickKey skips it) and fail over to the next token.
      if (status === 401 || status === 402 || status === 403) {
        await recordKeyCall(env, picked, { exhausted: true });
        lastErr = `Bright Data HTTP ${status}`;
        continue;
      }
      await recordKeyCall(env, picked);
      if (status !== 200 || !body || body.length < 50000) { lastErr = `HTTP ${status} short body (${body ? body.length : 0})`; continue; }
      const prices = parseCards(body)
        .filter(p => titleMatches(p.title, setNum, setName))
        .map(p => p.price);
      const summary = summarizeSoldPrices(prices);
      if (summary.value != null) return { status: 'ok', new_value: summary.value, new_count: summary.sample_count };
      return { status: 'no_data', new_value: null, new_count: 0 };
    } catch (e) {
      lastErr = (e as Error)?.message || String(e);
    }
  }
  return { status: 'error', new_value: null, new_count: 0, error: lastErr };
}
