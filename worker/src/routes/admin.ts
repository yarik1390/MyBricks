import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { importSets, importFigs } from '../jobs/import-catalog';
import { nextBackfillPage, runBackfillUpc } from '../jobs/backfill-upc';
import { BARCODE_PAGE_SIZE } from '../lib/brickset';
import { runEbayBackfill, runValuateSets } from '../jobs/valuate-sets';
import { ebaySoldCompsEnabled } from '../lib/pricing-flags';
import { getIntegrationDiagnostics } from '../lib/integration-health';
import { getQuotaUsage } from '../lib/api-quota';
import { getAiUsageReport } from '../lib/ai-usage';
import { isEbayAccessError } from '../lib/ebay';
import { rebuildSearchIndex } from '../lib/search-index';
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
        CAST(SUM(CASE WHEN retired = 0 AND year IS NOT NULL AND year <= CAST(strftime('%Y','now') AS INTEGER) - 5 THEN 1 ELSE 0 END) AS INTEGER) AS old_active_sets,
        CAST(SUM(CASE WHEN valuation_method IN ('formula_bulk','ai') OR current_value IS NULL OR current_value <= 0 THEN 1 ELSE 0 END) AS INTEGER) AS low_confidence_values,
        CAST(SUM(CASE WHEN current_value IS NULL OR current_value <= 0 OR valuation_expires_at < datetime('now') OR cached_at IS NULL OR cached_at < datetime('now','-60 days') THEN 1 ELSE 0 END) AS INTEGER) AS needs_market_refresh
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
  return {
    ...sets,
    quality,
    blend_quality: blendQuality,
    barcode_health: barcodeHealthOut,
    sets_with_bricklink: bricklinkCount,
    barcode_coverage_pct: pct(barcodeCount),
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

app.get('/integrations', async (c) => {
  const [integrations, coverage, quota, ai_usage] = await Promise.all([
    getIntegrationDiagnostics(c.env),
    getDataCoverage(c.env),
    getQuotaUsage(c.env),
    getAiUsageReport(c.env),
  ]);
  const url = new URL(c.req.url);
  return c.json({
    integrations,
    coverage,
    quota,
    ai_usage,
    api_routing: {
      worker_base_url: url.origin,
      config_endpoint: `${url.origin}/api/config`,
      pages_api_note: 'The Pages app uses window.WORKER_BASE for API calls.',
    },
  });
});

app.post('/repair-search-index', async (c) => {
  const result = await rebuildSearchIndex(c.env.DB);
  return c.json({
    ok: true,
    message: 'Catalog search index rebuilt',
    ...result,
  });
});

export { app as adminRoute };
