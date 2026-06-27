/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { recordCronStart, recordCronFinish, getRecentRuns, summarizeResult } from './lib/cron-runs';

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
