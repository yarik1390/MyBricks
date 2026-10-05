import type { Env } from '../types';
import { fetchUpcomingSets } from '../lib/upcoming';
import { firecrawlEnabled } from '../lib/pricing-flags';

/**
 * Refresh the upcoming/coming-soon feed (G2b). One Firecrawl scrape of the
 * LEGO.com coming-soon listing per run (cheap; the page is small and changes
 * slowly). Listing scrapes can be partial: absence is never release evidence.
 */
export async function runUpcomingRefresh(env: Env) {
  let removed = await pruneReleasedUpcoming(env);
  const cleared = await clearRetiringOnUpcoming(env);
  if (!firecrawlEnabled(env)) return { upserted: 0, removed, cleared, skipped: 'firecrawl disabled' };

  const items = await fetchUpcomingSets(env);
  // Empty or partial scrapes never establish that omitted products released.
  if (!items.length) return { upserted: 0, removed, cleared, skipped: 'no items scraped' };

  const stamp = new Date().toISOString();
  const stmts = items.map((it) => env.DB.prepare(`
    INSERT INTO upcoming_sets (set_num, name, price_usd, availability, scraped_at)
    VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(set_num) DO UPDATE SET name=?2, price_usd=?3, availability=?4, scraped_at=?5
  `).bind(it.set_num, it.name, it.price_usd, it.availability, stamp));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));

  removed += await pruneReleasedUpcoming(env);
  return { upserted: items.length, removed, cleared: cleared + await clearRetiringOnUpcoming(env) };
}

// Fresh stock must be a valid observation, not an invalid/future timestamp.
const RELEASED = `(retired = 1 OR (
  datetime(lego_checked_at) >= datetime('now', '-7 days')
  AND datetime(lego_checked_at) <= datetime('now')
  AND lego_availability IN ('in_stock', 'back_order', 'sold_out', 'retiring')
))`;

async function pruneReleasedUpcoming(env: Env): Promise<number> {
  const res = await env.DB.prepare(
    `DELETE FROM upcoming_sets WHERE set_num IN (SELECT set_num FROM lego_sets WHERE ${RELEASED})`,
  ).run();
  return res.meta.changes ?? 0;
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
       WHERE NOT COALESCE(${RELEASED}, 0)
         AND (lego_retiring_soon = 1 OR COALESCE(retirement_risk_score, 0) > 0)
         AND (set_num IN (SELECT set_num FROM upcoming_sets)
              OR COALESCE(lego_availability, '') IN ('coming_soon', 'pre_order'))`,
    ).run();
    return (res.meta.changes as number | undefined) ?? 0;
  } catch {
    return 0; // upcoming_sets may not exist yet on a fresh DB
  }
}
