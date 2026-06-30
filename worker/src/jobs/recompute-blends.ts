import type { Env } from '../types';
import { recomputeBlendedValues } from '../lib/market-sources';

// Re-persist the calibrated blended value + confidence + band for sets that have
// a value but NO band — the cohort last valued before the v2.2 calibration added
// the blended_low/blended_high columns. blendMarketValue always produces a band
// when it has >=1 price point, so a non-null value with a null low/high means the
// row simply predates the calibrated write and hasn't been re-swept yet. This
// backfill targets exactly that cohort, prioritizing owned/wishlist then highest
// value so the sets users actually look at heal first. Bounded per call to stay
// inside the Worker CPU/subrequest budget; sets with no usable market signal stay
// null (genuinely un-bandable) and are simply re-touched without harm.
export async function runBlendRecomputeBackfill(
  env: Env,
  options: { limit?: number } = {},
): Promise<{ candidates: number; recomputed: number; limit: number }> {
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), 400)
    : 100;
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num
    FROM lego_sets ls
    WHERE ls.blended_value IS NOT NULL AND ls.blended_low IS NULL
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.blended_value, ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string }>();

  const setNums = results.map(r => r.set_num);
  const recomputed = setNums.length ? await recomputeBlendedValues(env.DB, setNums) : 0;
  return { candidates: setNums.length, recomputed, limit };
}
