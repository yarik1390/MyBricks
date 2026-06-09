import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { importSets, importFigs } from '../jobs/import-catalog';
import { nextBackfillPage, runBackfillUpc } from '../jobs/backfill-upc';
import { runEbayBackfill, runValuateSets } from '../jobs/valuate-sets';
import { getIntegrationDiagnostics } from '../lib/integration-health';
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

async function getDataCoverage(env: Env) {
  const [sets, valuationMethods] = await Promise.all([
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
  return {
    ...sets,
    quality,
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
  const [coverage, minifigs, ebayAttempts, latestBarcode, ebayHealth] = await Promise.all([
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
      SELECT last_ok_at, last_fail_at, last_error
      FROM integration_health
      WHERE service='ebay'
    `).first<{ last_ok_at: string | null; last_fail_at: string | null; last_error: string | null }>(),
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
  const ebayAccessBlocked = ebayConfigured && ebayFailAt >= ebayOkAt && isEbayAccessError(ebayHealth?.last_error);
  const formulaBulkCount = Number((c.valuation_methods || []).find((m: { valuation_method?: string; count?: number }) => m.valuation_method === 'formula_bulk')?.count || 0);
  const barcodePassComplete = /complete:true|barcode_complete:true/i.test(String(latestBarcode?.error || ''));
  const ebaySourceAvailable = ebayConfigured && !ebayAccessBlocked;
  return {
    ...c,
    total_sets: totalSets,
    total_minifigs: totalMinifigs,
    ebay_new_attempted: ebayNewAttempted,
    ebay_used_attempted: ebayUsedAttempted,
    ebay_configured: ebayConfigured,
    ebay_access_blocked: ebayAccessBlocked,
    ebay_source_available: ebaySourceAvailable,
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

  await c.env.DB.prepare(
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',progress_label='Stopped',completed_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id, started_at FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') ORDER BY started_at DESC LIMIT 1`
  ).first<{ id: number; started_at: string }>();
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

  await c.env.DB.prepare(
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',progress_label='Stopped',completed_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') LIMIT 1`
  ).first<{ id: number }>();
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
  await c.env.DB.prepare(
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',progress_label='Stopped',completed_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') LIMIT 1`
  ).first<{ id: number }>();
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

  await c.env.DB.prepare(
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',progress_label='Stopped',completed_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') LIMIT 1`
  ).first<{ id: number }>();
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
    ? Math.min(Math.floor(Number(body.valuation_limit)), 3)
    : 2;
  const barcodePages = Number.isFinite(Number(body.barcode_pages)) && Number(body.barcode_pages) > 0
    ? Math.min(Math.floor(Number(body.barcode_pages)), 6)
    : 4;
  const ebayLimit = Number.isFinite(Number(body.ebay_limit)) && Number(body.ebay_limit) > 0
    ? Math.min(Math.floor(Number(body.ebay_limit)), 2)
    : 2;

  await c.env.DB.prepare(
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',progress_label='Stopped',completed_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') LIMIT 1`
  ).first<{ id: number }>();
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
          await phaseProgress(3, `Backfilling barcodes from page ${startPage}`, 0, barcodePages * 500);
          const barcode = await runBackfillUpc(c.env, {
            startPage,
            maxPages: barcodePages,
            onProgress: async (p) => phaseProgress(
              3,
              p.complete ? 'Barcode pass complete' : `Barcode page ${p.nextPage ? p.nextPage - 1 : startPage}`,
              p.processed,
              p.complete ? Math.max(p.processed, 1) : barcodePages * 500,
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
        await phaseProgress(4, 'Refreshing market data', 0, valuationLimit);
        const valuation = await runValuateSets(c.env, {
          scope: 'all',
          includeFresh: true,
          includeSupplemental: true,
          includeEbay,
          includeMinifigs: true,
          limit: valuationLimit,
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

        if (includeEbay) {
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
  // Auto-expire jobs stuck in 'running' for more than 30 minutes.
  await c.env.DB.prepare(
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',progress_label='Stopped',completed_at=datetime('now'),updated_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();
  const { results } = await c.env.DB.prepare(
    `SELECT ${IMPORT_RUN_FIELDS}
     FROM import_runs
     ORDER BY started_at DESC
     LIMIT 8`
  ).all();
  return c.json({ runs: results });
});

app.get('/integrations', async (c) => {
  const [integrations, coverage] = await Promise.all([
    getIntegrationDiagnostics(c.env),
    getDataCoverage(c.env),
  ]);
  const url = new URL(c.req.url);
  return c.json({
    integrations,
    coverage,
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
