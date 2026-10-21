import type { Env } from '../types';
import { pricingWritesAllowed } from '../lib/pricing-budget';

/**
 * BricksVault value model: our own estimate for sets with no market sales,
 * built only from data we hold (no licence needed).
 *
 * Trained daily, entirely in SQL, on every set with a reliable BrickLink NEW
 * sold guide (>=5 lots). In log space, predicted value / retail price is:
 *   base uplift for (years since release, retired)
 *   + theme deviation (per age class) + subtheme deviation + piece-count
 *     deviation, each fitted on the previous step's residuals and shrunk
 *     toward 0 when a group has few sets.
 * Where BrickLink has a USED sold guide for the set, the used price times the
 * learned new/used ratio is blended in at 65% (it is the strongest signal we
 * have for old sets).
 *
 * Backtest 2026-10-13 (half held out, within -20%/+25% of BrickLink sold):
 * 0-3 yrs 62% (BrickEconomy 40%), 4-10 yrs 50% (43%), 11+ yrs 37% (49%).
 * The old formula scored 49% / 35% / 20%. See pricing-review/own-value-model-test.md.
 *
 * The result lands in set_market_ext.model_value and enters the v3 blend as
 * an 'estimate' signal (lib/valuation-v3.ts): it is the headline only when no
 * sold, modeled or multi-source asking evidence exists, replacing the formula.
 */

// Shrinkage: a group's deviation counts as if it had this many extra sets at 0.
const SHRINK_THEME = 4;
const SHRINK_SUBTHEME = 4;
const SHRINK_PIECES = 8;
// Weight of the used-sales anchor in log space when one exists.
const USED_WEIGHT = 0.65;
// Training rows outside this sold/retail band are treated as bad retail data.
const TRAIN_RATIO_MIN = 0.1;
const TRAIN_RATIO_MAX = 20;

// Independent retail anchor, same rule as independentRetailAnchor(): Brickset
// MSRP, else Brickset's UK/DE/CA price (ext.bs_retail_alt, USD-equivalent),
// else retail_price unless it merely echoes the BrickEconomy scrape
// (be_retail), which carries garbage such as a $501,499 sticker sheet.
// The model is trained on this anchor only.
const RETAIL = `COALESCE(NULLIF(ls.brickset_msrp, 0), NULLIF(ext.bs_retail_alt, 0), CASE WHEN ls.retail_price > 0
  AND (ls.be_retail IS NULL OR ls.be_retail <= 0 OR ls.retail_price <> ls.be_retail) THEN ls.retail_price END)`;

// Sets with no independent retail may still be estimated from the
// BrickEconomy-echo retail_price (Iaroslav's choice, 2026-10-19), but only
// when it is believable for the piece count: $1-$1,000 and $0.03-$2 a piece.
// Brickset MSRP sits in that band for 97% of sets. A count of 0-5 pieces is
// not a real count (bundles, old Duplo/Primo/Quatro, education kits), so there
// only the $1-$1,000 band applies, except for gear, books and games, which are
// not collectible sets.
export const ECHO_PPP_MIN = 0.03;
export const ECHO_PPP_MAX = 2;
export const NO_PIECE_COUNT_MAX = 5;
const NOT_SETS = `('Gear', 'Books', 'Games')`;
const TARGET_RETAIL = `COALESCE(${RETAIL}, CASE WHEN ls.retail_price BETWEEN 1 AND 1000 AND (
    (ls.pieces > ${NO_PIECE_COUNT_MAX} AND ls.retail_price BETWEEN ls.pieces * ${ECHO_PPP_MIN} AND ls.pieces * ${ECHO_PPP_MAX})
    OR (COALESCE(ls.pieces, 0) <= ${NO_PIECE_COUNT_MAX} AND COALESCE(ls.theme, '') NOT IN ${NOT_SETS}))
  THEN ls.retail_price END)`;

// Shared feature projection. `ac` is the coarse age class the deviations are
// fitted within (0-3, 4-10, 11+ years since release).
// Sets estimated with no real piece count (0-5) score in the unknown piece
// bucket, not the tiny-set buckets learned from key chains and figures that
// sell for many times retail.
const features = (retail: string, minPieces = 0) => `
  ls.set_num,
  MIN(MAX(CAST(strftime('%Y','now') AS INTEGER) - ls.year, 0), 30) AS age,
  CASE WHEN CAST(strftime('%Y','now') AS INTEGER) - ls.year <= 3 THEN 0
       WHEN CAST(strftime('%Y','now') AS INTEGER) - ls.year <= 10 THEN 1 ELSE 2 END AS ac,
  COALESCE(ls.retired, 0) AS ret,
  COALESCE(ls.theme, '?') AS th,
  COALESCE(ls.theme, '?') || '/' || COALESCE(ls.subtheme, '') AS st,
  CASE WHEN ls.pieces > ${minPieces} THEN MIN(CAST(ln(ls.pieces) * 2 AS INTEGER), 18) ELSE -1 END AS pb,
  ${retail} AS rp,
  CASE WHEN ls.bl_used_qty > 0 AND ls.used_value > 0 THEN ls.used_value END AS u`;

export const TRAIN_VALUE_MODEL_SQL = `
WITH
  train AS (
    SELECT ${features(RETAIL)}, ls.bl_new_value AS bl
    FROM lego_sets ls LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE ls.bl_new_value > 0 AND ls.bl_new_qty >= 5 AND ls.year > 0
      AND ${RETAIL} > 0
      -- A sale more than 20x or under a tenth of retail almost always means a
      -- wrong retail price (SPIKE motors listed at $0.11 pushed whole themes to
      -- the 20x clamp in the first live run), so keep those out of the fit.
      AND ls.bl_new_value BETWEEN ${RETAIL} * ${TRAIN_RATIO_MIN} AND ${RETAIL} * ${TRAIN_RATIO_MAX}),
  base_ar AS (SELECT age, ret, AVG(ln(bl / rp)) AS m FROM train GROUP BY age, ret),
  base_a AS (SELECT age, AVG(ln(bl / rp)) AS m FROM train GROUP BY age),
  base_all AS (SELECT AVG(ln(bl / rp)) AS m FROM train),
  r1 AS (SELECT t.*, ln(t.bl / t.rp) - b.m AS res FROM train t JOIN base_ar b USING (age, ret)),
  d_th AS (SELECT th, ac, SUM(res) / (COUNT(*) + ${SHRINK_THEME}) AS d FROM r1 GROUP BY th, ac),
  r2 AS (SELECT r1.*, r1.res - COALESCE(d_th.d, 0) AS res2 FROM r1 LEFT JOIN d_th USING (th, ac)),
  d_st AS (SELECT st, SUM(res2) / (COUNT(*) + ${SHRINK_SUBTHEME}) AS d FROM r2 GROUP BY st),
  r3 AS (SELECT r2.*, r2.res2 - COALESCE(d_st.d, 0) AS res3 FROM r2 LEFT JOIN d_st USING (st)),
  d_pb AS (SELECT pb, ac, SUM(res3) / (COUNT(*) + ${SHRINK_PIECES}) AS d FROM r3 GROUP BY pb, ac),
  used_ratio AS (SELECT ac, AVG(ln(bl / u)) AS m FROM train WHERE u > 0 GROUP BY ac),
  target AS (
    SELECT ${features(TARGET_RETAIL, NO_PIECE_COUNT_MAX)}
    FROM lego_sets ls LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE ls.year > 0 AND ${TARGET_RETAIL} > 0),
  scored AS (
    SELECT t.set_num, t.rp,
      ln(t.rp) + COALESCE(bar.m, ba.m, (SELECT m FROM base_all))
        + COALESCE(d_th.d, 0) + COALESCE(d_st.d, 0) + COALESCE(d_pb.d, 0) AS lr,
      CASE WHEN t.u > 0 AND ur.m IS NOT NULL THEN ln(t.u) + ur.m END AS lu
    FROM target t
    LEFT JOIN base_ar bar ON bar.age = t.age AND bar.ret = t.ret
    LEFT JOIN base_a ba ON ba.age = t.age
    LEFT JOIN d_th ON d_th.th = t.th AND d_th.ac = t.ac
    LEFT JOIN d_st ON d_st.st = t.st
    LEFT JOIN d_pb ON d_pb.pb = t.pb AND d_pb.ac = t.ac
    LEFT JOIN used_ratio ur ON ur.ac = t.ac),
  final AS (
    SELECT set_num,
      -- Clamp to a sane band around retail so one odd group can't run away.
      MIN(MAX(exp(CASE WHEN lu IS NOT NULL THEN ${1 - USED_WEIGHT} * lr + ${USED_WEIGHT} * lu ELSE lr END),
              rp * 0.2), rp * 20) AS v
    FROM scored)
INSERT INTO set_market_ext (set_num, model_value, model_cached_at)
SELECT set_num, CASE WHEN v >= 20 THEN ROUND(v, 0) ELSE ROUND(v, 1) END, datetime('now')
FROM final WHERE v > 0
ON CONFLICT(set_num) DO UPDATE SET model_value = excluded.model_value, model_cached_at = excluded.model_cached_at
-- A bundle priced from its contents (jobs/bundle-values.ts) keeps that value.
WHERE set_market_ext.bundle_value IS NULL AND (set_market_ext.model_value IS NOT excluded.model_value
   OR set_market_ext.model_cached_at IS NULL
   OR set_market_ext.model_cached_at < datetime('now', '-7 days'))`;

export async function runTrainValueModel(env: Env): Promise<{ trained: number; written: number; skipped?: string }> {
  if (!(await pricingWritesAllowed(env.DB))) {
    return { trained: 0, written: 0, skipped: 'D1 pricing write budget paused non-critical jobs' };
  }
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM lego_sets ls LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
     WHERE ls.bl_new_value > 0 AND ls.bl_new_qty >= 5 AND ls.year > 0
       AND ${RETAIL} > 0
       AND ls.bl_new_value BETWEEN ${RETAIL} * ${TRAIN_RATIO_MIN} AND ${RETAIL} * ${TRAIN_RATIO_MAX}`,
  ).first<{ n: number }>();
  const trained = Number(count?.n ?? 0);
  // Too little ground truth would make every group mean noise.
  if (trained < 200) return { trained, written: 0, skipped: 'fewer than 200 BrickLink-priced sets to train on' };
  const result = await env.DB.prepare(TRAIN_VALUE_MODEL_SQL).run();
  return { trained, written: Number(result.meta?.changes ?? 0) };
}
