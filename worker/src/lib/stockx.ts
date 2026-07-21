import type { Env } from '../types';
import { pickKey, recordKeyCall } from './brightdata-keys';
import { firecrawlScrape } from './firecrawl';

// ---------------------------------------------------------------------------
// StockX lowest-ask scrape (Bright Data Web Unlocker).
//
// StockX blocks plain fetches and renders every price client-side, so it needs
// the Web Unlocker's rendered fetch (confirmed via the admin `stockx` probe —
// ~30-45s per call, so this ONLY runs from a background cron, never a sync
// request). We read the SEARCH page, which server-renders one product tile per
// result with its Lowest Ask, so a single call yields the ask for a set.
//
// StockX only lists sealed/new sets, and an ASK is a listing price (a ceiling),
// not a sold comp — so callers treat stockx_ask as a CORROBORATING new-condition
// signal (like eBay active listings), never a primary sold value. Fails closed.
// ---------------------------------------------------------------------------

const BD_ENDPOINT = 'https://api.brightdata.com/request';
const DEFAULT_ZONE = 'web_unlocker1';

export interface StockXResult {
  status: 'ok' | 'no_data' | 'error';
  ask: number | null;
  /** Matched StockX product path, e.g. "/lego-eiffel-tower-set-10307". */
  url: string | null;
  error?: string | null;
}

async function unlock(env: Env, url: string, token: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(BD_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: env.BRIGHTDATA_ZONE || DEFAULT_ZONE, url, format: 'raw', method: 'GET', country: 'US' }),
      signal: ctrl.signal,
    });
    return { status: resp.status, body: await resp.text() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse StockX search HTML for a set's Lowest Ask. Finds the product tile whose
 * slug ends "-set-<baseNum>" (exact number, so 10307 never matches 103070), then
 * reads the $-price nearest the "Lowest Ask" label inside that tile. Pure +
 * defensive: returns nulls on any miss. Exported for unit tests.
 */
export function parseStockXSearch(html: string, setNum: string): { ask: number | null; url: string | null } {
  const base = setNum.replace(/-\d+$/, '');
  // Tile anchors: href="/lego-<slug>-set-<num>". Require the number to terminate
  // the slug (closing quote) so a longer number can't false-match.
  const linkRe = new RegExp(`href="(/lego-[a-z0-9-]+-set-${base})"`, 'i');
  const m = linkRe.exec(html);
  if (!m) return { ask: null, url: null };
  const url = m[1];

  // Scope to this product's tile: from its link to the next product link.
  const start = m.index;
  const nextIdx = html.indexOf('productTile-ProductSwitcherLink', start + 1);
  const region = html.slice(start, nextIdx > start ? nextIdx : start + 4000);

  const priceRe = /\$([\d,]+)/g;
  // Basic sanity only — collectible sets legitimately ask into the thousands, so
  // value plausibility is NOT judged here. The enrich job's corroboration gate
  // (StockX ask within ~3x of a BrickLink/BE value) rejects wrong-item matches.
  const toNum = (s: string) => {
    const v = parseFloat(s.replace(/,/g, ''));
    return Number.isFinite(v) && v > 0 && v < 100_000 ? v : null;
  };

  // Prefer the $-price nearest the "Lowest Ask" label (robust to the value
  // sitting either before or after the label in the markup).
  const la = region.search(/Lowest Ask/i);
  if (la >= 0) {
    const from = Math.max(0, la - 140);
    const win = region.slice(from, la + 140);
    const labelPos = la - from;
    let best: { v: number; d: number } | null = null;
    for (const pm of win.matchAll(priceRe)) {
      const v = toNum(pm[1]);
      if (v == null) continue;
      const d = Math.abs((pm.index ?? 0) - labelPos);
      if (!best || d < best.d) best = { v, d };
    }
    if (best) return { ask: best.v, url };
  }

  // Fallback: first plausible $-price anywhere in the tile region.
  for (const pm of region.matchAll(priceRe)) {
    const v = toNum(pm[1]);
    if (v != null) return { ask: v, url };
  }
  return { ask: null, url };
}

const SEARCH_URL = (setNum: string) =>
  `https://stockx.com/search?s=${encodeURIComponent(`lego ${setNum.replace(/-\d+$/, '')}`)}`;

/**
 * Fetch a set's StockX lowest ask via FIRECRAWL (rendered HTML, ~1 credit).
 * Preferred for BULK backfill — Firecrawl's large credit allotment scales far
 * past Bright Data's small daily pool. `proxy: 'stealth'` + a render wait give
 * StockX's client-rendered prices time to appear. Firecrawl self-meters credits
 * and records its own health; returns null on any failure.
 */
export async function fetchStockXViaFirecrawl(
  setNum: string,
  _setName: string,
  env: Env,
  options: { timeoutMs?: number } = {},
): Promise<StockXResult> {
  const res = await firecrawlScrape<{ html?: string }>(
    { url: SEARCH_URL(setNum), formats: ['html'], proxy: 'stealth', waitFor: 3500, timeoutMs: options.timeoutMs ?? 45_000 },
    env,
  );
  const html = res?.data?.html;
  if (!html || html.length < 20_000) return { status: 'error', ask: null, url: null, error: 'firecrawl: empty/short body' };
  const parsed = parseStockXSearch(html, setNum);
  if (parsed.ask == null) return { status: 'no_data', ask: null, url: parsed.url };
  return { status: 'ok', ask: parsed.ask, url: parsed.url };
}

/**
 * Fetch a set's StockX lowest ask via Bright Data Web Unlocker. Gated by the
 * caller (feature flag + source tuning). Marks a dead/credit-exhausted token so
 * the pool rotates. Never throws.
 */
export async function fetchStockXMarket(
  setNum: string,
  _setName: string,
  env: Env,
  options: { timeoutMs?: number } = {},
): Promise<StockXResult> {
  const picked = await pickKey(env);
  if (!picked) return { status: 'error', ask: null, url: null, error: 'no live Bright Data token (monthly budget drained)' };
  const base = setNum.replace(/-\d+$/, '');
  const url = `https://stockx.com/search?s=${encodeURIComponent(`lego ${base}`)}`;
  try {
    const { status, body } = await unlock(env, url, picked.key, options.timeoutMs ?? 55000);
    if (status === 401 || status === 402 || status === 403) {
      await recordKeyCall(env, picked, { exhausted: true });
      return { status: 'error', ask: null, url: null, error: `Bright Data HTTP ${status}` };
    }
    await recordKeyCall(env, picked);
    if (status !== 200 || !body || body.length < 50000) {
      return { status: 'error', ask: null, url: null, error: `HTTP ${status} short body (${body ? body.length : 0})` };
    }
    const parsed = parseStockXSearch(body, setNum);
    if (parsed.ask == null) return { status: 'no_data', ask: null, url: parsed.url };
    return { status: 'ok', ask: parsed.ask, url: parsed.url };
  } catch (e) {
    return { status: 'error', ask: null, url: null, error: (e as Error)?.message || String(e) };
  }
}
