/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { recordCronStart, recordCronFinish, getRecentRuns, summarizeResult, sweepStaleCronRuns, isCronRunning } from './lib/cron-runs';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS cron_runs').run();
  await db.prepare(`CREATE TABLE cron_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, started_at TEXT, finished_at TEXT,
    status TEXT DEFAULT 'running', summary TEXT, error TEXT, duration_ms INTEGER
  )`).run();
}

describe('summarizeResult', () => {
  it('summarizes count fields', () => {
    expect(summarizeResult({ processed: 50, updated: 14, discovered: 2 })).toBe('updated 14 · found 2 · processed 50');
    expect(summarizeResult({ matched: 9000, rows: 13119 })).toBe('matched 9000 · rows 13119');
  });
  it('reports a skip reason', () => {
    expect(summarizeResult({ skipped: 'PRICECHARTING_TOKEN not set' })).toBe('skipped: PRICECHARTING_TOKEN not set');
  });
  it('includes non-zero alert counts', () => {
    expect(summarizeResult({ fired: 3, spikes: 2, deals: 0 })).toBe('fired 3 · spikes 2');
  });
  it('returns null for nothing useful', () => {
    expect(summarizeResult(undefined)).toBeNull();
    expect(summarizeResult({})).toBeNull();
    expect(summarizeResult(5)).toBeNull();
  });
});

describe('cron run tracking', () => {
  beforeEach(freshSchema);

  it('records start -> finish and reads the latest run per process', async () => {
    const id = await recordCronStart(env as any, 'pricecharting-enrich');
    expect(id).toBeTruthy();
    await recordCronFinish(env as any, id, 'pricecharting-enrich', { ok: true, summary: 'updated 14', durationMs: 1200 });

    const { latest } = await getRecentRuns(env as any);
    expect(latest['pricecharting-enrich'].status).toBe('ok');
    expect(latest['pricecharting-enrich'].summary).toBe('updated 14');
    expect(latest['pricecharting-enrich'].duration_ms).toBe(1200);
    expect(latest['pricecharting-enrich'].finished_at).toBeTruthy();
  });

  it('records a failure with the error message', async () => {
    const id = await recordCronStart(env as any, 'pricesapi-retail');
    await recordCronFinish(env as any, id, 'pricesapi-retail', { ok: false, error: 'boom' });
    const { latest } = await getRecentRuns(env as any);
    expect(latest['pricesapi-retail'].status).toBe('failed');
    expect(latest['pricesapi-retail'].error).toBe('boom');
  });

  it('prunes history to the last 5 runs per process', async () => {
    for (let i = 0; i < 8; i++) {
      const id = await recordCronStart(env as any, 'valuate-sets');
      await recordCronFinish(env as any, id, 'valuate-sets', { ok: true, summary: `run ${i}` });
    }
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM cron_runs WHERE name='valuate-sets'`).first<{ n: number }>();
    expect(row!.n).toBe(5);
  });

  it('sweeps orphaned running rows older than the window, leaving fresh ones', async () => {
    // A stale 'running' row (invocation killed 40 min ago) and a fresh one.
    await db.prepare(`INSERT INTO cron_runs (name, started_at, status) VALUES ('stuck-job', datetime('now','-40 minutes'), 'running')`).run();
    const fresh = await recordCronStart(env as any, 'live-job'); // started 'now'
    const swept = await sweepStaleCronRuns(env as any, 30);
    expect(swept).toBe(1);
    const stuck = await db.prepare(`SELECT status, error, finished_at FROM cron_runs WHERE name='stuck-job'`).first<{ status: string; error: string; finished_at: string }>();
    expect(stuck!.status).toBe('failed');
    expect(stuck!.error).toMatch(/stale/);
    expect(stuck!.finished_at).toBeTruthy();
    const live = await db.prepare(`SELECT status FROM cron_runs WHERE id=?`).bind(fresh).first<{ status: string }>();
    expect(live!.status).toBe('running'); // untouched
  });

  it('isCronRunning detects a fresh running row but not a stale or finished one', async () => {
    expect(await isCronRunning(env as any, 'job-x')).toBe(false); // nothing yet
    await recordCronStart(env as any, 'job-x'); // fresh 'running'
    expect(await isCronRunning(env as any, 'job-x')).toBe(true);
    expect(await isCronRunning(env as any, 'other-job')).toBe(false); // name-scoped
    // A stale running row (older than the window) does NOT hold the lease.
    await db.prepare(`INSERT INTO cron_runs (name, started_at, status) VALUES ('job-y', datetime('now','-40 minutes'), 'running')`).run();
    expect(await isCronRunning(env as any, 'job-y', 30)).toBe(false);
    // A finished row does not hold the lease.
    const id = await recordCronStart(env as any, 'job-z');
    await recordCronFinish(env as any, id, 'job-z', { ok: true });
    expect(await isCronRunning(env as any, 'job-z')).toBe(false);
  });

  it('latest-per-name keeps processes separate', async () => {
    const a = await recordCronStart(env as any, 'wishlist-alerts');
    await recordCronFinish(env as any, a, 'wishlist-alerts', { ok: true, summary: 'fired 2' });
    const b = await recordCronStart(env as any, 'snapshot-portfolios');
    await recordCronFinish(env as any, b, 'snapshot-portfolios', { ok: true });
    const { latest, recent } = await getRecentRuns(env as any);
    expect(Object.keys(latest).sort()).toEqual(['snapshot-portfolios', 'wishlist-alerts']);
    expect(recent[0].name).toBe('snapshot-portfolios'); // newest first
  });
});
