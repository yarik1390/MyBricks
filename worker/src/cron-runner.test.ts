/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env as testEnv } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './types';
import { createCronRunner, findMissedJobs, runMissedJobs } from './lib/cron-runner';

const env = testEnv as unknown as Env;
const rows = async () => (await env.DB.prepare(
  'SELECT name, status, error, summary FROM cron_runs ORDER BY id',
).all<{ name: string; status: string; error: string | null; summary: string | null }>()).results;
const seed = (name: string, status: string, ago: string) => env.DB.prepare(
  `INSERT INTO cron_runs (name, started_at, finished_at, status) VALUES (?1, datetime('now', ?2), datetime('now', ?2), ?3)`,
).bind(name, ago, status).run();

describe('cron runner', () => {
  beforeEach(async () => {
    await env.DB.prepare('DROP TABLE IF EXISTS cron_runs').run();
    await env.DB.prepare(`CREATE TABLE cron_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, started_at TEXT,
      finished_at TEXT, status TEXT, summary TEXT, error TEXT, duration_ms INTEGER,
      progress_done INTEGER, progress_total INTEGER, progress_step TEXT, heartbeat_at TEXT
    )`).run();
  });

  it('keeps running the slot after a job throws, then rethrows the first error', async () => {
    const runner = createCronRunner(env, { retryDelaysMs: [] });
    const second = vi.fn(async () => ({ processed: 3 }));
    await runner.run('first', async () => { throw new Error('boom'); });
    await runner.run('second', second);
    expect(second).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual([
      { name: 'first', status: 'failed', error: 'boom', summary: null },
      { name: 'second', status: 'ok', error: null, summary: 'processed 3' },
    ]);
    expect(() => runner.throwIfFailed()).toThrow('boom');
  });

  it('records a hung job as timed out and still runs the next one', async () => {
    const runner = createCronRunner(env, { retryDelaysMs: [] });
    const next = vi.fn(async () => ({}));
    await runner.run('hung', () => new Promise(() => {}), { timeoutMs: 30 });
    await runner.run('next', next);
    expect(next).toHaveBeenCalledTimes(1);
    const [hung, after] = await rows();
    expect(hung).toMatchObject({ name: 'hung', status: 'failed' });
    expect(hung.error).toMatch(/^timed out after/);
    expect(after).toMatchObject({ name: 'next', status: 'ok' });
    expect(() => runner.throwIfFailed()).toThrow(/timed out/);
  });

  it('does not start a job when the slot has no time left, and says so', async () => {
    const runner = createCronRunner(env, { slotBudgetMs: 0, retryDelaysMs: [] });
    const fn = vi.fn(async () => ({}));
    await runner.run('late', fn);
    expect(fn).not.toHaveBeenCalled();
    expect((await rows())[0]).toMatchObject({ name: 'late', status: 'failed' });
    expect((await rows())[0].error).toMatch(/not started/);
  });

  it('never runs a job unguarded when lease storage is unavailable', async () => {
    await env.DB.prepare('DROP TABLE cron_runs').run();
    const runner = createCronRunner(env, { retryDelaysMs: [] });
    const fn = vi.fn(async () => ({}));
    await runner.run('unguarded', fn);
    expect(fn).not.toHaveBeenCalled();
    expect(() => runner.throwIfFailed()).toThrow();
  });

  it('skips a job whose previous run still holds the lease', async () => {
    await seed('busy', 'running', '-2 minutes');
    const runner = createCronRunner(env, { retryDelaysMs: [] });
    const fn = vi.fn(async () => ({}));
    await runner.run('busy', fn);
    expect(fn).not.toHaveBeenCalled();
    expect(() => runner.throwIfFailed()).not.toThrow();
  });

  it('marks a result with failed items as failed without throwing', async () => {
    const runner = createCronRunner(env, { retryDelaysMs: [] });
    await runner.run('partial', async () => ({ failed: 2, processed: 5 }));
    expect((await rows())[0]).toMatchObject({ status: 'failed' });
    expect(() => runner.throwIfFailed()).not.toThrow();
  });
});

describe('daily catch-up', () => {
  beforeEach(async () => {
    await env.DB.prepare('DROP TABLE IF EXISTS cron_runs').run();
    await env.DB.prepare(`CREATE TABLE cron_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, started_at TEXT,
      finished_at TEXT, status TEXT, summary TEXT, error TEXT, duration_ms INTEGER,
      progress_done INTEGER, progress_total INTEGER, progress_step TEXT, heartbeat_at TEXT
    )`).run();
  });

  it('finds jobs with no successful run in the last day, in priority order', async () => {
    await seed('fresh', 'ok', '-3 hours');
    await seed('old-ok', 'ok', '-40 hours');
    await seed('failed-today', 'ok', '-50 hours');
    await seed('failed-today', 'failed', '-2 hours');
    expect(await findMissedJobs(env, ['never-ran', 'fresh', 'old-ok', 'failed-today']))
      .toEqual(['never-ran', 'old-ok', 'failed-today']);
  });

  it('gives up for the day after three attempts', async () => {
    await seed('stuck', 'failed', '-1 hours');
    await seed('stuck', 'failed', '-2 hours');
    expect(await findMissedJobs(env, ['stuck'])).toEqual(['stuck']);
    await seed('stuck', 'failed', '-3 hours');
    expect(await findMissedJobs(env, ['stuck'])).toEqual([]);
  });

  it('runs at most two missed jobs per tick and leaves fresh ones alone', async () => {
    await seed('fresh', 'ok', '-1 hours');
    const jobs = {
      a: vi.fn(async () => ({ processed: 1 })),
      fresh: vi.fn(async () => ({})),
      b: vi.fn(async () => ({})),
      c: vi.fn(async () => ({})),
    };
    const runner = createCronRunner(env, { retryDelaysMs: [] });
    expect(await runMissedJobs(env, runner, jobs)).toEqual(['a', 'b']);
    expect(jobs.a).toHaveBeenCalledTimes(1);
    expect(jobs.b).toHaveBeenCalledTimes(1);
    expect(jobs.fresh).not.toHaveBeenCalled();
    expect(jobs.c).not.toHaveBeenCalled();
    // Now fresh, so the next tick moves on to the one left over.
    expect(await runMissedJobs(env, runner, jobs)).toEqual(['c']);
  });

  it('fails open to nothing due when the run table is unavailable', async () => {
    await env.DB.prepare('DROP TABLE cron_runs').run();
    expect(await findMissedJobs(env, ['a'])).toEqual([]);
  });
});
