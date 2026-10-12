import type { Env } from '../types';
import { firecrawlScrape } from '../lib/firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { sourceEnabled } from '../lib/source-config';
import { PROMO_PAGES, PROMO_SCHEMA, normalizePromo, promoKey, promoPrompt } from '../lib/promotions';

/**
 * Read LEGO.com's offers pages and upsert what they announce into promotions.
 * Two structured extractions a day (5 Firecrawl credits each). A row the admin
 * hid stays hidden; an admin-entered row is never overwritten.
 */
export async function runPromotionsRefresh(env: Env): Promise<{ pages: number; seen: number; added: number; skipped?: string }> {
  if (!firecrawlEnabled(env) || !(await sourceEnabled(env, 'firecrawl'))) {
    return { pages: 0, seen: 0, added: 0, skipped: 'Firecrawl disabled' };
  }
  const today = new Date().toISOString().slice(0, 10);
  let pages = 0;
  let seen = 0;
  let added = 0;
  for (const url of PROMO_PAGES) {
    const res = await firecrawlScrape<{ promotions?: Record<string, unknown>[] }>({
      url,
      formats: ['json'],
      jsonOptions: { schema: PROMO_SCHEMA, prompt: promoPrompt(today) },
      waitFor: 2000,
      timeoutMs: 30_000,
    }, env).catch(() => null);
    if (!res) continue;
    pages++;
    for (const raw of res.data?.promotions || []) {
      const p = normalizePromo(raw);
      if (!p) continue;
      // An offer that already ended is history, not calendar news.
      if (p.ends_on && p.ends_on < today) continue;
      seen++;
      const key = promoKey(p);
      const existing = await env.DB.prepare('SELECT 1 AS x FROM promotions WHERE dedupe_key = ?').bind(key).first();
      await env.DB.prepare(
        `INSERT INTO promotions (dedupe_key, kind, title, details, starts_on, ends_on, min_spend, gift_set_num, url, source, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lego.com', datetime('now'))
         ON CONFLICT(dedupe_key) DO UPDATE SET
           details = COALESCE(excluded.details, promotions.details),
           ends_on = COALESCE(excluded.ends_on, promotions.ends_on),
           min_spend = COALESCE(excluded.min_spend, promotions.min_spend),
           gift_set_num = COALESCE(excluded.gift_set_num, promotions.gift_set_num),
           url = COALESCE(excluded.url, promotions.url),
           last_seen_at = excluded.last_seen_at,
           updated_at = datetime('now')
         WHERE promotions.source = 'lego.com'`,
      ).bind(key, p.kind, p.title, p.details, p.starts_on, p.ends_on, p.min_spend, p.gift_set_num,
        p.url && /^https:\/\/([a-z0-9-]+\.)*lego\.com\//i.test(p.url) ? p.url : url).run();
      if (!existing) added++;
    }
  }
  return { pages, seen, added };
}
