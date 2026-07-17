import type { Env } from '../types';
import { recomputeBlendedValues } from '../lib/market-sources';
import { pricingWritesAllowed, recordPricingWrites } from '../lib/pricing-budget';
import { sourceEnabled } from '../lib/source-config';

/**
 * Promote quarantined PriceCharting mappings to VERIFIED by cross-source price
 * agreement, then materialize their pricing_signals so the v3 blend can use
 * them as sold comps.
 *
 * Why this exists: PriceCharting aggregates closed eBay auctions — exactly the
 * sold-comp signal eBay's retired Marketplace Insights API used to provide —
 * but its product mappings were quarantined wholesale because base-number
 * matching mis-mapped variants (e.g. 75188 vs the Finch Dallow 75188-2). The
 * bulk import auto-verifies only unique-UPC matches. This job adds the second
 * safe path: when PriceCharting's sealed price independently AGREES (within
 * 0.6–1.67x) with a BrickLink or eBay sold value for the same set, two
 * independent sources concur on the same market level — a wrong-item mapping
 * essentially can't do that, so the mapping identity is confirmed.
 *
 * Idempotent + bounded: promotions upsert by (source, source_item_id); signal
 * rows upsert change-only by (set_num, source, condition). Disagreeing or
 * uncorroborated mappings stay quarantined (visible in diagnostics, excluded
 * from headlines) until the weekly UPC bulk pass or a manual review verifies
 * them. NOTE: signals carry sales_volume as their sample size — thin-volume
 * (<3/yr) rows stay out of the fair-value headline via the blend's sample gate.
 */

// Agreement band: sealed PC vs an independent sold comp for the same set.
// Wide enough for marketplace spread, far too narrow for a wrong item.
const BAND_LOW = 0.6;
const BAND_HIGH = 1.67;

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
  const limit = Math.min(Math.max(Number(options.limit) || 800, 1), 2500);

  try {
    // Candidates: legacy pc_new_value rows whose mapping is not yet verified and
    // where an independent sold comp agrees. Collected first so we know exactly
    // which sets to re-blend after promotion.
    const { results: candidates } = await env.DB.prepare(`
      SELECT ls.set_num, COALESCE(NULLIF(ls.pc_id, ''), 'legacy:' || ls.set_num) AS item_id,
             ls.name, ls.upc
      FROM lego_sets ls
      WHERE ls.pc_new_value IS NOT NULL
        AND COALESCE(ls.bl_new_value, ls.ebay_new_value) IS NOT NULL
        AND ls.pc_new_value >= ${BAND_LOW} * COALESCE(ls.bl_new_value, ls.ebay_new_value)
        AND ls.pc_new_value <= ${BAND_HIGH} * COALESCE(ls.bl_new_value, ls.ebay_new_value)
        AND NOT EXISTS (
          SELECT 1 FROM pricing_source_map pm
          WHERE pm.source = 'pricecharting'
            AND pm.set_num = ls.set_num
            AND pm.status IN ('verified', 'manual')
        )
      LIMIT ?
    `).bind(limit).all<{ set_num: string; item_id: string; name: string | null; upc: string | null }>();

    let promoted = 0;
    if (candidates.length) {
      const stmts = candidates.map((c) => env.DB.prepare(`
        INSERT INTO pricing_source_map (
          source, source_item_id, set_num, source_title, upc, variant_key,
          match_method, match_confidence, status, verified_at, updated_at
        ) VALUES ('pricecharting', ?1, ?2, ?3, ?4, ?2, 'price_agreement', 0.85, 'verified', datetime('now'), datetime('now'))
        ON CONFLICT(source, source_item_id) DO UPDATE SET
          set_num=excluded.set_num, match_method='price_agreement',
          match_confidence=0.85, status='verified',
          verified_at=datetime('now'), updated_at=datetime('now')
        WHERE pricing_source_map.status NOT IN ('verified', 'manual')
      `).bind(c.item_id, c.set_num, c.name, c.upc));
      for (let i = 0; i < stmts.length; i += 90) {
        const batchResults = await env.DB.batch(stmts.slice(i, i + 90));
        promoted += batchResults.reduce((sum, r) => sum + Number(r.meta?.changes || 0), 0);
      }
    }

    // Materialize signals for EVERY verified/manual PriceCharting mapping from
    // the legacy pc_* columns (covers this run's promotions AND any verified
    // mapping whose prices moved since the last pass). Change-only upserts.
    // Skipped entirely on drain-mode runs that promoted nothing, so the hourly
    // slot costs one empty SELECT once the backlog is gone.
    const wantSignals = promoted > 0 || options.refreshSignals !== false;
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

    // Re-blend the sets whose mappings were promoted this run so blended_value
    // and confidence pick up the new corroborating family immediately.
    let reblended = 0;
    if (candidates.length) {
      reblended = await recomputeBlendedValues(env.DB, candidates.map((c) => c.set_num));
    }

    await recordPricingWrites(env.DB, 'pricecharting-verify', promoted + signals + reblended);
    if (promoted || signals) {
      console.log(`[pc-verify] promoted ${promoted} mappings by price agreement, ${signals} signal rows, re-blended ${reblended}`);
    }
    return { promoted, signals, reblended };
  } catch (e) {
    console.warn('[pc-verify] failed:', (e as Error).message);
    return { promoted: 0, signals: 0, reblended: 0, skipped: (e as Error).message };
  }
}
