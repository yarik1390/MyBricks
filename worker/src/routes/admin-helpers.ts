// Admin-console helpers extracted from routes/admin.ts: the import_runs lifecycle
// (create/update/complete/fail/expire/active), data-coverage + population snapshot,
// and the market-ext coverage + Firecrawl diagnostics builders. Pure functions over
// (env, args) with no route/middleware coupling; the routes import them back.
import { QUOTA_CAPS } from '../lib/api-quota';
import { isEbayAccessError } from '../lib/ebay';
import { NON_PRICEABLE_THEMES } from '../jobs/valuate-select';
import type { Env } from '../types';

// Same definition the valuation queue uses, so the panel cannot report coverage
// over a different population than the one the crons actually work on.
const PRICEABLE_SQL =
  `(theme IS NULL OR theme NOT IN (${NON_PRICEABLE_THEMES.map((t) => `'${t}'`).join(', ')}))`;

export type JobProgress = {
  current?: number | null;
  total?: number | null;
  label?: string | null;
  setsLoaded?: number | null;
  setsSkipped?: number | null;
  themesLoaded?: number | null;
  figsLoaded?: number | null;
  note?: string | null;
};

export async function createImportRun(env: Env, jobType: string, label: string, total: number | null = null, note: string | null = null): Promise<number> {
  const run = await env.DB.prepare(`
    INSERT INTO import_runs (job_type, status, progress_current, progress_total, progress_label, error, updated_at)
    VALUES (?, 'running', 0, ?, ?, ?, datetime('now'))
  `).bind(jobType, total, label, note).run();
  return run.meta.last_row_id as number;
}

export async function updateImportRunProgress(env: Env, runId: number, progress: JobProgress): Promise<void> {
  await env.DB.prepare(`
    UPDATE import_runs SET
      progress_current=COALESCE(?, progress_current),
      progress_total=COALESCE(?, progress_total),
      progress_label=COALESCE(?, progress_label),
      sets_loaded=COALESCE(?, sets_loaded),
      sets_skipped=COALESCE(?, sets_skipped),
      themes_loaded=COALESCE(?, themes_loaded),
      figs_loaded=COALESCE(?, figs_loaded),
      error=COALESCE(?, error),
      updated_at=datetime('now')
    WHERE id=?
  `).bind(
    progress.current ?? null,
    progress.total ?? null,
    progress.label ?? null,
    progress.setsLoaded ?? null,
    progress.setsSkipped ?? null,
    progress.themesLoaded ?? null,
    progress.figsLoaded ?? null,
    progress.note ?? null,
    runId,
  ).run();
}

export async function completeImportRun(env: Env, runId: number, progress: JobProgress): Promise<void> {
  await env.DB.prepare(`
    UPDATE import_runs SET
      status='completed',
      completed_at=datetime('now'),
      updated_at=datetime('now'),
      progress_current=COALESCE(?, progress_current),
      progress_total=COALESCE(?, progress_total, progress_current),
      progress_label=COALESCE(?, 'Completed'),
      themes_loaded=COALESCE(?, themes_loaded),
      sets_loaded=COALESCE(?, sets_loaded),
      sets_skipped=COALESCE(?, sets_skipped),
      figs_loaded=COALESCE(?, figs_loaded),
      error=COALESCE(?, error)
    WHERE id=?
  `).bind(
    progress.current ?? null,
    progress.total ?? null,
    progress.label ?? 'Completed',
    progress.themesLoaded ?? null,
    progress.setsLoaded ?? null,
    progress.setsSkipped ?? null,
    progress.figsLoaded ?? null,
    progress.note ?? null,
    runId,
  ).run();
}

export async function failImportRun(env: Env, runId: number, error: unknown): Promise<void> {
  await env.DB.prepare(
    "UPDATE import_runs SET status='error',error=?,progress_label='Failed',completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?"
  ).bind((error as Error).message || String(error), runId).run();
}

export const IMPORT_RUN_FIELDS = `
  id, job_type, status, started_at, updated_at, completed_at,
  progress_current, progress_total, progress_label,
  themes_loaded, sets_loaded, sets_skipped, figs_loaded, error
`;

const RUN_MAX_AGE_MINUTES = 30;
const RUN_HEARTBEAT_STALE_MINUTES = 10;
const RUN_STOPPED_ERROR = `Worker run stopped before completion (no progress heartbeat for ${RUN_HEARTBEAT_STALE_MINUTES} minutes)`;

export async function expireStaleImportRuns(env: Env) {
  return env.DB.prepare(`
    UPDATE import_runs SET
      status='expired',
      error=?,
      progress_label='Stopped',
      completed_at=datetime('now'),
      updated_at=datetime('now')
    WHERE status='running'
      AND (
        started_at <= datetime('now','-${RUN_MAX_AGE_MINUTES} minutes')
        OR COALESCE(updated_at, started_at) <= datetime('now','-${RUN_HEARTBEAT_STALE_MINUTES} minutes')
      )
  `).bind(RUN_STOPPED_ERROR).run();
}

export async function getActiveImportRun(env: Env) {
  await expireStaleImportRuns(env);
  return env.DB.prepare(`
    SELECT id, started_at, updated_at, progress_label
    FROM import_runs
    WHERE status='running'
    ORDER BY started_at DESC
    LIMIT 1
  `).first<{ id: number; started_at: string; updated_at: string | null; progress_label: string | null }>();
}

export async function getDataCoverage(env: Env) {
  const [sets, valuationMethods, blend, barcodeHealth] = await Promise.all([
    env.DB.prepare(`
      SELECT
        CAST(COUNT(*) AS INTEGER) AS total_sets,
        CAST(SUM(CASE WHEN current_value IS NULL OR current_value <= 0 THEN 1 ELSE 0 END) AS INTEGER) AS missing_values,
        CAST(SUM(CASE WHEN valuation_expires_at IS NOT NULL AND valuation_expires_at < datetime('now') THEN 1 ELSE 0 END) AS INTEGER) AS expired_values,
        CAST(SUM(CASE WHEN cached_at IS NULL OR cached_at < datetime('now','-60 days') THEN 1 ELSE 0 END) AS INTEGER) AS stale_values,
        CAST(SUM(CASE WHEN upc IS NOT NULL AND upc != '' THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_upc,
        CAST(SUM(CASE WHEN ebay_new_value IS NOT NULL OR ebay_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_ebay,
        CAST(SUM(CASE WHEN ebay_new_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_ebay_new,
        CAST(SUM(CASE WHEN ebay_used_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_ebay_used,
        CAST(SUM(CASE WHEN bl_new_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_bricklink_new,
        CAST(SUM(CASE WHEN used_value IS NOT NULL OR bl_used_qty IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_bricklink_used,
        CAST(SUM(CASE WHEN bl_new_value IS NOT NULL OR used_value IS NOT NULL OR bl_used_qty IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_bricklink,
        CAST(SUM(CASE WHEN used_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_used_value,
        CAST(SUM(CASE WHEN retail_price IS NULL OR retail_price <= 0 THEN 1 ELSE 0 END) AS INTEGER) AS missing_msrp,
        CAST(SUM(CASE WHEN upc IS NULL OR TRIM(upc) = '' THEN 1 ELSE 0 END) AS INTEGER) AS missing_upc,
        CAST(SUM(CASE WHEN (theme IS NULL OR theme NOT IN ('Gear','Books','Educational and Dacta','Service Packs','Universal Building Set','System','LEGO Brand Store')) THEN 1 ELSE 0 END) AS INTEGER) AS retail_sets,
        CAST(SUM(CASE WHEN (theme IS NULL OR theme NOT IN ('Gear','Books','Educational and Dacta','Service Packs','Universal Building Set','System','LEGO Brand Store')) AND upc IS NOT NULL AND TRIM(upc) <> '' THEN 1 ELSE 0 END) AS INTEGER) AS retail_with_upc,
        CAST(SUM(CASE WHEN retired = 0 AND year IS NOT NULL AND year <= CAST(strftime('%Y','now') AS INTEGER) - 5 THEN 1 ELSE 0 END) AS INTEGER) AS old_active_sets,
        CAST(SUM(CASE WHEN valuation_method IN ('formula_bulk','ai') OR current_value IS NULL OR current_value <= 0 THEN 1 ELSE 0 END) AS INTEGER) AS low_confidence_values,
        CAST(SUM(CASE WHEN current_value IS NULL OR current_value <= 0 OR valuation_expires_at < datetime('now') OR cached_at IS NULL OR cached_at < datetime('now','-60 days') THEN 1 ELSE 0 END) AS INTEGER) AS needs_market_refresh,
        CAST(SUM(CASE WHEN year >= 2000 THEN 1 ELSE 0 END) AS INTEGER) AS be_eligible,
        CAST(SUM(CASE WHEN year >= 2000 AND be_value_new IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS be_populated,
        CAST(SUM(CASE WHEN year >= 2000 AND brickset_enriched_at IS NULL THEN 1 ELSE 0 END) AS INTEGER) AS brickset_enrich_remaining,
        CAST(SUM(CASE WHEN year >= 2000 AND pc_new_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS pc_populated,
        -- PRICEABLE lens. Pricing coverage measured over the whole table reads
        -- ~34% worse than reality, because half the sets with no market
        -- evidence are Gear (avg ONE piece) and Books (avg seven) — merchandise
        -- no source carries and no collector tracks. These two columns scope the
        -- gap to things that can actually be priced.
        --
        -- NB this list is deliberately NOT the retail_sets list above. That one
        -- answers "should this have a barcode?" and so excludes System and
        -- Universal Building Set, which pre-date retail UPCs. Those ARE
        -- priceable — some are worth four figures — so they stay in here.
        CAST(SUM(CASE WHEN ${PRICEABLE_SQL} THEN 1 ELSE 0 END) AS INTEGER) AS priceable_sets,
        CAST(SUM(CASE WHEN ${PRICEABLE_SQL}
          AND (bl_new_value IS NOT NULL OR used_value IS NOT NULL OR be_value_new IS NOT NULL
               OR ebay_new_value IS NOT NULL OR ebay_used_value IS NOT NULL
               OR pc_new_value IS NOT NULL OR pc_complete_value IS NOT NULL)
          THEN 1 ELSE 0 END) AS INTEGER) AS priceable_with_source,
        CAST(SUM(CASE WHEN ${PRICEABLE_SQL}
          AND bl_new_value IS NULL AND used_value IS NULL AND be_value_new IS NULL
          AND ebay_new_value IS NULL AND ebay_used_value IS NULL
          AND pc_new_value IS NULL AND pc_complete_value IS NULL
          AND COALESCE(NULLIF(blended_value,0), current_value) >= 100
          THEN 1 ELSE 0 END) AS INTEGER) AS priceable_valuable_no_source
      FROM lego_sets
    `).first<Record<string, number>>(),
    env.DB.prepare(`
      SELECT valuation_method, CAST(COUNT(*) AS INTEGER) AS count
      FROM lego_sets
      GROUP BY valuation_method
      ORDER BY count DESC
    `).all<{ valuation_method: string; count: number }>(),
    // Blend-quality lens (valuation v2): how many sets are genuinely multi-source,
    // how blended_value is populated, per-source freshness, and a confidence
    // distribution derived in SQL from the same signals blendMarketValue() uses
    // (fresh sold-source count + BrickEconomy freshness). src_count is computed
    // once in the CTE; CASE guards every NULL (col>0 is NULL when col IS NULL).
    env.DB.prepare(`
      WITH b AS (
        SELECT
          (CASE WHEN bl_new_value>0 THEN 1 ELSE 0 END)
         +(CASE WHEN ebay_new_value>0 THEN 1 ELSE 0 END)
         +(CASE WHEN bo_new_value>0 THEN 1 ELSE 0 END)
         +(CASE WHEN valuation_method='brickeconomy' AND current_value>0 THEN 1 ELSE 0 END) AS src,
          (CASE WHEN bl_new_value>0 AND bl_cached_at > datetime('now','-30 days') THEN 1 ELSE 0 END) AS bl_fresh,
          (CASE WHEN ebay_new_value>0 AND ebay_new_cached_at > datetime('now','-30 days') THEN 1 ELSE 0 END) AS ebay_fresh,
          (CASE WHEN valuation_method='brickeconomy' AND current_value>0 AND COALESCE(be_cached_at,cached_at) > datetime('now','-30 days') THEN 1 ELSE 0 END) AS be_fresh,
          (CASE WHEN bo_new_value>0 AND bo_cached_at > datetime('now','-30 days') THEN 1 ELSE 0 END) AS bo_fresh,
          (CASE WHEN bo_new_value>0 THEN 1 ELSE 0 END) AS has_bo,
          (CASE WHEN ebay_ask_value>0 THEN 1 ELSE 0 END) AS has_ask,
          (CASE WHEN brickinsights_rating>0 THEN 1 ELSE 0 END) AS has_bi,
          blended_value, current_value
        FROM lego_sets
      )
      SELECT
        CAST(SUM(CASE WHEN src=0 THEN 1 ELSE 0 END) AS INTEGER) AS src0,
        CAST(SUM(CASE WHEN src=1 THEN 1 ELSE 0 END) AS INTEGER) AS src1,
        CAST(SUM(CASE WHEN src=2 THEN 1 ELSE 0 END) AS INTEGER) AS src2,
        CAST(SUM(CASE WHEN src>=3 THEN 1 ELSE 0 END) AS INTEGER) AS src3plus,
        CAST(SUM(CASE WHEN src>=2 THEN 1 ELSE 0 END) AS INTEGER) AS multi_source,
        CAST(SUM(CASE WHEN blended_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS blended_count,
        CAST(SUM(CASE WHEN blended_value IS NOT NULL AND current_value>0 AND ABS(blended_value-current_value)/current_value > 0.02 THEN 1 ELSE 0 END) AS INTEGER) AS blended_diverged,
        CAST(SUM(bl_fresh) AS INTEGER) AS bl_fresh_30d,
        CAST(SUM(ebay_fresh) AS INTEGER) AS ebay_sold_fresh_30d,
        CAST(SUM(be_fresh) AS INTEGER) AS be_fresh_30d,
        CAST(SUM(bo_fresh) AS INTEGER) AS bo_fresh_30d,
        CAST(SUM(has_bo) AS INTEGER) AS sets_with_brickowl,
        CAST(SUM(has_ask) AS INTEGER) AS sets_with_ebay_ask,
        CAST(SUM(has_bi) AS INTEGER) AS sets_with_brickinsights,
        CAST(SUM(CASE WHEN (bl_fresh+ebay_fresh)>=2 THEN 1 ELSE 0 END) AS INTEGER) AS conf_high,
        CAST(SUM(CASE WHEN (bl_fresh+ebay_fresh)<2 AND ((bl_fresh+ebay_fresh)>=1 OR be_fresh=1) THEN 1 ELSE 0 END) AS INTEGER) AS conf_medium,
        CAST(SUM(CASE WHEN (bl_fresh+ebay_fresh)<1 AND be_fresh=0 AND src>0 THEN 1 ELSE 0 END) AS INTEGER) AS conf_low,
        CAST(SUM(CASE WHEN src=0 THEN 1 ELSE 0 END) AS INTEGER) AS conf_estimated
      FROM b
    `).first<Record<string, number>>(),
    // Barcode backfill health (written once per run by the backfill job).
    env.DB.prepare(
      `SELECT last_ok_at, last_fail_at, last_error, ok_count, fail_count, updated_at
       FROM integration_health WHERE service='brickset_barcode'`
    ).first<{ last_ok_at: string | null; last_fail_at: string | null; last_error: string | null; ok_count: number; fail_count: number; updated_at: string | null }>(),
  ]);

  const total = Number(sets?.total_sets || 0);
  const pct = (n: number) => total ? Math.round((n / total) * 1000) / 10 : 0;
  const barcodeCount = Number(sets?.sets_with_upc || 0);
  // Barcode coverage is only meaningful over scannable retail sets — the
  // catalog also holds Gear/Books/parts/education/store items with no retail
  // UPC that would drag the headline % down. Scope the % to retail sets.
  const retailTotal = Number(sets?.retail_sets || 0);
  const retailWithUpc = Number(sets?.retail_with_upc || 0);
  const retailBarcodePct = retailTotal ? Math.round((retailWithUpc / retailTotal) * 1000) / 10 : 0;
  const ebayCount = Number(sets?.sets_with_ebay || 0);
  const ebayNewCount = Number(sets?.sets_with_ebay_new || 0);
  const ebayUsedCount = Number(sets?.sets_with_ebay_used || 0);
  const bricklinkCount = Number(sets?.sets_with_bricklink || 0);
  const bricklinkNewCount = Number(sets?.sets_with_bricklink_new || 0);
  const bricklinkUsedCount = Number(sets?.sets_with_bricklink_used || 0);
  const quality = {
    missing_msrp: Number(sets?.missing_msrp || 0),
    missing_upc: Number(sets?.missing_upc || 0),
    old_active_sets: Number(sets?.old_active_sets || 0),
    low_confidence_values: Number(sets?.low_confidence_values || 0),
    needs_market_refresh: Number(sets?.needs_market_refresh || 0),
    missing_msrp_pct: pct(Number(sets?.missing_msrp || 0)),
    missing_upc_pct: pct(Number(sets?.missing_upc || 0)),
    old_active_sets_pct: pct(Number(sets?.old_active_sets || 0)),
    low_confidence_values_pct: pct(Number(sets?.low_confidence_values || 0)),
    needs_market_refresh_pct: pct(Number(sets?.needs_market_refresh || 0)),
  };
  const blendQuality = {
    multi_source: Number(blend?.multi_source || 0),
    multi_source_pct: pct(Number(blend?.multi_source || 0)),
    src0: Number(blend?.src0 || 0),
    src1: Number(blend?.src1 || 0),
    src2: Number(blend?.src2 || 0),
    src3plus: Number(blend?.src3plus || 0),
    blended_count: Number(blend?.blended_count || 0),
    blended_coverage_pct: pct(Number(blend?.blended_count || 0)),
    blended_diverged: Number(blend?.blended_diverged || 0),
    sets_with_brickowl: Number(blend?.sets_with_brickowl || 0),
    brickowl_coverage_pct: pct(Number(blend?.sets_with_brickowl || 0)),
    sets_with_ebay_ask: Number(blend?.sets_with_ebay_ask || 0),
    ebay_ask_coverage_pct: pct(Number(blend?.sets_with_ebay_ask || 0)),
    sets_with_brickinsights: Number(blend?.sets_with_brickinsights || 0),
    brickinsights_rating_coverage_pct: pct(Number(blend?.sets_with_brickinsights || 0)),
    freshness_30d: {
      bricklink: Number(blend?.bl_fresh_30d || 0),
      ebay_sold: Number(blend?.ebay_sold_fresh_30d || 0),
      brickeconomy: Number(blend?.be_fresh_30d || 0),
      brickowl: Number(blend?.bo_fresh_30d || 0),
    },
    confidence: {
      high: Number(blend?.conf_high || 0),
      medium: Number(blend?.conf_medium || 0),
      low: Number(blend?.conf_low || 0),
      estimated: Number(blend?.conf_estimated || 0),
    },
  };
  const barcodeHealthOut = barcodeHealth ? {
    last_error: barcodeHealth.last_error ?? null,
    last_ok_at: barcodeHealth.last_ok_at ?? null,
    last_fail_at: barcodeHealth.last_fail_at ?? null,
    ok_count: Number(barcodeHealth.ok_count ?? 0),
    fail_count: Number(barcodeHealth.fail_count ?? 0),
    updated_at: barcodeHealth.updated_at ?? null,
  } : null;
  // BrickEconomy-via-Firecrawl bootstrap progress: how much of the year>=2000
  // catalog has be_value_new populated (the one-time backfill burn-down).
  const beEligible = Number(sets?.be_eligible || 0);
  const bePopulated = Number(sets?.be_populated || 0);
  const beBootstrap = {
    eligible: beEligible,
    populated: bePopulated,
    remaining: Math.max(0, beEligible - bePopulated),
    pct: beEligible ? Math.round((bePopulated / beEligible) * 1000) / 10 : 0,
  };
  // The honest pricing gap. `total_sets` is the wrong denominator for a coverage
  // question: it counts keyrings and paperbacks that no source prices, which made
  // the headline read ~34% worse than the real state of the catalogue.
  const priceableTotal = Number(sets?.priceable_sets || 0);
  const priceableWithSource = Number(sets?.priceable_with_source || 0);
  const priceable = {
    total: priceableTotal,
    with_source: priceableWithSource,
    no_source: Math.max(0, priceableTotal - priceableWithSource),
    // The number worth acting on: priceable, worth >= $100, and sitting on a
    // formula with nothing corroborating it. valuate-select ranks these first.
    valuable_no_source: Number(sets?.priceable_valuable_no_source || 0),
    source_coverage_pct: priceableTotal
      ? Math.round((priceableWithSource / priceableTotal) * 1000) / 10
      : 0,
    excluded_themes: NON_PRICEABLE_THEMES,
    excluded_count: total - priceableTotal,
  };
  const pcPopulated = Number(sets?.pc_populated || 0);
  const pcBootstrap = {
    eligible: beEligible,
    populated: pcPopulated,
    remaining: Math.max(0, beEligible - pcPopulated),
    pct: beEligible ? Math.round((pcPopulated / beEligible) * 1000) / 10 : 0,
  };
  const bricksetEnrichRemaining = Number(sets?.brickset_enrich_remaining || 0);
  return {
    ...sets,
    quality,
    blend_quality: blendQuality,
    be_bootstrap: beBootstrap,
    pc_bootstrap: pcBootstrap,
    priceable,
    brickset_enrich_remaining: bricksetEnrichRemaining,
    barcode_health: barcodeHealthOut,
    sets_with_bricklink: bricklinkCount,
    barcode_coverage_pct: retailBarcodePct,
    barcode_coverage_all_pct: pct(barcodeCount),
    barcode_retail_total: retailTotal,
    barcode_retail_with_upc: retailWithUpc,
    ebay_coverage_pct: pct(ebayCount),
    ebay_new_coverage_pct: pct(ebayNewCount),
    ebay_used_coverage_pct: pct(ebayUsedCount),
    bricklink_coverage_pct: pct(bricklinkCount),
    bricklink_new_coverage_pct: pct(bricklinkNewCount),
    bricklink_used_coverage_pct: pct(bricklinkUsedCount),
    valuation_methods: valuationMethods.results || [],
  };
}

export async function getPopulationSnapshot(env: Env) {
  const [coverage, minifigs, ebayAttempts, latestBarcode, ebayHealth, ownedCov, pricingV3] = await Promise.all([
    getDataCoverage(env),
    env.DB.prepare(`SELECT CAST(COUNT(*) AS INTEGER) AS total_minifigs FROM minifigs`).first<{ total_minifigs: number }>(),
    env.DB.prepare(`
      SELECT
        CAST(SUM(CASE WHEN ebay_new_value IS NOT NULL OR ebay_new_cached_at IS NOT NULL OR ebay_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS ebay_new_attempted,
        CAST(SUM(CASE WHEN ebay_used_value IS NOT NULL OR ebay_used_cached_at IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS ebay_used_attempted
      FROM lego_sets
    `).first<{ ebay_new_attempted: number; ebay_used_attempted: number }>(),
    env.DB.prepare(`
      SELECT error FROM import_runs
      WHERE error LIKE '%method:bulk%complete:true%'
         OR error LIKE '%barcode_complete:%'
      ORDER BY started_at DESC
      LIMIT 1
    `).first<{ error: string | null }>(),
    env.DB.prepare(`
      SELECT last_ok_at, last_fail_at, last_error,
             (blocked_until IS NOT NULL AND blocked_until > datetime('now')) AS block_active
      FROM integration_health
      WHERE service='ebay'
    `).first<{ last_ok_at: string | null; last_fail_at: string | null; last_error: string | null; block_active: number }>(),
    // User-visible slice: how many owned/wishlisted sets carry a real
    // (non-formula) market value vs a formula estimate — the coverage users
    // actually see in their portfolio.
    env.DB.prepare(`
      SELECT
        CAST(COUNT(*) AS INTEGER) AS total,
        CAST(SUM(CASE WHEN valuation_method IS NOT NULL AND valuation_method <> 'formula_bulk' THEN 1 ELSE 0 END) AS INTEGER) AS non_formula,
        CAST(SUM(CASE WHEN bl_new_value IS NOT NULL OR ebay_new_value IS NOT NULL OR ebay_used_value IS NOT NULL OR bo_new_value IS NOT NULL OR bo_used_value IS NOT NULL OR ebay_ask_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS has_real,
        CAST(SUM(CASE WHEN blended_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS has_blended
      FROM lego_sets
      WHERE set_num IN (SELECT set_num FROM user_collection WHERE deleted_at IS NULL)
         OR set_num IN (SELECT set_num FROM user_wishlist)
    `).first<{ total: number; non_formula: number; has_real: number; has_blended: number }>(),
    env.DB.prepare(`
      SELECT CAST(COUNT(*) AS INTEGER) AS missing
      FROM lego_sets ls
      LEFT JOIN set_valuation_state sv
        ON sv.set_num=ls.set_num
       AND sv.condition='new_sealed'
       AND sv.model_version='v3-shadow'
      WHERE sv.set_num IS NULL
    `).first<{ missing: number }>().catch(() => ({ missing: 0 })),
  ]);
  const c = coverage as Record<string, any>;
  const totalSets = Number(c.total_sets || 0);
  const totalMinifigs = Number(minifigs?.total_minifigs || 0);
  const ebayNewAttempted = Number(ebayAttempts?.ebay_new_attempted || 0);
  const ebayUsedAttempted = Number(ebayAttempts?.ebay_used_attempted || 0);
  const ebayConfigured = !!(
    env.EBAY_APP_ID &&
    env.EBAY_CLIENT_SECRET &&
    !env.EBAY_APP_ID.includes('dummy') &&
    !env.EBAY_CLIENT_SECRET.includes('dummy')
  );
  const ebayFailAt = ebayHealth?.last_fail_at ? Date.parse(ebayHealth.last_fail_at) : 0;
  const ebayOkAt = ebayHealth?.last_ok_at ? Date.parse(ebayHealth.last_ok_at) : 0;
  const ebayAccessBlocked = ebayConfigured && (
    !!ebayHealth?.block_active ||
    (ebayFailAt >= ebayOkAt && isEbayAccessError(ebayHealth?.last_error))
  );
  const formulaBulkCount = Number((c.valuation_methods || []).find((m: { valuation_method?: string; count?: number }) => m.valuation_method === 'formula_bulk')?.count || 0);
  const barcodePassComplete = /complete:true|barcode_complete:true/i.test(String(latestBarcode?.error || ''));
  const ebaySourceAvailable = ebayConfigured && !ebayAccessBlocked;
  const ocTotal = Number(ownedCov?.total || 0);
  const ownedCoverage = {
    total: ocTotal,
    non_formula: Number(ownedCov?.non_formula || 0),
    has_real: Number(ownedCov?.has_real || 0),
    has_blended: Number(ownedCov?.has_blended || 0),
    non_formula_pct: ocTotal ? Math.round((Number(ownedCov?.non_formula || 0) / ocTotal) * 1000) / 10 : 0,
    has_real_pct: ocTotal ? Math.round((Number(ownedCov?.has_real || 0) / ocTotal) * 1000) / 10 : 0,
  };
  return {
    ...c,
    total_sets: totalSets,
    total_minifigs: totalMinifigs,
    ebay_new_attempted: ebayNewAttempted,
    ebay_used_attempted: ebayUsedAttempted,
    ebay_configured: ebayConfigured,
    ebay_access_blocked: ebayAccessBlocked,
    ebay_source_available: ebaySourceAvailable,
    owned_coverage: ownedCoverage,
    pricing_v3_missing: Number(pricingV3?.missing || 0),
    formula_bulk_count: formulaBulkCount,
    ebay_new_attempted_pct: totalSets ? Math.round((ebayNewAttempted / totalSets) * 1000) / 10 : 0,
    ebay_used_attempted_pct: totalSets ? Math.round((ebayUsedAttempted / totalSets) * 1000) / 10 : 0,
    barcode_pass_complete: barcodePassComplete,
    ebay_attempts_complete: !ebaySourceAvailable || (totalSets > 0 && ebayNewAttempted >= totalSets && ebayUsedAttempted >= totalSets),
    catalog_ready: totalSets > 0,
    minifigs_ready: totalMinifigs > 0,
  };
}

export function populationDone(snapshot: Awaited<ReturnType<typeof getPopulationSnapshot>>): boolean {
  if (!snapshot.catalog_ready || !snapshot.minifigs_ready) return false;
  if (Number(snapshot.pricing_v3_missing || 0) > 0) return false;
  if (Number((snapshot as Record<string, any>).formula_bulk_count || 0) > 0) return false;
  if (Number((snapshot as Record<string, any>).needs_market_refresh || 0) > 0) return false;
  if (!snapshot.ebay_attempts_complete) return false;
  // Some LEGO sets simply do not have published UPCs, so a completed barcode
  // pass is stronger evidence than requiring 100% UPC coverage.
  if (!snapshot.barcode_pass_complete && Number((snapshot as Record<string, any>).missing_upc || 0) > 0) return false;
  return true;
}

export function populationRemainingNote(snapshot: Awaited<ReturnType<typeof getPopulationSnapshot>>): string {
  const quality = (snapshot as Record<string, any>).quality || {};
  const parts = [
    `sets:${snapshot.total_sets}`,
    `minifigs:${snapshot.total_minifigs}`,
    `missing_upc:${quality.missing_upc ?? 0}`,
    `needs_market_refresh:${quality.needs_market_refresh ?? 0}`,
    `formula_bulk:${(snapshot as Record<string, any>).formula_bulk_count ?? 0}`,
    `pricing_v3_missing:${snapshot.pricing_v3_missing ?? 0}`,
    `ebay_new_attempted:${snapshot.ebay_new_attempted}/${snapshot.total_sets}`,
    `ebay_used_attempted:${snapshot.ebay_used_attempted}/${snapshot.total_sets}`,
    `ebay_available:${(snapshot as Record<string, any>).ebay_source_available ?? false}`,
    `ebay_blocked:${(snapshot as Record<string, any>).ebay_access_blocked ?? false}`,
    `barcode_complete:${snapshot.barcode_pass_complete}`,
  ];
  return parts.join(' ');
}

export async function getMarketExtCoverage(env: Env): Promise<{
  sets_with_pa: number; sets_in_stock: number; sets_with_pc_loose: number; sets_with_sales_volume: number;
  last_bulk: unknown;
}> {
  let counts = { sets_with_pa: 0, sets_in_stock: 0, sets_with_pc_loose: 0, sets_with_sales_volume: 0 };
  try {
    const row = await env.DB.prepare(`
      SELECT
        COUNT(pa_lowest_offer) AS sets_with_pa,
        COALESCE(SUM(CASE WHEN pa_in_stock = 1 THEN 1 ELSE 0 END), 0) AS sets_in_stock,
        COUNT(pc_loose_value) AS sets_with_pc_loose,
        COUNT(pc_sales_volume) AS sets_with_sales_volume
      FROM set_market_ext
    `).first<typeof counts>();
    if (row) counts = row;
  } catch { /* table may not exist yet */ }

  let last_bulk: unknown = null;
  try {
    const r = await env.DB.prepare(`SELECT value FROM app_settings WHERE key='pc_bulk_last_result'`).first<{ value: string }>();
    if (r?.value) last_bulk = JSON.parse(r.value);
  } catch { /* none yet */ }

  return { ...counts, last_bulk };
}

// Firecrawl credit-spend + BrickEconomy bootstrap snapshot for the admin panel.
// Surfaces today's credit burn against the daily ceiling and how much of the
// be_value_new backfill is left, so it's clear when the temporary 4x/hour
// bootstrap cron can be retired and FIRECRAWL_DAILY_CREDITS reset.
export function buildFirecrawlDiagnostics(
  env: Env,
  quota: Array<{ service: string; used: number; cap: number; remaining: number }>,
  coverage: {
    be_bootstrap?: { eligible: number; populated: number; remaining: number; pct: number };
    pc_bootstrap?: { eligible: number; populated: number; remaining: number; pct: number };
  },
) {
  const override = Number(env.FIRECRAWL_DAILY_CREDITS);
  const dailyCap = Number.isFinite(override) && override > 0 ? override : QUOTA_CAPS.firecrawl;
  const row = quota.find((q) => q.service === 'firecrawl');
  const creditsUsedToday = row?.used ?? 0;
  const be = coverage.be_bootstrap || { eligible: 0, populated: 0, remaining: 0, pct: 0 };
  const pc = coverage.pc_bootstrap || { eligible: 0, populated: 0, remaining: 0, pct: 0 };
  // Count configured Firecrawl keys for key-rotation visibility.
  const extraKeys = env.FIRECRAWL_API_KEYS?.split(',').map(k => k.trim()).filter(Boolean) ?? [];
  const keyCount = (env.FIRECRAWL_API_KEY ? 1 : 0) + extraKeys.length;
  // The ceiling is raised above the steady-state default only for the one-time
  // bootstrap, so a non-default cap is a reliable "bootstrap mode" signal.
  // Both one-time catalog bootstraps (PriceCharting per-set + BrickEconomy) have
  // been retired: PC coverage rides the daily bulk CSV, and the BrickEconomy sweep
  // is complete (full year>=2000 pass; be.pct is BrickEconomy's real coverage
  // ceiling, NOT unfinished work — the enrich stamps misses so they aren't
  // re-scraped). So be.remaining > 0 is permanent and must NOT read as "in
  // progress". A non-default cap now means someone manually re-raised credits.
  // be/pc fill % are still returned as coverage signals.
  const bootstrapElevated = dailyCap > QUOTA_CAPS.firecrawl;
  let recommendedAction: string;
  if (!env.FIRECRAWL_API_KEY && !env.FIRECRAWL_API_KEYS) {
    recommendedAction = 'Add FIRECRAWL_API_KEY as a GitHub Actions secret to enable BrickEconomy/eBay scraping.';
  } else if (bootstrapElevated) {
    recommendedAction = `Firecrawl daily ceiling is ${dailyCap.toLocaleString()} — above the ${QUOTA_CAPS.firecrawl} steady-state default. If no manual catalog bootstrap is running, reset FIRECRAWL_DAILY_CREDITS to ${QUOTA_CAPS.firecrawl}.`;
  } else {
    recommendedAction = `Steady state — Firecrawl on the ${QUOTA_CAPS.firecrawl}/day default; one-time catalog bootstraps retired. BrickEconomy coverage ${be.pct}% (its real ceiling); gap-fills via the manual bootstrap-brickeconomy workflow.`;
  }
  return {
    configured: !!env.FIRECRAWL_API_KEY || !!env.FIRECRAWL_API_KEYS,
    key_count: keyCount,
    credits_used_today: creditsUsedToday,
    daily_cap: dailyCap,
    credits_remaining: Math.max(0, dailyCap - creditsUsedToday),
    bootstrap_enabled: bootstrapElevated,
    bootstrap: be,
    pc_bootstrap: pc,
    recommended_action: recommendedAction,
  };
}
