import type { Env } from '../types';
import { fetchWithRetry } from './http';
import { sourceEnabled } from './source-config';
import { brightDataUnlock } from './brightdata';
import { backupFetch } from './backup-scrapers';
import { parseLegoStockHtml } from './brightdata-parsers';
import { spendQuota } from './api-quota';

// LEGO.com's own price in the user's country (Compare stores on the set page).
// The en-us page (lib/lego-stock.ts) gives the US price; a French member wants
// the price lego.com/fr-fr charges them, not the dollar price converted. Read
// on demand when a member opens a set page in that market, kept for a day in
// table lego_local_prices, and never used for valuations.

export const LEGO_LOCAL_MARKETS: Record<string, { locale: string; currency: string }> = {
  FR: { locale: 'fr-fr', currency: 'EUR' },
  DE: { locale: 'de-de', currency: 'EUR' },
  NL: { locale: 'nl-nl', currency: 'EUR' },
  GB: { locale: 'en-gb', currency: 'GBP' },
  CA: { locale: 'en-ca', currency: 'CAD' },
  AU: { locale: 'en-au', currency: 'AUD' },
};

/** A local row older than this is checked again when the set page is opened. */
export const LEGO_LOCAL_MAX_AGE_HOURS = 24;

export function legoLocalMarket(raw: unknown): string | null {
  const m = String(raw || '').toUpperCase();
  return LEGO_LOCAL_MARKETS[m] ? m : null;
}

export function legoLocalUrl(setNum: string, market: string): string {
  const num = setNum.replace(/-\d+$/, '');
  return `https://www.lego.com/${LEGO_LOCAL_MARKETS[market].locale}/product/${num}`;
}

export interface LegoLocalRow {
  set_num: string;
  market: string;
  currency: string;
  price: number | null;
  in_stock: number | null;
  availability: string | null;
  checked_at: string;
}

export interface LegoLocalResult {
  /** 'found' = page read; 'missing' = LEGO.com has no page there; 'unknown' = could not read it. */
  status: 'found' | 'missing' | 'unknown';
  price: number | null;
  in_stock: boolean | null;
  availability: string | null;
}

/**
 * Read lego.com/<locale>/product/<num>: Bright Data first (Iaroslav, 2026-10-27),
 * then Decodo/ZenRows, then a free plain request. No Firecrawl: its credits are
 * kept for the stock and store jobs.
 */
export async function fetchLegoLocalPrice(env: Env, setNum: string, market: string): Promise<LegoLocalResult> {
  const unknown: LegoLocalResult = { status: 'unknown', price: null, in_stock: null, availability: null };
  const spec = LEGO_LOCAL_MARKETS[market];
  if (!spec) return unknown;
  const num = setNum.replace(/-\d+$/, '');
  const url = legoLocalUrl(setNum, market);
  const read = (html: string | null): LegoLocalResult | null => {
    const parsed = html ? parseLegoStockHtml(html, num, spec.currency) : null;
    if (!parsed) return null;
    return { status: 'found', price: parsed.retail_price_usd ?? null, in_stock: parsed.in_stock, availability: parsed.availability ?? null };
  };
  if (await sourceEnabled(env, 'brightdata')) {
    const got = read(await brightDataUnlock(url, env, { timeoutMs: 25_000 }));
    if (got) return got;
  }
  const backup = await backupFetch(url, env, { timeoutMs: 25_000 });
  if (backup.missing) return { status: 'missing', price: null, in_stock: false, availability: null };
  const viaBackup = read(backup.html);
  if (viaBackup) return viaBackup;
  try {
    const resp = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Brickvault/1.0)', Accept: 'text/html' },
      redirect: 'follow',
    }, { retries: 0, timeoutMs: 8000 });
    if (resp.ok) return read(await resp.text()) ?? unknown;
  } catch { /* LEGO.com bot wall */ }
  return unknown;
}

export async function readLegoLocalPrice(env: Env, setNum: string, market: string): Promise<LegoLocalRow | null> {
  return env.DB.prepare(
    `SELECT set_num, market, currency, price, in_stock, availability, checked_at
       FROM lego_local_prices WHERE set_num = ? AND market = ?`,
  ).bind(setNum, market).first<LegoLocalRow>().catch(() => null);
}

export function legoLocalStale(row: LegoLocalRow | null, now = Date.now()): boolean {
  if (!row) return true;
  const t = Date.parse(String(row.checked_at).replace(' ', 'T') + (String(row.checked_at).includes('Z') ? '' : 'Z'));
  return !Number.isFinite(t) || now - t > LEGO_LOCAL_MAX_AGE_HOURS * 3600 * 1000;
}

/**
 * Check the set's local LEGO.com page now and store what it says. Spends one
 * 'lego_local' quota unit; returns false when the daily cap is reached.
 * An unreadable page is stored too (price NULL, availability 'unknown') so a
 * bot wall is not retried on every page view; the card then falls back to the
 * US price.
 */
export async function refreshLegoLocalPrice(env: Env, setNum: string, market: string): Promise<boolean> {
  const spec = LEGO_LOCAL_MARKETS[market];
  if (!spec) return false;
  if (!(await spendQuota(env, 'lego_local', 1))) return false;
  const r = await fetchLegoLocalPrice(env, setNum, market);
  const price = r.price != null && r.price > 0 ? Math.round(r.price * 100) / 100 : null;
  const availability = r.status === 'unknown' ? 'unknown' : r.status === 'missing' ? 'not_sold' : r.availability;
  await env.DB.prepare(
    `INSERT INTO lego_local_prices (set_num, market, currency, price, in_stock, availability, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(set_num, market) DO UPDATE SET currency=excluded.currency, price=excluded.price,
       in_stock=excluded.in_stock, availability=excluded.availability, checked_at=excluded.checked_at`,
  ).bind(setNum, market, spec.currency, price, r.in_stock == null ? null : Number(r.in_stock), availability).run();
  return true;
}
