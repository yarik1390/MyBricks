/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env as testEnv } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from './types';
import { createCronRunner } from './lib/cron-runner';
import { reportProgress, reportStep } from './lib/job-progress';

const env = testEnv as unknown as Env;
const row = async () => env.DB.prepare(
  'SELECT status, progress_done, progress_total, progress_step, heartbeat_at FROM cron_runs ORDER BY id DESC LIMIT 1',
).first<{ status: string; progress_done: number | null; progress_total: number | null; progress_step: string | null; heartbeat_at: string | null }>();

describe('job progress', () => {
  beforeEach(async () => {
    await env.DB.prepare('DROP TABLE IF EXISTS cron_runs').run();
    await env.DB.prepare(`CREATE TABLE cron_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, started_at TEXT,
      finished_at TEXT, status TEXT, summary TEXT, error TEXT, duration_ms INTEGER,
      progress_done INTEGER, progress_total INTEGER, progress_step TEXT, heartbeat_at TEXT
    )`).run();
  });

  it('is a no-op outside a tracked run', () => {
    expect(() => reportProgress(1, 2, 'x')).not.toThrow();
  });

  it('is visible on the running row while the job works, and kept after it finishes', async () => {
    const runner = createCronRunner(env, { retryDelaysMs: [], heartbeatMs: 0 });
    let seenWhileRunning: Awaited<ReturnType<typeof row>> = null;
    await runner.run('job', async () => {
      reportStep('Downloading', 0, 3); // first call: within throttle, kept pending
      reportProgress(3, 3);            // done === total: written at once
      await new Promise((r) => setTimeout(r, 20));
      seenWhileRunning = await row();
      return { processed: 3 };
    });
    expect(seenWhileRunning).toMatchObject({ status: 'running', progress_done: 3, progress_total: 3, progress_step: 'Downloading' });
    expect(seenWhileRunning!.heartbeat_at).toBeTruthy();
    expect(await row()).toMatchObject({ status: 'ok', progress_done: 3, progress_step: 'Downloading' });
  });

  it('keeps the last step of a failed run, so the console can say where it stopped', async () => {
    const runner = createCronRunner(env, { retryDelaysMs: [], heartbeatMs: 0 });
    await runner.run('job', async () => {
      reportStep('Matching rows to sets', 2, 7);
      throw new Error('D1_ERROR: too many columns in result set');
    });
    expect(await row()).toMatchObject({ status: 'failed', progress_done: 2, progress_total: 7, progress_step: 'Matching rows to sets' });
  });

  it('never breaks a job when the progress columns are missing', async () => {
    await env.DB.prepare('DROP TABLE cron_runs').run();
    await env.DB.prepare(`CREATE TABLE cron_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, started_at TEXT,
      finished_at TEXT, status TEXT, summary TEXT, error TEXT, duration_ms INTEGER
    )`).run();
    const runner = createCronRunner(env, { retryDelaysMs: [], heartbeatMs: 0 });
    await runner.run('job', async () => { reportProgress(5, 5, 'x'); return { processed: 5 }; });
    const r = await env.DB.prepare('SELECT status, summary FROM cron_runs').first();
    expect(r).toMatchObject({ status: 'ok', summary: 'processed 5' });
  });
});
