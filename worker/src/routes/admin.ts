import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { importSets, importFigs } from '../jobs/import-catalog';
import { nextBackfillPage, runBackfillUpc } from '../jobs/backfill-upc';
import { runEbayBackfill, runValuateSets } from '../jobs/valuate-sets';
import { getIntegrationDiagnostics } from '../lib/integration-health';
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
