import type { Env } from '../types';
import { nextBackfillPage, runBackfillUpc } from './backfill-upc';
import { runEbayBackfill, runValuateSets } from './valuate-sets';

async function startRun(env: Env, label: string): Promise<number> {
  const run = await env.DB.prepare(
    "INSERT INTO import_runs (status, error) VALUES ('running', ?)"
  ).bind(label).run();
  return Number(run.meta.last_row_id);
}

async function completeRun(env: Env, runId: number, loaded: number, processed: number, note: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE import_runs
    SET status='completed',
        completed_at=datetime('now'),
        sets_loaded=?,
        sets_skipped=?,
        error=?
    WHERE id=?
  `).bind(loaded, processed, note, runId).run();
}

async function failRun(env: Env, runId: number, error: unknown): Promise<void> {
  await env.DB.prepare(
    "UPDATE import_runs SET status='error',error=?,completed_at=datetime('now') WHERE id=?"
  ).bind((error as Error)?.message || String(error), runId).run();
}

async function activeRun(env: Env): Promise<{ id: number } | null> {
  await env.DB.prepare(
    `UPDATE import_runs SET status='expired',error='Worker run stopped before completion',completed_at=datetime('now') WHERE status='running' AND started_at <= datetime('now','-30 minutes')`
  ).run();
  return await env.DB.prepare(
    `SELECT id FROM import_runs WHERE status='running' AND started_at > datetime('now','-30 minutes') LIMIT 1`
  ).first<{ id: number }>();
}

export async function runDailyBarcodeMaintenance(env: Env, maxPages = 12) {
  const startPage = await nextBackfillPage(env);
  const runId = await startRun(env, `method:bulk-daily start_page:${startPage}`);
  try {
    const result = await runBackfillUpc(env, {
      startPage,
      maxPages,
      onProgress: async (p) => {
        await env.DB.prepare(
          `UPDATE import_runs SET sets_loaded=?,sets_skipped=?,error=? WHERE id=?`
        ).bind(
          p.filled,
          p.processed,
          `method:bulk-daily start_page:${startPage} next_page:${p.nextPage ?? ''} complete:${p.complete}`,
          runId,
        ).run();
      },
    });

    if (result.error) {
      await failRun(env, runId, result.error);
      return result;
    }

    await completeRun(
      env,
      runId,
      result.filled,
      result.processed,
      result.note ?? `method:${result.method}-daily catalog:${result.catalogSize} next_page:${result.nextPage ?? ''} complete:${result.complete}`,
    );
    return result;
  } catch (error) {
    await failRun(env, runId, error);
    throw error;
  }
}

export async function runDailyValuationMaintenance(env: Env, limit = 4) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 250));
  const runId = await startRun(env, `method:valuation-daily scope:all limit:${safeLimit}`);
  try {
    const result = await runValuateSets(env, {
      scope: 'all',
      includeFresh: true,
      limit: safeLimit,
    });

    await completeRun(
      env,
      runId,
      result.updated,
      result.processed,
      `method:valuation-daily scope:all limit:${safeLimit} processed:${result.processed} updated:${result.updated}`,
    );
    return result;
  } catch (error) {
    await failRun(env, runId, error);
    throw error;
  }
}

export async function runDailyEbayMaintenance(env: Env, limit = 2) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 2));
  const runId = await startRun(env, `method:ebay-daily limit:${safeLimit}`);
  try {
    const result = await runEbayBackfill(env, { limit: safeLimit });

    await completeRun(
      env,
      runId,
      result.updated,
      result.processed,
      `method:ebay-daily limit:${safeLimit} processed:${result.processed} updated:${result.updated}`,
    );
    return result;
  } catch (error) {
    await failRun(env, runId, error);
    throw error;
  }
}

export async function runDailyCatalogMaintenance(env: Env) {
  const active = await activeRun(env);
  if (active) return { skipped: true, reason: `run ${active.id} already active` };
  const barcode = await runDailyBarcodeMaintenance(env);
  const valuation = await runDailyValuationMaintenance(env);
  const ebay = await runDailyEbayMaintenance(env);
  return { barcode, valuation, ebay };
}
