import type { Env } from '../types';
import { pricingWritesAllowed, recordPricingWrites } from '../lib/pricing-budget';
import { sourceEnabled } from '../lib/source-config';

/**
 * Materialize PriceCharting signals only for mappings whose identity was already
 * verified by provider evidence or deliberate manual review.
 *
 * This job intentionally performs no promotion. Price agreement is valuation
 * corroboration, not item identity, and legacy lego_sets title/UPC copies are
 * not independent evidence. Existing verified mappings are retained and
 * refreshed; quarantined and rejected mappings remain untouched.
 */

export async function runPriceChartingVerify(
  env: Env,
  options: {
    limit?: number;
    /**
     * When false, the full signal-materialization sweep only runs if this
     * invocation actually promoted something — the mode for the hourly
     * backlog drain, which must cost one SELECT once the backlog is empty.
     * The daily run keeps the default (true) so PC price movements refresh
     * the signals of already-verified mappings.
     */
    refreshSignals?: boolean;
  } = {},
): Promise<{ promoted: number; signals: number; reblended: number; skipped?: string }> {
  if (!(await sourceEnabled(env, 'pricecharting'))) {
    return { promoted: 0, signals: 0, reblended: 0, skipped: 'PriceCharting disabled in source tuning' };
  }
  // Self-imposed D1 pricing-write budget: a full drain is ~17k rows (<2% of the
  // daily pause threshold), but respect a paused ledger like every other job.
  if (!(await pricingWritesAllowed(env.DB))) {
    return { promoted: 0, signals: 0, reblended: 0, skipped: 'D1 pricing write budget paused non-critical jobs' };
  }
  // Kept for scheduler/API compatibility; verification is now identity-only
  // and this job never promotes candidates.
  void Math.min(Math.max(Number(options.limit) || 800, 1), 2500);

  try {
    const promoted = 0;
    const wantSignals = options.refreshSignals !== false;
    const signalUpsert = (condition: string, valueExpr: string, joinExt: boolean) => env.DB.prepare(`
      INSERT INTO pricing_signals (
        set_num, source, source_item_id, provider_family, condition, signal_type,
        currency, value, sample_count, sales_volume, source_observed_at, checked_at,
        match_status, flags_json, updated_at
      )
      SELECT ls.set_num, 'pricecharting', pm.source_item_id, 'ebay_market', '${condition}',
             'sold', 'USD', ${valueExpr}, ext.pc_sales_volume, ext.pc_sales_volume,
             COALESCE(ls.pc_cached_at, datetime('now')), COALESCE(ls.pc_cached_at, datetime('now')),
             pm.status, '[]', datetime('now')
      FROM lego_sets ls
      JOIN pricing_source_map pm ON pm.source='pricecharting' AND pm.set_num=ls.set_num
        AND pm.status IN ('verified','manual')
      ${joinExt ? 'JOIN' : 'LEFT JOIN'} set_market_ext ext ON ext.set_num = ls.set_num
      WHERE ${valueExpr} IS NOT NULL
      ON CONFLICT(set_num, source, condition) DO UPDATE SET
        source_item_id=excluded.source_item_id, value=excluded.value,
        sample_count=excluded.sample_count, sales_volume=excluded.sales_volume,
        source_observed_at=excluded.source_observed_at, checked_at=excluded.checked_at,
        match_status=excluded.match_status, updated_at=datetime('now')
      WHERE pricing_signals.value IS NOT excluded.value
         OR pricing_signals.sales_volume IS NOT excluded.sales_volume
         OR pricing_signals.match_status IS NOT excluded.match_status
    `);
    let signals = 0;
    if (wantSignals) {
      const signalResults = await env.DB.batch([
        signalUpsert('new_sealed', 'ls.pc_new_value', false),
        signalUpsert('used_complete', 'ls.pc_complete_value', false),
        signalUpsert('loose', 'ext.pc_loose_value', true),
      ]);
      signals = signalResults.reduce((sum, r) => sum + Number(r.meta?.changes || 0), 0);
    }

    // This job never changes mapping identity, so no reblend is needed beyond
    // the signal upserts themselves.
    const reblended = 0;

    await recordPricingWrites(env.DB, 'pricecharting-verify', signals);
    if (signals) {
      console.log(`[pc-verify] refreshed ${signals} signal rows`);
    }
    return { promoted, signals, reblended };
  } catch (e) {
    console.warn('[pc-verify] failed:', (e as Error).message);
    return { promoted: 0, signals: 0, reblended: 0, skipped: (e as Error).message };
  }
}
