import type { Env } from '../types';
import { recomputeBlendedValues } from '../lib/market-sources';
import { pricingWritesAllowed } from '../lib/pricing-budget';

// Sets whose model estimate was rewritten in the last few hours and that
// someone owns or wants. train-value-model only touches model_cached_at when
// the figure changed (or weekly), so this is the set of estimates that moved.
// (bundle-values already re-blends the bundles it reprices.)
export const REBLEND_AFTER_MODEL_SQL = `
  SELECT ext.set_num FROM set_market_ext ext
  WHERE ext.model_cached_at >= datetime('now', ?1)
    AND (ext.set_num IN (SELECT set_num FROM user_collection WHERE deleted_at IS NULL)
      OR ext.set_num IN (SELECT set_num FROM user_wishlist))
  ORDER BY ext.set_num
  LIMIT ?2`;

/**
 * Right after the daily value model retrains, refresh the persisted fair value
 * of owned and wishlisted sets whose estimate moved, so the vault, wishlist and
 * alerts show today's fit the same day instead of after the ~6-day rotation in
 * recompute-blends. Bounded; the rotation still covers the rest of the catalog.
 */
export async function runReblendAfterModel(
  env: Env,
  opts: { window?: string; limit?: number } = {},
): Promise<{ candidates: number; written: number; skipped?: string }> {
  if (!(await pricingWritesAllowed(env.DB))) {
    return { candidates: 0, written: 0, skipped: 'D1 pricing write budget paused non-critical jobs' };
  }
  const { results } = await env.DB.prepare(REBLEND_AFTER_MODEL_SQL)
    .bind(opts.window ?? '-3 hours', opts.limit ?? 800)
    .all<{ set_num: string }>();
  const setNums = results.map((r) => r.set_num);
  if (!setNums.length) return { candidates: 0, written: 0 };
  const written = await recomputeBlendedValues(env.DB, setNums, { strict: true });
  return { candidates: setNums.length, written };
}
