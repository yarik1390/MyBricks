import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { importSets, importFigs, runBatches, BATCH } from '../jobs/import-catalog';
import { runBackfillUpc } from '../jobs/backfill-upc';
import { fetchBrickEconomyDetails } from '../lib/brickeconomy';
import { getIntegrationHealth } from '../lib/integration-health';
import type { Env, Variables } from '../types';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', requireAdmin);

app.post('/import-rebrickable', async (c) => {
  const body = await c.req.json<{ dataset?: string }>().catch(() => ({ dataset: undefined }));
  const dataset = body.dataset ?? 'sets';
  if (!['sets', 'figs', 'all'].includes(dataset)) {
    return c.json({ error: "dataset must be 'sets', 'figs', or 'all'" }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE import_runs SET status='error',error='Timed out',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-5 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id, started_at FROM import_runs WHERE status='running' AND started_at > datetime('now','-5 minutes') ORDER BY started_at DESC LIMIT 1`
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
          const r = await importSets(c.env.DB);
          result.sets_loaded = r.loaded;
          result.sets_skipped = r.skipped;
          result.themes_loaded = r.themes;
        }
        if (dataset === 'figs' || dataset === 'all') {
          const r = await importFigs(c.env.DB);
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
    `UPDATE import_runs SET status='error',error='Timed out',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-5 minutes')`
  ).run();

  const active = await c.env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-5 minutes') LIMIT 1`
  ).first<{ id: number }>();
  if (active) return c.json({ error: 'An import is already running.', run_id: active.id }, 409);

  const run = await c.env.DB.prepare("INSERT INTO import_runs (status) VALUES ('running')").run();
  const runId = run.meta.last_row_id;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const r = await runBackfillUpc(c.env);
        if (r.error) {
          await c.env.DB.prepare(
            "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
          ).bind(r.error, runId).run();
        } else {
          await c.env.DB.prepare(
            `UPDATE import_runs SET status='completed',completed_at=datetime('now'),sets_loaded=?,sets_skipped=?,error=? WHERE id=?`
          ).bind(r.filled, r.processed - r.filled, `method:${r.method} catalog:${r.catalogSize}`, runId).run();
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

// POST /api/admin/revalue-brickeconomy
// Bulk-revalue sets using BrickEconomy API. Processes sets sequentially with
// a small delay between each to avoid rate limiting. Runs in the background.
// Body: { scope?: 'all' | 'owned' | 'stale', limit?: number }
//   - 'all': every set in the DB (default)
//   - 'owned': only sets in user collections or wishlists
//   - 'stale': only sets with formula_bulk or expired valuations
app.post('/revalue-brickeconomy', async (c) => {
  if (!c.env.BRICKECONOMY_API_KEY) {
    return c.json({ error: 'BRICKECONOMY_API_KEY secret not configured.' }, 500);
  }

  const body = await c.req.json<{ scope?: string; limit?: number }>().catch(() => ({} as { scope?: string; limit?: number }));
  // Default to 'stale' (not 'all') so an accidental call doesn't sweep the whole
  // catalog and burn the BrickEconomy quota (free tier ~1000 calls/month).
  const scope = body.scope || 'stale';
  // Coerce defensively so a non-numeric body.limit can't produce `LIMIT NaN`.
  const requested = Number(body.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), 1000)
    : 500;

  if (!['all', 'owned', 'stale'].includes(scope)) {
    return c.json({ error: "scope must be 'all', 'owned', or 'stale'" }, 400);
  }

  let query: string;
  switch (scope) {
    case 'owned':
      query = `
        SELECT set_num, name, retired FROM lego_sets
        WHERE set_num IN (
          SELECT DISTINCT set_num FROM user_collection WHERE deleted_at IS NULL
          UNION
          SELECT DISTINCT set_num FROM user_wishlist
        )
        ORDER BY COALESCE(valuation_expires_at, '2000-01-01') ASC
        LIMIT ${limit}
      `;
      break;
    case 'stale':
      query = `
        SELECT set_num, name, retired FROM lego_sets
        WHERE valuation_method = 'formula_bulk'
           OR valuation_expires_at IS NULL
           OR valuation_expires_at < datetime('now')
        ORDER BY COALESCE(valuation_expires_at, '2000-01-01') ASC
        LIMIT ${limit}
      `;
      break;
    default: // 'all'
      query = `
        SELECT set_num, name, retired FROM lego_sets
        ORDER BY COALESCE(valuation_expires_at, '2000-01-01') ASC
        LIMIT ${limit}
      `;
  }

  const { results } = await c.env.DB.prepare(query)
    .all<{ set_num: string; name: string; retired: number }>();

  const total = results.length;

  c.executionCtx.waitUntil(
    (async () => {
      let updated = 0, failed = 0, skipped = 0;
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (const set of results) {
        try {
          // Pace requests to stay within BrickEconomy rate limits.
          await sleep(250);
          const be = await fetchBrickEconomyDetails(set.set_num, c.env);
          if (!be || be.current_value_new === null) {
            skipped++;
            continue;
          }

          const yr = set.retired ? 0.15 : 0.10;
          const forecast_2y = be.forecast_value_new_2_years ?? Math.round(be.current_value_new * Math.pow(1 + yr, 2) * 100) / 100;
          const forecast_5y = Math.round(be.current_value_new * Math.pow(1 + yr, 5) * 100) / 100;

          await c.env.DB.prepare(`
            UPDATE lego_sets SET
              current_value=?, used_value=?, retail_price=COALESCE(?, retail_price),
              forecast_2y=?, forecast_5y=?,
              valuation_method='brickeconomy',
              valuation_expires_at=datetime('now', '+7 days')
            WHERE set_num=?
          `).bind(
            be.current_value_new, be.current_value_used, be.retail_price_us,
            forecast_2y, forecast_5y, set.set_num
          ).run();

          updated++;
        } catch (err) {
          console.warn(`[bulk-brickeconomy] ${set.set_num} failed:`, (err as Error).message);
          failed++;
        }
      }
      console.log(`[bulk-brickeconomy] Done: ${updated} updated, ${skipped} skipped, ${failed} failed out of ${total}`);
    })()
  );

  return c.json({ ok: true, status: 'running', total, scope });
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
    `UPDATE import_runs SET status='error',error='Timed out',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();
  const { results } = await c.env.DB.prepare(
    `SELECT id, status, started_at, completed_at, themes_loaded, sets_loaded, sets_skipped, figs_loaded, error
     FROM import_runs
     ORDER BY started_at DESC
     LIMIT 5`
  ).all();
  return c.json({ runs: results });
});

// GET /api/admin/integrations — external API health (last success/failure per service)
app.get('/integrations', async (c) => {
  const rows = await getIntegrationHealth(c.env);
  return c.json({ integrations: rows });
});

export { app as adminRoute };
