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
  status: 'ok' | 'partial' | 'no_data' | 'disabled' | 'error';
  new_value: number | null;
  new_count: number;
  /** Most-recent sale date among the matched comps (YYYY-MM-DD), when captured. */
  new_last_sold?: string | null;
  used_value?: number | null;
  used_count?: number;
  /** Most-recent used-condition sale date (YYYY-MM-DD), when captured. */
  used_last_sold?: string | null;
  error?: string | null;
}

type ConditionResult = {
  status: 'ok' | 'no_data' | 'error';
  value: number | null;
  count: number;
  error?: string | null;
};

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

function unwrapResponseBody(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(trimmed) as { body?: unknown };
    return typeof parsed.body === 'string' ? parsed.body : raw;
  } catch {
    return raw;
  }
}

function blockedPageReason(html: string): string | null {
  const lower = html.toLowerCase();
  const markers = [
    'pardon our interruption',
    'verify you are human',
    'security measure',
    'captcha-delivery',
    'access denied',
    'robot check',
  ];
  const marker = markers.find((candidate) => lower.includes(candidate));
  return marker ? `blocked page: ${marker}` : null;
}

function isExplicitNoResultsPage(html: string): boolean {
  return /0 results|no exact matches found|we looked everywhere|no results for/i.test(html);
}

/** Parse a Bright Data response without assuming a minimum HTML byte size. */
export function analyzeEbaySoldHtml(raw: string, setNum: string, setName: string): ConditionResult {
  const html = unwrapResponseBody(raw);
  const blocked = blockedPageReason(html);
  if (blocked) return { status: 'error', value: null, count: 0, error: blocked };

  const cards = parseCards(html);
  if (cards.length) {
    const prices = cards
      .filter((card) => titleMatches(card.title, setNum, setName))
      .map((card) => card.price);
    const summary = summarizeSoldPrices(prices);
    return summary.value == null
      ? { status: 'no_data', value: null, count: 0 }
      : { status: 'ok', value: summary.value, count: summary.sample_count };
  }

  if (isExplicitNoResultsPage(html)) return { status: 'no_data', value: null, count: 0 };
  return {
    status: 'error',
    value: null,
    count: 0,
    error: `unparseable body (${html.length} bytes)`,
  };
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
 * Scrape eBay US SOLD comps for a set via Bright Data Web Unlocker, separated
 * into new/sealed and used/complete condition requests. Titles are filtered by
 * set number plus a distinctive name token, then summarized to robust medians.
 * Retries once on transient unlocker or blocked-page failures.
 */
export async function fetchEbaySoldViaBrightData(
  setNum: string,
  setName: string,
  env: Env,
  options: { timeoutMs?: number; retries?: number; includeNew?: boolean; includeUsed?: boolean } = {},
): Promise<EbaySoldScrapeResult> {
  if (!brightDataSoldEnabled(env)) return { status: 'disabled', new_value: null, new_count: 0 };
  const base = setNum.replace(/-\d+$/, '');
  const q = encodeURIComponent(`LEGO ${base} ${setName || ''}`.trim());
  const retries = options.retries ?? 1;
  const includeNew = options.includeNew !== false;
  const includeUsed = options.includeUsed !== false;

  const fetchCondition = async (conditionId: 1000 | 3000): Promise<ConditionResult> => {
    const url = `https://www.ebay.com/sch/i.html?_nkw=${q}&LH_Sold=1&LH_Complete=1&LH_ItemCondition=${conditionId}&_ipg=60`;
    let lastErr: string | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      // Rotate across the pooled tokens, each call spends one token's monthly
      // budget; a drained/dead token is marked exhausted so the next attempt picks
      // a different one. Null = every token is out of budget for the month.
      const picked = await pickKey(env);
      if (!picked) { lastErr = 'no live Bright Data token (monthly budget drained)'; break; }
      try {
        // 12s, not 25s. Live production evidence (integration_health, checked
        // 2026-08-09): Bright Data's real eBay-sold requests have been timing out
        // on essentially every call for 17 straight days (last_ok_at stuck at
        // 2026-07-23) — this looks like an eBay-side bot-detection interaction
        // Bright Data's unlocker can't get past, not a transient blip, so a call
        // that hasn't answered by ~10-12s is not going to. A healthy unlock
        // returns in ~2s; the old 25s ceiling meant two conditions x two attempts
        // could burn 100s per set doing nothing but waiting on a target that was
        // never going to answer, starving the Firecrawl rescue of the wall-clock
        // budget it needed within the same invocation. Failing fast doesn't fix
        // the underlying provider/target issue, but it frees that budget back up.
        const { status, body } = await unlock(env, url, picked.key, options.timeoutMs ?? 12000);
        if (status === 401 || status === 402 || status === 403) {
          await recordKeyCall(env, picked, { exhausted: true });
          lastErr = `Bright Data HTTP ${status}: ${body.slice(0, 200)}`;
          continue;
        }
        await recordKeyCall(env, picked);
        if (status !== 200 || !body) {
          // Carry the provider's OWN explanation. This used to report only
          // "HTTP 502 (N bytes)", which is why a six-day eBay outage could not be
          // told apart from a bad token without reading the vendor console —
          // Bright Data puts the actual reason (zone, target block, upstream
          // status) in this body.
          lastErr = `Bright Data HTTP ${status} (${body ? body.length : 0} bytes)${body ? `: ${body.slice(0, 200)}` : ''}`;
          // A 5xx is the unlocker telling us the TARGET refused it, not a
          // transport blip. Retrying immediately with another token buys the same
          // answer at twice the cost — let the Firecrawl rescue take it instead.
          if (status >= 500) break;
          continue;
        }
        const analyzed = analyzeEbaySoldHtml(body, setNum, setName);
        if (analyzed.status !== 'error') return analyzed;
        lastErr = analyzed.error || 'unparseable Bright Data response';
      } catch (e) {
        lastErr = (e as Error)?.message || String(e);
      }
    }
    return { status: 'error', value: null, count: 0, error: lastErr };
  };

  const skipped: ConditionResult = { status: 'no_data', value: null, count: 0 };
  // Keep the two condition requests sequential: a scrape job already runs several
  // sets concurrently, and Workers permit only six simultaneous outbound sockets.
  const newResult = includeNew ? await fetchCondition(1000) : skipped;
  const usedResult = includeUsed ? await fetchCondition(3000) : skipped;
  const statuses = [includeNew ? newResult.status : null, includeUsed ? usedResult.status : null].filter(Boolean);
  const hasValue = newResult.value != null || usedResult.value != null;
  const hasError = statuses.includes('error');
  const status: EbaySoldScrapeResult['status'] = hasValue
    ? (hasError ? 'partial' : 'ok')
    : (hasError ? 'error' : 'no_data');

  return {
    status,
    new_value: newResult.value,
    new_count: newResult.count,
    used_value: usedResult.value,
    used_count: usedResult.count,
    error: [newResult.error, usedResult.error].filter(Boolean).join(' | ') || null,
  };
}
