import { Hono } from 'hono';
import { requireAdmin } from '../auth';
import { importSets, importFigs, runBatches, BATCH } from '../jobs/import-catalog';
import { runBackfillUpc } from '../jobs/backfill-upc';
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
        const { processed, filled } = await runBackfillUpc(c.env);
        await c.env.DB.prepare(
          `UPDATE import_runs SET status='completed',completed_at=datetime('now'),sets_loaded=?,sets_skipped=? WHERE id=?`
        ).bind(filled, processed - filled, runId).run();
      } catch (e) {
        await c.env.DB.prepare(
          "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
        ).bind((e as Error).message, runId).run();
      }
    })()
  );

  return c.json({ ok: true, status: 'running', run_id: runId });
});

export { app as adminRoute };
