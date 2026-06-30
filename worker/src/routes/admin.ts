import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { importSets, importFigs } from '../jobs/import-catalog';
import { nextBackfillPage, runBackfillUpc } from '../jobs/backfill-upc';
import { BARCODE_PAGE_SIZE } from '../lib/brickset';
import { runEbayBackfill, runValuateSets } from '../jobs/valuate-sets';
import { ebaySoldCompsEnabled, pricesapiEnabled } from '../lib/pricing-flags';
import { getIntegrationDiagnostics } from '../lib/integration-health';
import { getQuotaUsage, QUOTA_CAPS } from '../lib/api-quota';
import { getAiUsageReport } from '../lib/ai-usage';
import { isEbayAccessError } from '../lib/ebay';
import { rebuildSearchIndex } from '../lib/search-index';
import { runLegoStockRefresh } from '../jobs/lego-stock-refresh';
import { runBricksetEnrich } from '../jobs/brickset-enrich';
import { runBrickEconomyEnrich } from '../jobs/brickeconomy-enrich';
import { runBrickInsightsBackfill } from '../jobs/brickinsights';
import { runBlendRecomputeBackfill } from '../jobs/recompute-blends';
import { runPriceChartingBulk, runPriceChartingBulkFetch } from '../jobs/pricecharting-bulk';
import { getKeyPoolStatus } from '../lib/pricesapi-keys';
import { getKeyPoolStatus as getBrightDataPoolStatus } from '../lib/brightdata-keys';
import { getSourceConfig, saveSourceConfig, DEFAULT_SOURCE_CONFIG } from '../lib/source-config';
import { getRecentRuns, recordCronStart, recordCronFinish, summarizeResult } from '../lib/cron-runs';
import { runPricesApiRetail } from '../jobs/pricesapi-retail';
import { PROCESS_REGISTRY, GROUP_ORDER, processInfo } from '../lib/process-registry';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireAdmin);

type JobProgress = {
  current?: number | null;
  total?: number | null;
  label?: string | null;
  setsLoaded?: number | null;
  setsSkipped?: number | null;
  themesLoaded?: number | null;
  figsLoaded?: number | null;
  note?: string | null;
};

async function createImportRun(env: Env, jobType: string, label: string, total: number | null = null, note: string | null = null): Promise<number> {
  const run = await env.DB.prepare(`
    INSERT INTO import_runs (job_type, status, progress_current, progress_total, progress_label, error, updated_at)
    VALUES (?, 'running', 0, ?, ?, ?, datetime('now'))
  `).bind(jobType, total, label, note).run();
  return run.meta.last_row_id as number;
}

async function updateImportRunProgress(env: Env, runId: number, progress: JobProgress): Promise<void> {
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

async function completeImportRun(env: Env, runId: number, progress: JobProgress): Promise<void> {
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

async function failImportRun(env: Env, runId: number, error: unknown): Promise<void> {
  await env.DB.prepare(
    "UPDATE import_runs SET status='error',error=?,progress_label='Failed',completed_at=datetime('now'),updated_at=datetime('now') WHERE id=?"
  ).bind((error as Error).message || String(error), runId).run();
}

const IMPORT_RUN_FIELDS = `
  id, job_type, status, started_at, updated_at, completed_at,
  progress_current, progress_total, progress_label,
  themes_loaded, sets_loaded, sets_skipped, figs_loaded, error
`;

const RUN_MAX_AGE_MINUTES = 30;
const RUN_HEARTBEAT_STALE_MINUTES = 10;
const RUN_STOPPED_ERROR = `Worker run stopped before completion (no progress heartbeat for ${RUN_HEARTBEAT_STALE_MINUTES} minutes)`;

async function expireStaleImportRuns(env: Env) {
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

async function getActiveImportRun(env: Env) {
  await expireStaleImportRuns(env);
  return env.DB.prepare(`
    SELECT id, started_at, updated_at, progress_label
    FROM import_runs
    WHERE status='running'
    ORDER BY started_at DESC
    LIMIT 1
  `).first<{ id: number; started_at: string; updated_at: string | null; progress_label: string | null }>();
}

async function getDataCoverage(env: Env) {
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
        CAST(SUM(CASE WHEN year >= 2000 AND pc_new_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS pc_populated
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

async function getPopulationSnapshot(env: Env) {
  const [coverage, minifigs, ebayAttempts, latestBarcode, ebayHealth, ownedCov] = await Promise.all([
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
      WHERE error LIKE '%method:bulk%' OR error LIKE '%barcode_complete:%' OR error LIKE '%method:populate-everything%'
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
    formula_bulk_count: formulaBulkCount,
    ebay_new_attempted_pct: totalSets ? Math.round((ebayNewAttempted / totalSets) * 1000) / 10 : 0,
    ebay_used_attempted_pct: totalSets ? Math.round((ebayUsedAttempted / totalSets) * 1000) / 10 : 0,
    barcode_pass_complete: barcodePassComplete,
    ebay_attempts_complete: !ebaySourceAvailable || (totalSets > 0 && ebayNewAttempted >= totalSets && ebayUsedAttempted >= totalSets),
    catalog_ready: totalSets > 0,
    minifigs_ready: totalMinifigs > 0,
  };
}

function populationDone(snapshot: Awaited<ReturnType<typeof getPopulationSnapshot>>): boolean {
  if (!snapshot.catalog_ready || !snapshot.minifigs_ready) return false;
  if (Number((snapshot as Record<string, any>).formula_bulk_count || 0) > 0) return false;
  if (Number((snapshot as Record<string, any>).needs_market_refresh || 0) > 0) return false;
  if (!snapshot.ebay_attempts_complete) return false;
  // Some LEGO sets simply do not have published UPCs, so a completed barcode
  // pass is stronger evidence than requiring 100% UPC coverage.
  if (!snapshot.barcode_pass_complete && Number((snapshot as Record<string, any>).missing_upc || 0) > 0) return false;
  return true;
}

function populationRemainingNote(snapshot: Awaited<ReturnType<typeof getPopulationSnapshot>>): string {
  const quality = (snapshot as Record<string, any>).quality || {};
  const parts = [
    `sets:${snapshot.total_sets}`,
    `minifigs:${snapshot.total_minifigs}`,
    `missing_upc:${quality.missing_upc ?? 0}`,
    `needs_market_refresh:${quality.needs_market_refresh ?? 0}`,
    `formula_bulk:${(snapshot as Record<string, any>).formula_bulk_count ?? 0}`,
    `ebay_new_attempted:${snapshot.ebay_new_attempted}/${snapshot.total_sets}`,
    `ebay_used_attempted:${snapshot.ebay_used_attempted}/${snapshot.total_sets}`,
    `ebay_available:${(snapshot as Record<string, any>).ebay_source_available ?? false}`,
    `ebay_blocked:${(snapshot as Record<string, any>).ebay_access_blocked ?? false}`,
    `barcode_complete:${snapshot.barcode_pass_complete}`,
  ];
  return parts.join(' ');
}

app.post('/import-rebrickable', async (c) => {
  const body = await c.req.json<{ dataset?: string }>().catch(() => ({ dataset: undefined }));
  const dataset = body.dataset ?? 'sets';
  if (!['sets', 'figs', 'all'].includes(dataset)) {
    return c.json({ error: "dataset must be 'sets', 'figs', or 'all'" }, 400);
  }

  const active = await getActiveImportRun(c.env);
  if (active) {
    return c.json({ error: 'An import is already running.', run_id: active.id, started_at: active.started_at }, 409);
  }

  const runId = await createImportRun(
    c.env,
    dataset === 'all' ? 'catalog_all' : `catalog_${dataset}`,
    dataset === 'figs' ? 'Starting minifig import' : dataset === 'all' ? 'Starting full catalog import' : 'Starting set import',
  );

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const result: Record<string, unknown> = {};
        if (dataset === 'sets' || dataset === 'all') {
          const r = await importSets(c.env.DB, c.env, {
            onProgress: async (p) => updateImportRunProgress(c.env, runId, {
              current: p.current,
              total: p.total,
              label: p.label,
              setsLoaded: p.label.includes('sets') ? p.current : undefined,
            }),
          });
          result.sets_loaded = r.loaded;
          result.sets_skipped = r.skipped;
          result.themes_loaded = r.themes;
        }
        if (dataset === 'figs' || dataset === 'all') {
          const r = await importFigs(c.env.DB, c.env, {
            onProgress: async (p) => updateImportRunProgress(c.env, runId, {
              current: p.current,
              total: p.total,
              label: p.label,
              figsLoaded: p.current,
            }),
          });
          result.figs_loaded = r.loaded;
        }
        const finalTotal = Number(result.sets_loaded || 0) + Number(result.figs_loaded || 0);
        await completeImportRun(c.env, runId, {
          current: finalTotal || null,
          total: finalTotal || null,
          label: 'Import completed',
          themesLoaded: result.themes_loaded as number | null,
          setsLoaded: result.sets_loaded as number | null,
          setsSkipped: result.sets_skipped as number | null,
          figsLoaded: result.figs_loaded as number | null,
        });
      } catch (e) {
        await failImportRun(c.env, runId, e);
      }
    })()
  );

  return c.json({ ok: true, status: 'running', run_id: runId });
});

// Optional PriceCharting bulk CSV import (Legendary tier). Accepts the raw CSV
// text the admin downloaded from their PriceCharting Subscriptions page. Runs in
// the background; the summary lands in app_settings['pc_bulk_last_result'] and is
// surfaced in /integrations diagnostics.
app.post('/pricecharting-bulk', async (c) => {
  if (!/^(1|true|yes|on)$/i.test(String(c.env.PRICECHARTING_PRO ?? ''))) {
    return c.json({ error: 'PRICECHARTING_PRO not set — bulk CSV requires the PriceCharting Legendary tier.' }, 400);
  }
  const csv = await c.req.text().catch(() => '');
  if (!csv.trim() || csv.indexOf('\n') < 0) {
    return c.json({ error: 'Empty or malformed CSV body.' }, 400);
  }
  c.executionCtx.waitUntil(
    runPriceChartingBulk(c.env, csv).catch((e) => console.warn('[pc-bulk] failed:', (e as Error).message)),
  );
  return c.json({ ok: true, status: 'running', note: 'Bulk import started; check integrations diagnostics for the result.' });
});

// On-demand PriceCharting LEGO bulk fetch — downloads the lego-sets CSV directly
// (Legendary tier; the download endpoint enforces it). Guards the 1-per-10-minute
// CSV download limit using the last run's timestamp.
app.post('/pricecharting-bulk-fetch', async (c) => {
  if (!c.env.PRICECHARTING_TOKEN) {
    return c.json({ error: 'PRICECHARTING_TOKEN not set.' }, 400);
  }
  try {
    const last = await c.env.DB.prepare(`SELECT value FROM app_settings WHERE key='pc_bulk_last_result'`).first<{ value: string }>();
    const finishedAt = last?.value ? Date.parse(JSON.parse(last.value)?.finished_at ?? '') : NaN;
    if (Number.isFinite(finishedAt) && Date.now() - finishedAt < 10 * 60_000) {
      return c.json({ error: 'PriceCharting CSV downloads are limited to once per 10 minutes. Try again shortly.' }, 429);
    }
  } catch { /* best-effort guard */ }
  c.executionCtx.waitUntil(
    runPriceChartingBulkFetch(c.env).catch((e) => console.warn('[pc-bulk-fetch] failed:', (e as Error).message)),
  );
  return c.json({ ok: true, status: 'running', message: 'LEGO price-guide download started — results appear in diagnostics shortly.' });
});

// On-demand pricesAPI.io live-retail refresh — same path as the daily cron, but
// triggered manually so freshly-added keys can be verified without waiting for
// 17:00 UTC. pricesAPI cold calls run 30–90s each, so this runs in the background
// (a synchronous request would time out) and is recorded into cron_runs so the
// Activity feed shows it go Running → OK/Failed with a summary.
app.post('/run-pricesapi', async (c) => {
  if (!pricesapiEnabled(c.env)) {
    return c.json({ error: 'pricesAPI is not enabled. Set PRICESAPI_API_KEYS (one or more keys) and PRICESAPI_ENABLED=1.' }, 400);
  }
  const body = await c.req.json<{ limit?: number }>().catch(() => ({} as { limit?: number }));
  const requested = Number(body.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), 10) : 3;

  c.executionCtx.waitUntil((async () => {
    const startedMs = Date.now();
    const runId = await recordCronStart(c.env, 'pricesapi-retail').catch(() => null);
    try {
      const res = await runPricesApiRetail(c.env, { limit });
      await recordCronFinish(c.env, runId, 'pricesapi-retail', { ok: true, summary: summarizeResult(res), durationMs: Date.now() - startedMs }).catch(() => {});
    } catch (e) {
      await recordCronFinish(c.env, runId, 'pricesapi-retail', { ok: false, error: (e as Error).message, durationMs: Date.now() - startedMs }).catch(() => {});
    }
  })());

  return c.json({ ok: true, status: 'running', limit, message: 'pricesAPI refresh started — watch the Activity tab for the result (cold calls take up to ~90s each).' });
});

app.get('/import-status/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  await expireStaleImportRuns(c.env);
  const row = await c.env.DB.prepare(
    `SELECT ${IMPORT_RUN_FIELDS} FROM import_runs WHERE id=?`
  ).bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'run not found' }, 404);
  return c.json(row);
});

// POST /api/admin/backfill-upc
// Paginates through the full Brickset catalog and fills lego_sets.upc for
// every set that is missing a barcode. Safe to re-run — skips already-filled rows.
app.post('/backfill-upc', async (c) => {
  if (!c.env.BRICKSET_API_KEY) {
    return c.json({ error: 'BRICKSET_API_KEY secret not configured on the worker.' }, 500);
  }

  const active = await getActiveImportRun(c.env);
  if (active) return c.json({ error: 'An import is already running.', run_id: active.id }, 409);

  const runId = await createImportRun(c.env, 'barcode_backfill', 'Starting barcode backfill', 2000);

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const startPage = await nextBackfillPage(c.env);
        await updateImportRunProgress(c.env, runId, {
          current: 0,
          total: 2000,
          label: `Reading Brickset pages from ${startPage}`,
          note: `method:bulk start_page:${startPage}`,
        });
        const r = await runBackfillUpc(c.env, {
          startPage,
          maxPages: 4,
          onProgress: async (p) => {
            await updateImportRunProgress(c.env, runId, {
              current: p.processed,
              total: p.complete ? p.processed : Math.max(2000, p.processed),
              label: p.complete ? 'Barcode backfill complete' : `Barcode page ${p.nextPage ? p.nextPage - 1 : startPage}`,
              setsLoaded: p.filled,
              setsSkipped: p.processed,
              note: `method:bulk start_page:${startPage} next_page:${p.nextPage ?? ''} complete:${p.complete}`,
            });
          },
        });
        if (r.error) {
          await failImportRun(c.env, runId, r.error);
        } else {
          await completeImportRun(c.env, runId, {
            current: r.processed,
            total: r.processed,
            label: 'Barcode backfill completed',
            setsLoaded: r.filled,
            setsSkipped: r.processed,
            note: r.note ?? `method:${r.method} catalog:${r.catalogSize} next_page:${r.nextPage ?? ''} complete:${r.complete}`,
          });
        }
      } catch (e) {
        await failImportRun(c.env, runId, e);
      }
    })()
  );

  return c.json({ ok: true, status: 'running', run_id: runId });
});

// POST /api/admin/populate-coverage
// Starts one safe coverage campaign slice: Brickset barcode pages plus a tiny
// eBay sold-price pass. Repeat or let the daily cron continue from there.
app.post('/populate-coverage', async (c) => {
  const active = await getActiveImportRun(c.env);
  if (active) return c.json({ error: 'An import or coverage job is already running.', run_id: active.id }, 409);

  const runId = await createImportRun(
    c.env,
    'populate_coverage',
    'Starting coverage slice',
    2002,
    'method:populate-coverage barcode_pages:4 ebay_limit:2',
  );

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const startPage = await nextBackfillPage(c.env);
        const barcode = await runBackfillUpc(c.env, {
          startPage,
          maxPages: 4,
          onProgress: async (p) => {
            await updateImportRunProgress(c.env, runId, {
              current: p.processed,
              total: p.complete ? p.processed + 2 : Math.max(2002, p.processed + 2),
              label: p.complete ? 'Checking eBay sold comps' : `Barcode page ${p.nextPage ? p.nextPage - 1 : startPage}`,
              setsLoaded: p.filled,
              setsSkipped: p.processed,
              note: `method:populate-coverage barcode_start:${startPage} next_page:${p.nextPage ?? ''} barcode_complete:${p.complete}`,
            });
          },
        });
        await updateImportRunProgress(c.env, runId, {
          current: barcode.processed,
          total: barcode.processed + 2,
          label: 'Checking eBay sold comps',
        });
        const ebay = await runEbayBackfill(c.env, { limit: 2 });
        await completeImportRun(c.env, runId, {
          current: barcode.processed + ebay.processed,
          total: barcode.processed + ebay.processed,
          label: 'Coverage slice completed',
          setsLoaded: barcode.filled + ebay.updated,
          setsSkipped: barcode.processed + ebay.processed,
          note: barcode.note ?? `method:populate-coverage barcode:${barcode.filled}/${barcode.processed} ebay:${ebay.updated}/${ebay.processed} next_page:${barcode.nextPage ?? ''}`,
        });
      } catch (e) {
        await failImportRun(c.env, runId, e);
      }
    })()
  );

  return c.json({ ok: true, status: 'running', run_id: runId });
});

// POST /api/admin/revalue-brickeconomy
// Starts a bounded full-catalog valuation slice. The daily cron runs the same
// path automatically; manual presses simply advance the queue immediately.
// Body: { scope?: 'all' | 'owned' | 'stale', limit?: number }
app.post('/revalue-brickeconomy', async (c) => {
  const body = await c.req.json<{ scope?: string; limit?: number }>().catch(() => ({} as { scope?: string; limit?: number }));
  const scope = body.scope || 'all';
  const requested = Number(body.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), 4)
    : 4;

  if (!['all', 'owned', 'stale'].includes(scope)) {
    return c.json({ error: "scope must be 'all', 'owned', or 'stale'" }, 400);
  }

  const active = await getActiveImportRun(c.env);
  if (active) return c.json({ error: 'An import or valuation job is already running.', run_id: active.id }, 409);

  const runId = await createImportRun(
    c.env,
    'valuation',
    `Starting ${scope} valuation`,
    limit,
    `method:valuation scope:${scope} limit:${limit}`,
  );

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const result = await runValuateSets(c.env, {
          scope: scope === 'owned' ? 'owned' : 'all',
          includeFresh: scope === 'all',
          includeAiFallback: scope !== 'all',
          sourceRetries: 0,
          sourceTimeoutMs: 5000,
          limit,
          onProgress: async (p) => updateImportRunProgress(c.env, runId, {
            current: p.processed,
            total: p.total,
            label: p.currentSet ? `Revaluing ${p.currentSet}` : 'Revaluing prices',
            setsLoaded: p.updated,
            setsSkipped: p.processed,
            note: `method:valuation scope:${scope} limit:${limit} processed:${p.processed} updated:${p.updated}`,
          }),
        });
        await completeImportRun(c.env, runId, {
          current: result.processed,
          total: result.processed,
          label: 'Valuation batch completed',
          setsLoaded: result.updated,
          setsSkipped: result.processed,
          note: `method:valuation scope:${scope} limit:${limit} processed:${result.processed} updated:${result.updated}`,
        });
      } catch (err) {
        await failImportRun(c.env, runId, err);
      }
    })()
  );

  return c.json({ ok: true, status: 'running', run_id: runId, scope, limit });
});

// POST /api/admin/populate-everything
// Runs one safe full-data campaign slice across every configured provider.
// The frontend can auto-repeat this endpoint until the completion note says
// complete:true. Each slice stays bounded for Worker limits and provider quotas.
app.post('/populate-everything', async (c) => {
  const body = await c.req.json<{ valuation_limit?: number; barcode_pages?: number; ebay_limit?: number }>()
    .catch(() => ({} as { valuation_limit?: number; barcode_pages?: number; ebay_limit?: number }));
  const valuationLimit = Number.isFinite(Number(body.valuation_limit)) && Number(body.valuation_limit) > 0
    ? Math.min(Math.floor(Number(body.valuation_limit)), 8)
    : 5;
  const barcodePages = Number.isFinite(Number(body.barcode_pages)) && Number(body.barcode_pages) > 0
    ? Math.min(Math.floor(Number(body.barcode_pages)), 6)
    : 4;
  const ebayLimit = Number.isFinite(Number(body.ebay_limit)) && Number(body.ebay_limit) > 0
    ? Math.min(Math.floor(Number(body.ebay_limit)), 2)
    : 2;

  const active = await getActiveImportRun(c.env);
  if (active) return c.json({ error: 'A data population job is already running.', run_id: active.id }, 409);

  const before = await getPopulationSnapshot(c.env);
  const alreadyDone = populationDone(before);
  const runId = await createImportRun(
    c.env,
    'populate_everything',
    alreadyDone ? 'All configured sources already populated' : 'Starting full data population',
    600,
    `method:populate-everything complete:${alreadyDone} ${populationRemainingNote(before)}`,
  );

  c.executionCtx.waitUntil(
    (async () => {
      const phaseSize = 100;
      const total = 600;
      let updated = 0;
      let processed = 0;
      let barcodePhaseRan = false;
      const phaseProgress = async (phase: number, label: string, current = 0, phaseTotal = 1, note?: string) => {
        const withinPhase = phaseTotal > 0 ? Math.round(Math.min(1, Math.max(0, current / phaseTotal)) * phaseSize) : 0;
        await updateImportRunProgress(c.env, runId, {
          current: Math.min(total, phase * phaseSize + withinPhase),
          total,
          label,
          setsLoaded: updated,
          setsSkipped: processed,
          note,
        });
      };

      try {
        let snapshot = before;
        if (alreadyDone) {
          await completeImportRun(c.env, runId, {
            current: total,
            total,
            label: 'All configured sources populated',
            note: `method:populate-everything complete:true ${populationRemainingNote(before)}`,
          });
          return;
        }

        if (!snapshot.catalog_ready) {
          await phaseProgress(0, 'Importing Rebrickable sets', 0, 1);
          const sets = await importSets(c.env.DB, c.env, {
            onProgress: async (p) => phaseProgress(
              0,
              p.label,
              p.current,
              p.total || Math.max(p.current, 1),
            ),
          });
          updated += sets.loaded;
          processed += sets.loaded + sets.skipped;
        } else {
          await phaseProgress(0, 'Set catalog already imported', 1, 1);
        }

        snapshot = await getPopulationSnapshot(c.env);
        if (!snapshot.minifigs_ready) {
          await phaseProgress(1, 'Importing Rebrickable minifigs', 0, 1);
          const figs = await importFigs(c.env.DB, c.env, {
            onProgress: async (p) => phaseProgress(
              1,
              p.label,
              p.current,
              p.total || Math.max(p.current, 1),
            ),
          });
          updated += figs.loaded;
          processed += figs.loaded;
        } else {
          await phaseProgress(1, 'Minifig catalog already imported', 1, 1);
        }

        await phaseProgress(2, 'Rebuilding search index', 0, 1);
        await rebuildSearchIndex(c.env.DB);
        await phaseProgress(2, 'Search index rebuilt', 1, 1);

        snapshot = await getPopulationSnapshot(c.env);
        if (snapshot.catalog_ready && (!snapshot.barcode_pass_complete || Number(((snapshot as Record<string, any>).quality || {}).missing_upc || 0) > 0)) {
          const startPage = await nextBackfillPage(c.env);
          barcodePhaseRan = true;
          await phaseProgress(3, `Backfilling barcodes from page ${startPage}`, 0, barcodePages * BARCODE_PAGE_SIZE);
          const barcode = await runBackfillUpc(c.env, {
            startPage,
            maxPages: barcodePages,
            onProgress: async (p) => phaseProgress(
              3,
              p.complete ? 'Barcode pass complete' : `Barcode page ${p.nextPage ? p.nextPage - 1 : startPage}`,
              p.processed,
              p.complete ? Math.max(p.processed, 1) : barcodePages * BARCODE_PAGE_SIZE,
              `method:populate-everything step:barcode next_page:${p.nextPage ?? ''} barcode_complete:${p.complete}`,
            ),
          });
          updated += barcode.filled;
          processed += barcode.processed;
        } else {
          await phaseProgress(3, 'Barcode pass already complete', 1, 1);
        }

        snapshot = await getPopulationSnapshot(c.env);
        const includeEbay = !!snapshot.ebay_source_available;
        // This slice already spent subrequests on earlier phases (each barcode
        // page ≈ 1 fetch + D1 batch + progress write). Hand the valuation run
        // what realistically remains of the invocation's 50 so its packer can
        // size the batch instead of blowing the cap (see lib/api-quota.ts).
        const valuationBudget = Math.max(12, 40 - (barcodePhaseRan ? barcodePages * 4 : 0) - 8);
        await phaseProgress(4, 'Refreshing market data', 0, valuationLimit);
        const valuation = await runValuateSets(c.env, {
          scope: 'all',
          includeFresh: true,
          includeSupplemental: true,
          includeEbay,
          includeEbaySold: false,
          includeMinifigs: true,
          includeAiFallback: false,
          sourceRetries: 0,
          sourceTimeoutMs: 5000,
          limit: valuationLimit,
          subrequestBudget: valuationBudget,
          onProgress: async (p) => phaseProgress(
            4,
            p.currentSet ? `Refreshing ${p.currentSet}` : 'Refreshing market data',
            p.processed,
            Math.max(p.total, 1),
            `method:populate-everything step:valuation processed:${p.processed} updated:${p.updated}`,
          ),
        });
        updated += valuation.updated;
        processed += valuation.processed;

        if (includeEbay && ebaySoldCompsEnabled(c.env)) {
          await phaseProgress(5, 'Checking eBay sold comps', 0, ebayLimit);
          const ebay = await runEbayBackfill(c.env, { limit: ebayLimit });
          updated += ebay.updated;
          processed += ebay.processed;
          await phaseProgress(5, 'eBay sold-comps slice complete', ebay.processed, Math.max(ebayLimit, ebay.processed, 1));
        } else {
          await phaseProgress(5, 'eBay sold comps unavailable', 1, 1, 'method:populate-everything step:ebay skipped:unavailable');
        }

        const after = await getPopulationSnapshot(c.env);
        const done = populationDone(after);
        await completeImportRun(c.env, runId, {
          current: total,
          total,
          label: done ? 'All configured sources populated' : 'Safe full-data slice completed',
          setsLoaded: updated,
          setsSkipped: processed,
          note: `method:populate-everything complete:${done} ${populationRemainingNote(after)}`,
        });
      } catch (error) {
        await failImportRun(c.env, runId, error);
      }
    })()
  );

  return c.json({
    ok: true,
    status: alreadyDone ? 'completed' : 'running',
    run_id: runId,
    done: alreadyDone,
    coverage: before,
  });
});

// POST /api/admin/expire-valuations
// Force-expire all stale valuations so the hourly cron job picks them up.
// This is a quick way to trigger a mass re-valuation without calling BrickEconomy directly.
app.post('/expire-valuations', async (c) => {
  const result = await c.env.DB.prepare(`
    UPDATE lego_sets
    SET valuation_expires_at = datetime('now', '-1 day')
    WHERE valuation_method = 'formula_bulk'
       OR valuation_expires_at IS NULL
       OR valuation_expires_at > datetime('now')
  `).run();

  return c.json({ ok: true, expired: result.meta.changes });
});

// GET /api/admin/import-status
app.get('/import-status', async (c) => {
  await expireStaleImportRuns(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT ${IMPORT_RUN_FIELDS}
     FROM import_runs
     ORDER BY started_at DESC
     LIMIT 8`
  ).all();
  return c.json({ runs: results });
});

// Source-tuning console: read the effective config (defaults merged with stored
// overrides) plus the defaults so the UI can show a Reset affordance.
app.get('/source-config', async (c) => {
  const config = await getSourceConfig(c.env);
  return c.json({ config, defaults: DEFAULT_SOURCE_CONFIG });
});

// Persist tuned source config. Validated + clamped server-side (saveSourceConfig).
app.put('/source-config', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Expected a JSON object of source settings.' }, 400);
  const config = await saveSourceConfig(c.env, (body as { config?: unknown }).config ?? body);
  return c.json({ ok: true, config });
});

// Live "Activity" feed for the admin console: every background process with what
// it does + its latest run (status, when, duration, result), plus a recent
// chronological feed. The frontend merges this with admin import jobs.
app.get('/activity', async (c) => {
  const { latest, recent } = await getRecentRuns(c.env);
  const processes = Object.entries(PROCESS_REGISTRY).map(([name, info]) => {
    const r = latest[name];
    return {
      name,
      label: info.label,
      description: info.description,
      schedule: info.schedule,
      group: info.group,
      status: r?.status ?? 'idle',
      started_at: r?.started_at ?? null,
      finished_at: r?.finished_at ?? null,
      duration_ms: r?.duration_ms ?? null,
      summary: r?.summary ?? null,
      error: r?.error ?? null,
    };
  });
  const recentFeed = recent.map((r) => ({ ...r, label: processInfo(r.name).label, group: processInfo(r.name).group }));
  return c.json({ processes, recent: recentFeed, group_order: GROUP_ORDER, generated_at: new Date().toISOString() });
});

app.get('/integrations', async (c) => {
  const [integrations, coverage, quota, ai_usage, pricesapi_pool, market_ext, brightdata_pool] = await Promise.all([
    getIntegrationDiagnostics(c.env),
    getDataCoverage(c.env),
    getQuotaUsage(c.env),
    getAiUsageReport(c.env),
    getKeyPoolStatus(c.env),
    getMarketExtCoverage(c.env),
    getBrightDataPoolStatus(c.env),
  ]);
  const url = new URL(c.req.url);
  return c.json({
    integrations,
    coverage,
    quota,
    ai_usage,
    firecrawl: buildFirecrawlDiagnostics(c.env, quota, coverage),
    // Pricing v3 diagnostics: pricesAPI key-pool budget + PriceCharting extras
    // coverage + last bulk-import summary.
    pricesapi: {
      pool: pricesapi_pool,
      daily: quota.find((q) => q.service === 'pricesapi') ?? null,
    },
    brightdata: {
      pool: brightdata_pool,
      daily: quota.find((q) => q.service === 'brightdata') ?? null,
    },
    pricecharting_ext: {
      ...market_ext,
      last_bulk: market_ext.last_bulk,
    },
    api_routing: {
      worker_base_url: url.origin,
      config_endpoint: `${url.origin}/api/config`,
      pages_api_note: 'The Pages app uses window.WORKER_BASE for API calls.',
    },
  });
});

// set_market_ext coverage (pricesAPI pa_* + PriceCharting loose/sales-volume)
// plus the last bulk-import summary, for the pricing diagnostics panel. Fails
// open to zeros so the admin endpoint never errors on a fresh DB.
async function getMarketExtCoverage(env: Env): Promise<{
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
function buildFirecrawlDiagnostics(
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
  const bootstrapElevated = dailyCap > QUOTA_CAPS.firecrawl;
  const fillingBe = be.remaining > 0;
  const fillingPc = pc.remaining > 0;
  let recommendedAction: string;
  if (!env.FIRECRAWL_API_KEY && !env.FIRECRAWL_API_KEYS) {
    recommendedAction = 'Add FIRECRAWL_API_KEY as a GitHub Actions secret to enable BrickEconomy/eBay scraping.';
  } else if (fillingBe && fillingPc) {
    recommendedAction = `Bootstrap in progress — BrickEconomy: ${be.pct}%, PriceCharting: ${pc.pct}%. Leave the 4x/hour crons running.`;
  } else if (fillingBe) {
    recommendedAction = `BrickEconomy bootstrap in progress (${be.pct}% of ${be.eligible} sets). PriceCharting bootstrap complete.`;
  } else if (fillingPc) {
    recommendedAction = `PriceCharting bootstrap in progress (${pc.pct}% of ${pc.eligible} sets). BrickEconomy bootstrap complete — remove the "5,20,35,50 * * * *" trigger.`;
  } else if (bootstrapElevated) {
    recommendedAction = `Both bootstraps complete. Remove the temporary "5,20,35,50 * * * *" and "10,25,40,55 * * * *" triggers and reset FIRECRAWL_DAILY_CREDITS to the ${QUOTA_CAPS.firecrawl} default.`;
  } else {
    recommendedAction = 'Steady state — Firecrawl on the default daily ceiling.';
  }
  return {
    configured: !!env.FIRECRAWL_API_KEY || !!env.FIRECRAWL_API_KEYS,
    key_count: keyCount,
    credits_used_today: creditsUsedToday,
    daily_cap: dailyCap,
    credits_remaining: Math.max(0, dailyCap - creditsUsedToday),
    bootstrap_enabled: bootstrapElevated && (fillingBe || fillingPc),
    bootstrap: be,
    pc_bootstrap: pc,
    recommended_action: recommendedAction,
  };
}

app.post('/repair-search-index', async (c) => {
  const result = await rebuildSearchIndex(c.env.DB);
  return c.json({
    ok: true,
    message: 'Catalog search index rebuilt',
    ...result,
  });
});

// POST /api/admin/jobs/:job
// Ad-hoc trigger for cron-driven enrichment jobs. Useful for testing new
// scrapers, advancing a backfill, or debugging without waiting for a cron tick.
// Each job runs inline with a conservative limit so it stays within Worker CPU.
const JOB_LIMITS: Record<string, number> = {
  'lego-stock-refresh': 20,
  'brickset-enrich': 5,
  'brickeconomy-enrich': 5,
  'brickinsights-ratings': 80,
  'recompute-blends': 100,
};

// Hard ceiling on an admin-triggered job's per-call limit, so a manual override
// (e.g. the bootstrap-brickeconomy workflow) can advance a backfill faster than
// the conservative default but still stay inside Worker CPU/subrequest budgets.
const JOB_LIMIT_MAX = 150;

app.post('/jobs/:job', async (c) => {
  const job = c.req.param('job');
  if (!Object.prototype.hasOwnProperty.call(JOB_LIMITS, job)) {
    return c.json({ error: `Unknown job '${job}'. Valid: ${Object.keys(JOB_LIMITS).join(', ')}` }, 400);
  }
  // Optional ?limit= override (capped) for manual backfill advancement; defaults
  // to the job's conservative built-in limit.
  const requested = Number(c.req.query('limit'));
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), JOB_LIMIT_MAX)
    : JOB_LIMITS[job];
  const started_at = new Date().toISOString();
  try {
    let result: Record<string, unknown>;
    if (job === 'lego-stock-refresh') {
      result = await runLegoStockRefresh(c.env, { limit });
    } else if (job === 'brickset-enrich') {
      result = await runBricksetEnrich(c.env, { limit });
    } else if (job === 'brickeconomy-enrich') {
      result = await runBrickEconomyEnrich(c.env, { limit });
    } else if (job === 'brickinsights-ratings') {
      result = await runBrickInsightsBackfill(c.env, { limit });
    } else if (job === 'recompute-blends') {
      result = await runBlendRecomputeBackfill(c.env, { limit });
    } else {
      return c.json({ error: 'Not implemented' }, 501);
    }
    return c.json({ ok: true, job, started_at, limit, ...result });
  } catch (err) {
    return c.json({ ok: false, job, started_at, error: (err as Error).message }, 500);
  }
});

// GET /api/admin/contributions?status=pending — unified moderation queue across
// the three contribution tables, oldest-first, with a per-type pending count.
app.get('/contributions', async (c) => {
  const status = c.req.query('status') || 'pending';
  try {
    const rows = await c.env.DB.prepare(
    "SELECT 'review' AS type, r.id, r.user_id, r.set_num, s.name AS set_name, " +
    "  ('★' || r.rating || (CASE WHEN r.title IS NOT NULL THEN ' · ' || r.title ELSE '' END)) AS summary, " +
    "  r.body AS detail, NULL AS photo_id, r.created_at " +
    "FROM set_reviews r JOIN lego_sets s ON s.set_num=r.set_num WHERE r.status=? AND r.deleted_at IS NULL " +
    "UNION ALL " +
    "SELECT 'photo', p.id, p.user_id, p.set_num, s.name, COALESCE('Photo · ' || p.caption, 'Photo'), NULL, p.id, p.created_at " +
    "FROM set_photos p JOIN lego_sets s ON s.set_num=p.set_num WHERE p.status=? AND p.deleted_at IS NULL " +
    "UNION ALL " +
    "SELECT 'data', d.id, d.user_id, d.set_num, s.name, (d.kind || ' fix'), d.payload, NULL, d.created_at " +
    "FROM set_contributions d JOIN lego_sets s ON s.set_num=d.set_num WHERE d.status=? AND d.deleted_at IS NULL " +
    "ORDER BY 9 ASC LIMIT 200"
  ).bind(status, status, status).all();
  const items = (rows.results || []).map((r: any) => ({
    ...r,
    photo_url: r.photo_id ? `/api/contributions/photos/file/${r.photo_id}` : null,
  }));
  const counts = await c.env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM set_reviews WHERE status='pending' AND deleted_at IS NULL) AS reviews, " +
    "(SELECT COUNT(*) FROM set_photos WHERE status='pending' AND deleted_at IS NULL) AS photos, " +
    "(SELECT COUNT(*) FROM set_contributions WHERE status='pending' AND deleted_at IS NULL) AS data"
  ).first<{ reviews: number; photos: number; data: number }>();
    return c.json({ items, counts: { ...counts, total: (counts?.reviews || 0) + (counts?.photos || 0) + (counts?.data || 0) } });
  } catch (err) {
    return c.json({ error: `Contribution queue unavailable: ${(err as Error).message}` }, 500);
  }
});

const CONTRIB_TABLE: Record<string, string> = {
  review: 'set_reviews',
  photo: 'set_photos',
  data: 'set_contributions',
};

// PATCH /api/admin/contributions/:type/:id — approve or reject. Approving a
// barcode data-fix auto-applies the UPC to lego_sets when it's currently empty;
// all other kinds are display-only or manual-action reports.
app.patch('/contributions/:type/:id', async (c) => {
  const type = c.req.param('type');
  const table = CONTRIB_TABLE[type];
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{ action?: string; note?: string }>().catch(() => ({} as { action?: string; note?: string }));
  const action = body.action;
  if (!table || !id) return c.json({ error: 'Invalid request' }, 400);
  if (action !== 'approve' && action !== 'reject') return c.json({ error: "action must be 'approve' or 'reject'" }, 400);

  const status = action === 'approve' ? 'approved' : 'rejected';
  const reviewer = c.env.ADMIN_USER_ID;
  const res = await c.env.DB.prepare(
    `UPDATE ${table} SET status=?, reviewer_id=?, review_note=?, reviewed_at=datetime('now') WHERE id=? AND deleted_at IS NULL`
  ).bind(status, reviewer, (body.note || '').slice(0, 500) || null, id).run();
  if (!res.meta.changes) return c.json({ error: 'Not found' }, 404);

  let applied: string | null = null;
  if (action === 'approve' && type === 'data') {
    const row = await c.env.DB.prepare('SELECT set_num, kind, payload FROM set_contributions WHERE id=?')
      .bind(id).first<{ set_num: string; kind: string; payload: string }>();
    if (row?.kind === 'barcode') {
      let upc = '';
      try { upc = String(JSON.parse(row.payload).upc || ''); } catch {}
      if (/^\d{8,14}$/.test(upc)) {
        const upd = await c.env.DB.prepare(
          "UPDATE lego_sets SET upc=? WHERE set_num=? AND (upc IS NULL OR upc='')"
        ).bind(upc, row.set_num).run();
        applied = upd.meta.changes ? `upc set on ${row.set_num}` : `upc already present on ${row.set_num} (not overwritten)`;
      }
    }
  }
  return c.json({ ok: true, status, applied });
});

app.get('/users/search', async (c) => {
  const q = String(c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ users: [] });
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const rows = await c.env.DB.prepare(
    `SELECT user_id, handle, display_name, email, is_supporter, updated_at
     FROM user_prefs
     WHERE user_id LIKE ? OR handle LIKE ? OR display_name LIKE ? OR email LIKE ?
     ORDER BY updated_at DESC
     LIMIT 12`
  ).bind(like, like, like, like).all();
  return c.json({ users: rows.results || [] });
});

app.get('/users/supporters', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT user_id, handle, display_name, email, supporter_since, updated_at
     FROM user_prefs
     WHERE is_supporter = 1
     ORDER BY COALESCE(supporter_since, updated_at) DESC
     LIMIT 100`
  ).all();
  return c.json({ supporters: rows.results || [] });
});

app.patch('/users/:userId/supporter', async (c) => {
  const userId = c.req.param('userId');
  const { is_supporter } = await c.req.json<{ is_supporter: 0 | 1 }>();
  if (is_supporter !== 0 && is_supporter !== 1) {
    return c.json({ error: 'is_supporter must be 0 or 1' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO user_prefs (user_id, is_supporter, supporter_since, updated_at)
     VALUES (?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       is_supporter = excluded.is_supporter,
       supporter_since = CASE
         WHEN excluded.is_supporter = 1 THEN COALESCE(user_prefs.supporter_since, CURRENT_TIMESTAMP)
         ELSE NULL
       END,
       updated_at = CURRENT_TIMESTAMP`
  ).bind(userId, is_supporter, is_supporter).run();
  return c.json({ ok: true, userId, is_supporter });
});

export { app as adminRoute };
