import type { Env } from '../types';
import { pruneCronRuns, summarizeResult, resultFailed } from './cron-runs';

// ---------------------------------------------------------------------------
// Scheduled-job runner. One instance per scheduled() invocation.
//
// Why it exists (2026-11-12): jobs in one cron slot ran as a plain chain, so
// the first job that threw, hung or took the invocation down with it silently
// cancelled every job behind it. part-out-compute died that way daily from
// Nov 4 and froze the value model and bundle values behind it for 8 days;
// snapshot-set-values did the same to anomaly detection and the AI model
// refresh from Nov 10. Three rules fix the class, whatever kills a job:
//
//  1. Isolation: a job that throws is recorded as failed and the slot moves
//     on. The first error is rethrown at the END (throwIfFailed), so the
//     platform still sees a failed invocation.
//  2. Deadlines: every job races a timer (its own cap, and the slot's wall
//     budget). A hung job is recorded as "timed out" instead of leaving a
//     'running' row for the nightly sweep, and the jobs behind it still run.
//  3. Catch-up (runMissedJobs): a later, separate invocation re-runs daily
//     jobs that have no successful run in the last day.
// ---------------------------------------------------------------------------

/** Cloudflare ends a cron invocation at 15 minutes of wall time. */
export const SLOT_BUDGET_MS = 14 * 60_000;
const MIN_START_MS = 5_000;

export class CronTimeoutError extends Error {
  constructor(public readonly afterMs: number) {
    super(`timed out after ${Math.round(afterMs / 1000)}s`);
    this.name = 'CronTimeoutError';
  }
}

export interface RunOptions {
  /** Stale-lease window: a 'running' row older than this no longer blocks. */
  maxAgeMinutes?: number;
  /** Cap for this job. The slot's remaining wall budget always applies too. */
  timeoutMs?: number;
}

export interface CronRunner {
  run(name: string, fn: () => Promise<unknown>, opts?: RunOptions | number): Promise<void>;
  /** Rethrows the first job or lease error of this invocation, if any. */
  throwIfFailed(): void;
  readonly errors: ReadonlyArray<{ name: string; error: Error }>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, delaysMs: number[]): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= delaysMs.length; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (i < delaysMs.length) await sleep(delaysMs[i]);
    }
  }
  throw last;
}

export function createCronRunner(
  env: Env,
  cfg: { slotBudgetMs?: number; now?: () => number; retryDelaysMs?: number[] } = {},
): CronRunner {
  const now = cfg.now ?? Date.now;
  const slotDeadline = now() + (cfg.slotBudgetMs ?? SLOT_BUDGET_MS);
  const retryDelays = cfg.retryDelaysMs ?? [400, 1500];
  const errors: Array<{ name: string; error: Error }> = [];
  let leaseDown = false;

  // The finish write is what turns a 'running' row into ok/failed. D1 can be
  // briefly unavailable right after a heavy job, so it is retried: a lost
  // finish shows up as a phantom "stale" failure a day later.
  const finish = async (
    id: number, name: string,
    opts: { ok: boolean; summary?: string | null; error?: string | null; durationMs?: number },
  ): Promise<void> => {
    try {
      await withRetry(() => env.DB.prepare(
        `UPDATE cron_runs SET finished_at=datetime('now'), status=?2, summary=?3, error=?4, duration_ms=?5 WHERE id=?1`,
      ).bind(id, opts.ok ? 'ok' : 'failed', opts.summary ?? null,
        opts.error ? String(opts.error).slice(0, 300) : null, opts.durationMs ?? null).run(), retryDelays);
    } catch (e) {
      console.error(`[cron] ${name}: finish not recorded:`, (e as Error).message);
    }
    await pruneCronRuns(env, name);
  };

  async function run(name: string, fn: () => Promise<unknown>, opts: RunOptions | number = {}): Promise<void> {
    const o: RunOptions = typeof opts === 'number' ? { maxAgeMinutes: opts } : opts;
    const maxAgeMinutes = o.maxAgeMinutes ?? 30;
    const startedMs = now();

    // A single SQLite statement serializes the lease check and acquisition.
    // If lease storage stays unavailable the job is NOT run unguarded: the
    // error is kept for throwIfFailed and the slot moves on.
    let lease: { id: number } | null;
    try {
      lease = await withRetry(() => env.DB.prepare(`
        INSERT INTO cron_runs (name, started_at, status)
        SELECT ?1, datetime('now'), 'running'
        WHERE NOT EXISTS (
          SELECT 1 FROM cron_runs WHERE name=?1 AND status='running'
          AND started_at >= datetime('now', ?2)
        ) RETURNING id
      `).bind(name, `-${maxAgeMinutes} minutes`).first<{ id: number }>(), leaseDown ? [] : retryDelays);
    } catch (e) {
      // Later jobs in this slot still try once each, without the backoff.
      leaseDown = true;
      console.error(`[cron] ${name} not started: lease storage unavailable:`, e);
      errors.push({ name, error: e as Error });
      return;
    }
    if (!lease) {
      console.warn(`[cron] ${name} skipped: previous run still active`);
      return;
    }
    const runId = lease.id;

    const remaining = slotDeadline - now();
    if (remaining < MIN_START_MS) {
      const error = new Error('not started: earlier jobs in this run used up its time');
      errors.push({ name, error });
      await finish(runId, name, { ok: false, error: error.message, durationMs: 0 });
      return;
    }
    const budget = Math.min(remaining, o.timeoutMs ?? remaining);

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new CronTimeoutError(budget)), budget);
        }),
      ]);
      const summary = summarizeResult(res);
      const failed = resultFailed(res);
      await finish(runId, name, {
        ok: !failed, summary,
        error: failed ? `Provider/item failures: ${summary}` : null,
        durationMs: now() - startedMs,
      });
    } catch (e) {
      console.error(`[cron] ${name} failed:`, e);
      errors.push({ name, error: e as Error });
      await finish(runId, name, { ok: false, error: (e as Error).message, durationMs: now() - startedMs });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    run,
    errors,
    throwIfFailed() {
      if (errors.length) throw errors[0].error;
    },
  };
}

// ---------------------------------------------------------------------------
// Catch-up for daily jobs.
// ---------------------------------------------------------------------------

export interface MissedJobOptions {
  /** A job is due when its last successful run is older than this. */
  staleHours?: number;
  /** Stop retrying once a job was started this many times in attemptWindowHours. */
  maxAttempts?: number;
  attemptWindowHours?: number;
  /** Most catch-up runs in one invocation. */
  maxPerTick?: number;
}

/**
 * Names (in the given order) of jobs with no successful run in the last
 * `staleHours` and fewer than `maxAttempts` starts in the attempt window.
 * A job that has never run is due. Fails open to "nothing due".
 */
export async function findMissedJobs(env: Env, names: string[], opts: MissedJobOptions = {}): Promise<string[]> {
  if (!names.length) return [];
  const staleHours = opts.staleHours ?? 26;
  const maxAttempts = opts.maxAttempts ?? 3;
  const windowHours = opts.attemptWindowHours ?? 20;
  try {
    const ph = names.map((_, i) => `?${i + 3}`).join(',');
    const { results } = await env.DB.prepare(`
      SELECT name,
             MAX(CASE WHEN status='ok' AND started_at >= datetime('now', ?1) THEN 1 ELSE 0 END) AS fresh_ok,
             SUM(CASE WHEN started_at >= datetime('now', ?2) THEN 1 ELSE 0 END) AS attempts
      FROM cron_runs WHERE name IN (${ph}) GROUP BY name
    `).bind(`-${staleHours} hours`, `-${windowHours} hours`, ...names)
      .all<{ name: string; fresh_ok: number; attempts: number }>();
    const seen = new Map((results ?? []).map((r) => [r.name, r]));
    return names.filter((name) => {
      const r = seen.get(name);
      if (!r) return true;
      return !Number(r.fresh_ok) && Number(r.attempts) < maxAttempts;
    });
  } catch (e) {
    console.warn('[cron] catch-up check failed open:', (e as Error).message);
    return [];
  }
}

/** Re-run up to `maxPerTick` missed daily jobs through the runner (lease-guarded). */
export async function runMissedJobs(
  env: Env,
  runner: CronRunner,
  jobs: Record<string, () => Promise<unknown>>,
  opts: MissedJobOptions & { timeoutMs?: number } = {},
): Promise<string[]> {
  const due = (await findMissedJobs(env, Object.keys(jobs), opts)).slice(0, opts.maxPerTick ?? 2);
  for (const name of due) {
    console.warn(`[cron] catch-up: ${name} has no successful run in the last day, running it now`);
    await runner.run(name, jobs[name], { timeoutMs: opts.timeoutMs ?? 4 * 60_000 });
  }
  return due;
}
