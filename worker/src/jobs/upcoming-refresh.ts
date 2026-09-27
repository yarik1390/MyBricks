import type { Env } from '../types';
import { fetchUpcomingSets } from '../lib/upcoming';
import { firecrawlEnabled } from '../lib/pricing-flags';

/**
 * Refresh the upcoming/coming-soon feed (G2b). One Firecrawl scrape of the
 * LEGO.com coming-soon listing per run (cheap; the page is small and changes
 * slowly). Upserts each product and prunes rows that weren't seen this run —
 * those have either released (now in the normal catalog) or been pulled.
 */
export async function runUpcomingRefresh(env: Env) {
  const cleared = await clearRetiringOnUpcoming(env);
  if (!firecrawlEnabled(env)) return { upserted: 0, removed: 0, cleared, skipped: 'firecrawl disabled' };

  const items = await fetchUpcomingSets(env);
  // Don't prune on an empty/failed scrape — that would wipe a good feed on a
  // transient miss. Only reconcile when we actually got products.
  if (!items.length) return { upserted: 0, removed: 0, cleared, skipped: 'no items scraped' };

  const stamp = new Date().toISOString();
  const stmts = items.map((it) => env.DB.prepare(`
    INSERT INTO upcoming_sets (set_num, name, price_usd, availability, scraped_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(set_num) DO UPDATE SET name=?2, price_usd=?3, availability=?4, scraped_at=?5
  `).bind(it.set_num, it.name, it.price_usd, it.availability, stamp));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));

  // Prune entries no longer listed (not refreshed this run).
  const del = await env.DB.prepare(
    `DELETE FROM upcoming_sets WHERE scraped_at IS NULL OR scraped_at < ?`,
  ).bind(stamp).run();

  return { upserted: items.length, removed: (del.meta.changes as number | undefined) ?? 0, cleared: cleared + await clearRetiringOnUpcoming(env) };
}

/**
 * A set LEGO lists as coming soon isn't retiring. Clear the flag a stock scrape
 * stored anyway (its parsers can match "Retiring soon" in LEGO.com's site
 * navigation) and the risk score cached from it, which the app also reads as
 * "retiring" at 70+. Runs even when the scrape is off or fails, so bad flags heal.
 */
export async function clearRetiringOnUpcoming(env: Env): Promise<number> {
  try {
    const res = await env.DB.prepare(
      `UPDATE lego_sets SET lego_retiring_soon = 0, retirement_risk_score = 0
       WHERE (lego_retiring_soon = 1 OR COALESCE(retirement_risk_score, 0) > 0)
         AND (set_num IN (SELECT set_num FROM upcoming_sets)
              OR COALESCE(lego_availability, '') IN ('coming_soon', 'pre_order'))`,
    ).run();
    return (res.meta.changes as number | undefined) ?? 0;
  } catch {
    return 0; // upcoming_sets may not exist yet on a fresh DB
  }
}
