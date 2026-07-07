import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { importSets, importFigs } from '../jobs/import-catalog';
import { nextBackfillPage, runBackfillUpc } from '../jobs/backfill-upc';
import { BARCODE_PAGE_SIZE } from '../lib/brickset';
import { runEbayBackfill, runValuateSets } from '../jobs/valuate-sets';
import { ebaySoldCompsEnabled, pricesapiEnabled, brickOwlEnabled, brickInsightsEnabled, brightDataSoldEnabled, firecrawlEnabled } from '../lib/pricing-flags';
import { getIntegrationDiagnostics } from '../lib/integration-health';
import { getQuotaUsage } from '../lib/api-quota';
import { getAiUsageReport } from '../lib/ai-usage';
import { rebuildSearchIndex } from '../lib/search-index';
import { runLegoStockRefresh } from '../jobs/lego-stock-refresh';
import { runBricksetEnrich } from '../jobs/brickset-enrich';
import { runBrickEconomyEnrich } from '../jobs/brickeconomy-enrich';
import { runBrickInsightsBackfill } from '../jobs/brickinsights';
import { runBlendRecomputeBackfill } from '../jobs/recompute-blends';
import { resetKeyPool } from '../lib/brightdata-keys';
import { runEbaySoldScrape } from '../jobs/ebay-sold-scrape';
import { runPriceChartingBulk, runPriceChartingBulkFetch } from '../jobs/pricecharting-bulk';
import { importBrickLinkMinifigs } from '../jobs/import-bricklink-minifigs';
import { getKeyPoolStatus } from '../lib/pricesapi-keys';
import { getKeyPoolStatus as getBrightDataPoolStatus } from '../lib/brightdata-keys';
import { getSourceConfig, saveSourceConfig, DEFAULT_SOURCE_CONFIG } from '../lib/source-config';
import { getFeatureFlags, saveFeatureFlags, applyFeatureFlags, FEATURE_FLAGS } from '../lib/feature-flags';
import { runServiceTest, TESTABLE_SERVICES } from '../lib/service-tests';
import { getRecentRuns, recordCronStart, recordCronFinish, summarizeResult } from '../lib/cron-runs';
import { runPricesApiRetail } from '../jobs/pricesapi-retail';
import { PROCESS_REGISTRY, GROUP_ORDER, processInfo } from '../lib/process-registry';
import type { Env, Variables } from '../types';

import { createImportRun, updateImportRunProgress, completeImportRun, failImportRun, expireStaleImportRuns, getActiveImportRun, getDataCoverage, getPopulationSnapshot, populationDone, populationRemainingNote, getMarketExtCoverage, buildFirecrawlDiagnostics, IMPORT_RUN_FIELDS } from './admin-helpers';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireAdmin);


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

// Import BrickLink's minifig catalog export (TAB-separated: Category ID /
// Category Name / Number / Name / Year / Weight) into bricklink_minifigs, so
// minifig valuation can resolve each Rebrickable fig to its BrickLink id.
// Idempotent; re-upload to refresh with newer series.
app.post('/import-bricklink-minifigs', async (c) => {
  const text = await c.req.text().catch(() => '');
  if (!text.trim() || text.indexOf('\t') < 0) {
    return c.json({ error: 'Empty or malformed catalog. Expected the tab-separated BrickLink minifig export.' }, 400);
  }
  try {
    const res = await importBrickLinkMinifigs(c.env, text);
    if (!res.parsed) return c.json({ error: 'No minifig rows parsed — check the file is the BrickLink Minifigures tab export.' }, 400);
    return c.json({ ok: true, ...res });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
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

        // The lego_sets_fts triggers keep the index live on every insert/update/
        // delete, so a full rebuild is only needed when it has actually drifted
        // out of sync (fresh DB, or a bulk import that ran before the triggers
        // existed). Rebuilding on EVERY populate slice re-wrote all ~27k rows each
        // run — a large recurring chunk of D1 rows-written (millions/day across the
        // nightly slices). Gate it on a real row-count divergence so steady state
        // is a no-op.
        const ftsSync = await c.env.DB.prepare(
          `SELECT (SELECT COUNT(*) FROM lego_sets) AS sets,
                  (SELECT COUNT(*) FROM lego_sets_fts) AS fts`
        ).first<{ sets: number; fts: number }>().catch(() => null);
        if (!ftsSync || ftsSync.sets !== ftsSync.fts) {
          await phaseProgress(2, 'Rebuilding search index', 0, 1);
          await rebuildSearchIndex(c.env.DB);
          await phaseProgress(2, 'Search index rebuilt', 1, 1);
        } else {
          await phaseProgress(2, 'Search index up to date', 1, 1);
        }

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

// Runtime feature flags: enable/disable capabilities (eBay sold comps, Bright
// Data sold, BrickInsights, Firecrawl, pricesAPI, BrickOwl) with no redeploy.
// GET returns the flag list, the raw stored overrides, and the resolved effective
// state (override-or-env, with the required-secret prerequisite applied).
app.get('/feature-flags', async (c) => {
  await applyFeatureFlags(c.env);
  const overrides = await getFeatureFlags(c.env);
  const effective = {
    ebay_sold_comps: ebaySoldCompsEnabled(c.env),
    brickowl: brickOwlEnabled(c.env),
    brickinsights: brickInsightsEnabled(c.env),
    brightdata_sold: brightDataSoldEnabled(c.env),
    firecrawl: firecrawlEnabled(c.env),
    pricesapi: pricesapiEnabled(c.env),
  };
  return c.json({ flags: FEATURE_FLAGS, overrides, effective });
});

app.put('/feature-flags', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return c.json({ error: 'Expected a JSON object of feature flags.' }, 400);
  const overrides = await saveFeatureFlags(c.env, (body as { flags?: unknown }).flags ?? body);
  await applyFeatureFlags(c.env);
  const effective = {
    ebay_sold_comps: ebaySoldCompsEnabled(c.env),
    brickowl: brickOwlEnabled(c.env),
    brickinsights: brickInsightsEnabled(c.env),
    brightdata_sold: brightDataSoldEnabled(c.env),
    firecrawl: firecrawlEnabled(c.env),
    pricesapi: pricesapiEnabled(c.env),
  };
  return c.json({ ok: true, overrides, effective });
});

// On-demand per-service test probe (cheap connectivity/auth check). Used by the
// admin console's per-service Test button. See lib/service-tests.ts for probes.
app.post('/test/:service', async (c) => {
  const service = c.req.param('service');
  const result = await runServiceTest(c.env, service);
  if (!result) return c.json({ error: `Unknown service '${service}'. Valid: ${TESTABLE_SERVICES.join(', ')}` }, 400);
  return c.json(result);
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
  'brightdata-reset-pool': 1,
  'ebay-sold-scrape': 20,
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
    } else if (job === 'brightdata-reset-pool') {
      // Clear the Bright Data key-pool drained/exhausted latch (no per-call limit).
      result = await resetKeyPool(c.env);
    } else if (job === 'ebay-sold-scrape') {
      // On-demand eBay-sold scrape (Bright Data / Firecrawl) for verification.
      result = await runEbaySoldScrape(c.env, { limit });
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
