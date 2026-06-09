import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { importSets, importFigs, runBatches, BATCH } from '../jobs/import-catalog';
import { nextBackfillPage, runBackfillUpc } from '../jobs/backfill-upc';
import { runEbayBackfill, runValuateSets } from '../jobs/valuate-sets';
import { getIntegrationDiagnostics } from '../lib/integration-health';
import { rebuildSearchIndex } from '../lib/search-index';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireAdmin);

async function getDataCoverage(env: Env) {
  const [sets, valuationMethods] = await Promise.all([
    env.DB.prepare(`
      SELECT
        CAST(COUNT(*) AS INTEGER) AS total_sets,
        CAST(SUM(CASE WHEN current_value IS NULL OR current_value <= 0 THEN 1 ELSE 0 END) AS INTEGER) AS missing_values,
        CAST(SUM(CASE WHEN valuation_expires_at IS NOT NULL AND valuation_expires_at < datetime('now') THEN 1 ELSE 0 END) AS INTEGER) AS expired_values,
        CAST(SUM(CASE WHEN cached_at IS NULL OR cached_at < datetime('now','-60 days') THEN 1 ELSE 0 END) AS INTEGER) AS stale_values,
        CAST(SUM(CASE WHEN upc IS NOT NULL AND upc != '' THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_upc,
        CAST(SUM(CASE WHEN ebay_value IS NOT NULL THEN 1 ELSE 0 END) AS INTEGER) AS sets_with_ebay,
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
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id, started_at FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') ORDER BY started_at DESC LIMIT 1`
  ).first<{ id: number; started_at: string }>();
  if (active) {
    return c.json({ error: 'An import is already running.', run_id: active.id, started_at: active.started_at }, 409);
  }

  const run = await c.env.DB.prepare("INSERT INTO import_runs (status) VALUES ('running')").run();
  const runId = run.meta.last_row_id;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const result: Record<string, unknown> = {};
        if (dataset === 'sets' || dataset === 'all') {
          const r = await importSets(c.env.DB, c.env);
          result.sets_loaded = r.loaded;
          result.sets_skipped = r.skipped;
          result.themes_loaded = r.themes;
        }
        if (dataset === 'figs' || dataset === 'all') {
          const r = await importFigs(c.env.DB, c.env);
          result.figs_loaded = r.loaded;
        }
        await c.env.DB.prepare(
          'UPDATE import_runs SET status=?,completed_at=datetime(\'now\'),themes_loaded=?,sets_loaded=?,sets_skipped=?,figs_loaded=? WHERE id=?'
        ).bind('completed', result.themes_loaded ?? null, result.sets_loaded ?? null,
               result.sets_skipped ?? null, result.figs_loaded ?? null, runId).run();
      } catch (e) {
        await c.env.DB.prepare(
          "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
        ).bind((e as Error).message, runId).run();
      }
    })()
  );

  return c.json({ ok: true, status: 'running', run_id: runId });
});

app.get('/import-status/:id', requireAdmin, async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    'SELECT id, status, started_at, completed_at, themes_loaded, sets_loaded, sets_skipped, figs_loaded, error FROM import_runs WHERE id=?'
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
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') LIMIT 1`
  ).first<{ id: number }>();
  if (active) return c.json({ error: 'An import is already running.', run_id: active.id }, 409);

  const run = await c.env.DB.prepare("INSERT INTO import_runs (status) VALUES ('running')").run();
  const runId = run.meta.last_row_id;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const startPage = await nextBackfillPage(c.env);
        const r = await runBackfillUpc(c.env, {
          startPage,
          maxPages: 4,
          onProgress: async (p) => {
            await c.env.DB.prepare(
              `UPDATE import_runs SET sets_loaded=?,sets_skipped=?,error=? WHERE id=?`
            ).bind(
              p.filled,
              p.processed,
              `method:bulk start_page:${startPage} next_page:${p.nextPage ?? ''} complete:${p.complete}`,
              runId,
            ).run();
          },
        });
        if (r.error) {
          await c.env.DB.prepare(
            "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
          ).bind(r.error, runId).run();
        } else {
          await c.env.DB.prepare(
            `UPDATE import_runs SET status='completed',completed_at=datetime('now'),sets_loaded=?,sets_skipped=?,error=? WHERE id=?`
          ).bind(
            r.filled,
            r.processed,
            r.note ?? `method:${r.method} catalog:${r.catalogSize} next_page:${r.nextPage ?? ''} complete:${r.complete}`,
            runId,
          ).run();
        }
      } catch (e) {
        await c.env.DB.prepare(
          "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
        ).bind((e as Error).message, runId).run();
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
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') LIMIT 1`
  ).first<{ id: number }>();
  if (active) return c.json({ error: 'An import or coverage job is already running.', run_id: active.id }, 409);

  const run = await c.env.DB.prepare(
    "INSERT INTO import_runs (status, error) VALUES ('running', ?)"
  ).bind('method:populate-coverage barcode_pages:4 ebay_limit:2').run();
  const runId = run.meta.last_row_id;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const startPage = await nextBackfillPage(c.env);
        const barcode = await runBackfillUpc(c.env, {
          startPage,
          maxPages: 4,
          onProgress: async (p) => {
            await c.env.DB.prepare(
              `UPDATE import_runs SET sets_loaded=?,sets_skipped=?,error=? WHERE id=?`
            ).bind(
              p.filled,
              p.processed,
              `method:populate-coverage barcode_start:${startPage} next_page:${p.nextPage ?? ''} barcode_complete:${p.complete}`,
              runId,
            ).run();
          },
        });
        const ebay = await runEbayBackfill(c.env, { limit: 2 });
        await c.env.DB.prepare(`
          UPDATE import_runs
          SET status='completed',
              completed_at=datetime('now'),
              sets_loaded=?,
              sets_skipped=?,
              error=?
          WHERE id=?
        `).bind(
          barcode.filled + ebay.updated,
          barcode.processed + ebay.processed,
          barcode.note ?? `method:populate-coverage barcode:${barcode.filled}/${barcode.processed} ebay:${ebay.updated}/${ebay.processed} next_page:${barcode.nextPage ?? ''}`,
          runId,
        ).run();
      } catch (e) {
        await c.env.DB.prepare(
          "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
        ).bind((e as Error).message, runId).run();
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
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') LIMIT 1`
  ).first<{ id: number }>();
  if (active) return c.json({ error: 'An import or valuation job is already running.', run_id: active.id }, 409);

  const run = await c.env.DB.prepare(
    "INSERT INTO import_runs (status, error) VALUES ('running', ?)"
  ).bind(`method:valuation scope:${scope} limit:${limit}`).run();
  const runId = run.meta.last_row_id;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const result = await runValuateSets(c.env, {
          scope: scope === 'owned' ? 'owned' : 'all',
          includeFresh: scope === 'all',
          limit,
        });
        await c.env.DB.prepare(`
          UPDATE import_runs
          SET status='completed',
              completed_at=datetime('now'),
              sets_loaded=?,
              sets_skipped=?,
              error=?
          WHERE id=?
        `).bind(
          result.updated,
          result.processed,
          `method:valuation scope:${scope} limit:${limit} processed:${result.processed} updated:${result.updated}`,
          runId,
        ).run();
      } catch (err) {
        await c.env.DB.prepare(
          "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
        ).bind((err as Error).message, runId).run();
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
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();
  const { results } = await c.env.DB.prepare(
    `SELECT id, status, started_at, completed_at, themes_loaded, sets_loaded, sets_skipped, figs_loaded, error
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
