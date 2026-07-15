import type { Env } from '../types';
import { fetchPriceChartingData } from '../lib/pricecharting';
import { recomputeBlendedValues } from '../lib/market-sources';
import { getSourceConfig } from '../lib/source-config';
import { spendQuota } from '../lib/api-quota';

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
  // Admin source-tuning: kill-switch + refresh cadence.
  const cfg = await getSourceConfig(env);
  if (!cfg.pricecharting.enabled) {
    return { processed: 0, updated: 0, discovered: 0, limit: 0, skipped: 'PriceCharting disabled in admin source tuning' };
  }
  const refreshDays = Math.max(1, Math.round(cfg.pricecharting.refreshDays ?? 14));

  const requestedLimit = Number(options.limit);
  // Cap at 200; concurrency 10 + ~1s/call → ≤20s wall-time per invocation.
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 50;

  const { results } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name, pm.source_item_id AS pc_id, ls.upc
    FROM lego_sets ls
    LEFT JOIN pricing_source_map pm
      ON pm.source='pricecharting' AND pm.set_num=ls.set_num
     AND pm.status IN ('verified','manual')
    WHERE (ls.pc_cached_at IS NULL OR ls.pc_cached_at < datetime('now', '-${refreshDays} days'))
      AND ls.year >= 2000
    ORDER BY
      CASE WHEN ls.bl_new_value IS NOT NULL AND ls.pc_cached_at IS NULL THEN 0 ELSE 1 END,
      CASE WHEN pm.source_item_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(NULLIF(ls.blended_value, 0), ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string; name: string; pc_id: string | null; upc: string | null }>();

  if (!results.length) return { processed: 0, updated: 0, discovered: 0, limit };

  let processed = 0;
  let updated = 0;
  let discovered = 0;
  const stmts: D1PreparedStatement[] = [];
  const touched: string[] = [];

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 10));

  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    // Meter this batch's per-set API calls against the shared daily ledger so
    // PriceCharting usage is visible in admin diagnostics and a runaway is capped.
    if (!(await spendQuota(env, 'pricecharting', batch.length))) break;
    const outs = await Promise.all(batch.map(async (set) => ({
      set,
      result: await fetchPriceChartingData(set.set_num, set.name, set.pc_id, env, set.upc).catch(() => null),
    })));

    for (const { set, result } of outs) {
      processed++;

      if (!result) {
        // A no-data response must not make an old observation look fresh.
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

      stmts.push(env.DB.prepare(`
        INSERT INTO pricing_source_map (
          source, source_item_id, set_num, source_title, upc, variant_key,
          match_method, match_confidence, status, verified_at, updated_at
        ) VALUES ('pricecharting', ?1, ?2, ?3, ?4, ?5, ?6, ?7, 'verified', datetime('now'), datetime('now'))
        ON CONFLICT(source, source_item_id) DO UPDATE SET
          set_num=excluded.set_num, source_title=excluded.source_title,
          upc=excluded.upc, variant_key=excluded.variant_key,
          match_method=excluded.match_method, match_confidence=excluded.match_confidence,
          status='verified', verified_at=datetime('now'), updated_at=datetime('now')
      `).bind(
        result.pc_id, set.set_num, result.product_title, result.upc || set.upc,
        result.variant_key || set.set_num, result.match_method, result.match_confidence,
      ));

      const addSignal = (
        condition: 'new_sealed' | 'used_complete' | 'loose',
        value: number | null,
      ) => {
        if (value == null) return;
        stmts.push(env.DB.prepare(`
          INSERT INTO pricing_signals (
            set_num, source, source_item_id, provider_family, condition,
            signal_type, currency, value, sample_count, sales_volume,
            source_observed_at, checked_at, match_status, flags_json, updated_at
          ) VALUES (?1, 'pricecharting', ?2, 'ebay_market', ?3, 'sold', 'USD', ?4, ?5, ?5, datetime('now'), datetime('now'), 'verified', '[]', datetime('now'))
          ON CONFLICT(set_num, source, condition) DO UPDATE SET
            source_item_id=excluded.source_item_id, value=excluded.value,
            sample_count=excluded.sample_count, sales_volume=excluded.sales_volume,
            source_observed_at=excluded.source_observed_at, checked_at=excluded.checked_at,
            match_status='verified', flags_json='[]', updated_at=datetime('now')
          WHERE pricing_signals.value IS NOT excluded.value
             OR pricing_signals.sample_count IS NOT excluded.sample_count
             OR pricing_signals.match_status IS NOT 'verified'
        `).bind(set.set_num, result.pc_id, condition, value, result.sales_volume));
      };
      addSignal('new_sealed', result.new_value);
      addSignal('used_complete', result.complete_value);
      addSignal('loose', result.loose_value);

      // Loose (used) value + sales-volume (liquidity) live in the set_market_ext
      // side table. UPSERT only when at least one is present.
      if (result.loose_value != null || result.sales_volume != null) {
        stmts.push(
          env.DB.prepare(
            `INSERT INTO set_market_ext (set_num, pc_loose_value, pc_sales_volume)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(set_num) DO UPDATE SET
               pc_loose_value = COALESCE(?2, pc_loose_value),
               pc_sales_volume = COALESCE(?3, pc_sales_volume)`,
          ).bind(set.set_num, result.loose_value, result.sales_volume),
        );
      }

      if (result.new_value != null || result.complete_value != null || result.loose_value != null) {
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
