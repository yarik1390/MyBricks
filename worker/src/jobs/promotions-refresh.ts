import type { Env } from '../types';
import { firecrawlScrape } from '../lib/firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { sourceEnabled } from '../lib/source-config';
import { rawPageAvailable, fetchRawPage, llmExtractJson, pageText } from '../lib/page-extract';
import { PROMO_MARKETS, PROMO_SCHEMA, normalizePromo, promoKey, promoLooksForeign, promoPages, promoPrompt } from '../lib/promotions';

type Extracted = { data: { promotions?: Record<string, unknown>[] } };
type MarketResult = { pages: number; seen: number; added: number };

/**
 * Read every LEGO.com store's offers pages (en-us, fr-fr, de-de, ...) and
 * upsert what they announce into promotions, one row set per store, with that
 * store's own minimum spend and currency. Bright Data first (Iaroslav,
 * 2026-10-27), Firecrawl's structured extraction when Bright Data can't serve
 * a page. A row the admin hid stays hidden; an admin-entered row is never
 * overwritten.
 */
export async function runPromotionsRefresh(
  env: Env,
  opts: { markets?: string[] } = {},
): Promise<{ pages: number; seen: number; added: number; markets?: Record<string, MarketResult>; skipped?: string }> {
  const useFirecrawl = firecrawlEnabled(env) && (await sourceEnabled(env, 'firecrawl'));
  const useBrightData = await rawPageAvailable(env);
  if (!useFirecrawl && !useBrightData) {
    return { pages: 0, seen: 0, added: 0, skipped: 'Firecrawl and Bright Data disabled' };
  }
  const today = new Date().toISOString().slice(0, 10);
  const markets = (opts.markets || Object.keys(PROMO_MARKETS)).filter((m) => PROMO_MARKETS[m]);
  // Stores run side by side so seven countries fit the cron's time budget.
  const results = await Promise.all(markets.map((m) =>
    refreshMarket(env, m, today, useFirecrawl, useBrightData).catch(() => ({ pages: 0, seen: 0, added: 0 }))));
  const byMarket: Record<string, MarketResult> = {};
  markets.forEach((m, i) => { byMarket[m] = results[i]; });
  const sum = (k: keyof MarketResult) => results.reduce((n, r) => n + r[k], 0);
  return { pages: sum('pages'), seen: sum('seen'), added: sum('added'), markets: byMarket };
}

async function refreshMarket(env: Env, market: string, today: string, useFirecrawl: boolean, useBrightData: boolean): Promise<MarketResult> {
  const { currency } = PROMO_MARKETS[market];
  const prompt = promoPrompt(today, currency);
  let pages = 0;
  let seen = 0;
  let added = 0;
  for (const url of promoPages(market)) {
    let res: Extracted | null = useBrightData ? await promotionsViaBrightData(env, url, prompt) : null;
    if (!res && useFirecrawl) {
      res = await firecrawlScrape<{ promotions?: Record<string, unknown>[] }>({
        url,
        formats: ['json'],
        jsonOptions: { schema: PROMO_SCHEMA, prompt },
        waitFor: 2000,
        timeoutMs: 30_000,
      }, env).catch(() => null) as Extracted | null;
    }
    if (!res) continue;
    pages++;
    for (const raw of res.data?.promotions || []) {
      const p = normalizePromo(raw, market);
      if (!p) continue;
      // An offer that already ended is history, not calendar news.
      if (p.ends_on && p.ends_on < today) continue;
      // Another store's copy served for this store's page (geo redirect).
      if (promoLooksForeign(p)) continue;
      seen++;
      const key = promoKey(p);
      const existing = await env.DB.prepare('SELECT 1 AS x FROM promotions WHERE dedupe_key = ?').bind(key).first();
      await env.DB.prepare(
        `INSERT INTO promotions (dedupe_key, kind, title, details, starts_on, ends_on, min_spend, gift_set_num, url, market, currency, source, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'lego.com', datetime('now'))
         ON CONFLICT(dedupe_key) DO UPDATE SET
           title = excluded.title,
           details = COALESCE(excluded.details, promotions.details),
           ends_on = COALESCE(excluded.ends_on, promotions.ends_on),
           min_spend = COALESCE(excluded.min_spend, promotions.min_spend),
           gift_set_num = COALESCE(excluded.gift_set_num, promotions.gift_set_num),
           url = COALESCE(excluded.url, promotions.url),
           market = excluded.market,
           currency = excluded.currency,
           last_seen_at = excluded.last_seen_at,
           updated_at = datetime('now')
         WHERE promotions.source = 'lego.com'`,
      ).bind(key, p.kind, p.title, p.details, p.starts_on, p.ends_on, p.min_spend, p.gift_set_num,
        p.url && /^https:\/\/([a-z0-9-]+\.)*lego\.com\//i.test(p.url) ? p.url : url, p.market, p.currency).run();
      if (!existing) added++;
    }
  }
  return { pages, seen, added };
}

async function promotionsViaBrightData(env: Env, url: string, prompt: string): Promise<Extracted | null> {
  const html = await fetchRawPage(env, url);
  if (!html) return null;
  const text = pageText(html);
  if (text.length < 500) return null; // a bot wall, not an offers page
  const data = await llmExtractJson<{ promotions?: Record<string, unknown>[] }>(env, text, prompt, PROMO_SCHEMA);
  if (!data) return null;
  return { data: { promotions: Array.isArray(data.promotions) ? data.promotions : [] } };
}
