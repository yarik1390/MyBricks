import type { Env } from '../types';
import { fetchPriceChartingData } from '../lib/pricecharting';
import { recomputeBlendedValues } from '../lib/market-sources';

/**
 * Populate PriceCharting pricing data into pc_new_value / pc_complete_value
 * (and discover/store the pc_id for faster future refreshes).
 *
 * PriceCharting's "new-price" is the sealed-condition market price derived from
 * aggregated eBay closed auctions — a genuine second sold-comp source independent
 * of BrickLink. When BL and PC agree within ~40%, blendMarketValue() reaches
 * "high" confidence without requiring eBay Marketplace Insights approval.
 *
 * Cost: zero Firecrawl credits. Uses PriceCharting's own REST API ($4.99/month
 * Collector tier). Set PRICECHARTING_TOKEN to enable.
 *
 * Priority order (same logic as brickeconomy-enrich):
 *   1. Sets with BL data but no pc_cached_at (need 2nd source most)
 *   2. Sets with a known pc_id (cheaper: skip search step)
 *   3. Owned / wishlisted sets
 *   4. High blended_value sets
 *   5. Remainder of catalog (year >= 2000)
 */
export async function runPriceChartingEnrich(
  env: Env,
  options: { limit?: number; concurrency?: number } = {},
): Promise<{ processed: number; updated: number; discovered: number; limit: number; skipped?: string }> {
  if (!env.PRICECHARTING_TOKEN) {
    return { processed: 0, updated: 0, discovered: 0, limit: 0, skipped: 'PRICECHARTING_TOKEN not set' };
  }

  const requestedLimit = Number(options.limit);
  // Cap at 200; concurrency 10 + ~1s/call → ≤20s wall-time per invocation.
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 50;

  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name, ls.pc_id
    FROM lego_sets ls
    WHERE (ls.pc_cached_at IS NULL OR ls.pc_cached_at < datetime('now', '-14 days'))
      AND ls.year >= 2000
    ORDER BY
      CASE WHEN ls.bl_new_value IS NOT NULL AND ls.pc_cached_at IS NULL THEN 0 ELSE 1 END,
      CASE WHEN ls.pc_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(NULLIF(ls.blended_value, 0), ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string; pc_id: string | null }>();

  if (!results.length) return { processed: 0, updated: 0, discovered: 0, limit };

  let processed = 0;
  let updated = 0;
  let discovered = 0;
  const stmts: D1PreparedStatement[] = [];
  const touched: string[] = [];

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 10));

  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (set) => ({
      set,
      result: await fetchPriceChartingData(set.set_num, set.name, set.pc_id, env).catch(() => null),
    })));

    for (const { set, result } of outs) {
      processed++;

      if (!result) {
        // Stamp pc_cached_at so a set missing from PC isn't retried every run.
        stmts.push(
          env.DB.prepare(`UPDATE lego_sets SET pc_cached_at=datetime('now') WHERE set_num=?`)
            .bind(set.set_num),
        );
        continue;
      }

      if (result.pc_id && !set.pc_id) discovered++;

      // Sparse update: only write figures that were actually returned.
      const fields: string[] = [`pc_cached_at=datetime('now')`];
      const binds: unknown[] = [];
      if (result.pc_id) { fields.push('pc_id=?'); binds.push(result.pc_id); }
      if (result.new_value != null) { fields.push('pc_new_value=?'); binds.push(result.new_value); }
      if (result.complete_value != null) { fields.push('pc_complete_value=?'); binds.push(result.complete_value); }

      stmts.push(
        env.DB.prepare(`UPDATE lego_sets SET ${fields.join(', ')} WHERE set_num=?`)
          .bind(...binds, set.set_num),
      );

      if (result.new_value != null || result.complete_value != null) {
        touched.push(set.set_num);
        updated++;
      }
    }

    // Flush incrementally so a long bootstrap persists progress even if the
    // invocation wall-time limit is hit mid-batch.
    if (stmts.length >= 90) {
      await env.DB.batch(stmts.splice(0, stmts.length));
    }
  }

  if (stmts.length) await env.DB.batch(stmts);
  // Re-run the blend for updated sets so blended_value + blended_confidence
  // reflect the new PC data without waiting for the next valuation cron.
  if (touched.length) await recomputeBlendedValues(env.DB, touched);

  return { processed, updated, discovered, limit };
}
