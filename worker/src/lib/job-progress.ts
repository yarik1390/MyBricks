import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Live progress for background jobs (Admin > Jobs and Today "Running now").
//
// The cron runner opens a progress context around each job. Inside it, a job
// can call `reportProgress(done, total, step)` from its main loop; the call is
// synchronous for the job and costs nothing outside a tracked run (tests, ad
// hoc calls). Writes go to the job's own cron_runs row and are throttled to one
// every few seconds, so a 13k-row loop adds a handful of D1 writes, not 13k.
//
// The runner also writes a heartbeat on a timer, so even a job without
// progress calls shows "alive N s ago". A heartbeat that stops while the row
// still says running means the invocation was cut off, which the console can
// say within a couple of minutes instead of after the 30-minute stale sweep.
//
// Every write FAILS OPEN: progress must never break or slow a job.
// ---------------------------------------------------------------------------

export const PROGRESS_THROTTLE_MS = 4_000;
export const HEARTBEAT_EVERY_MS = 20_000;

interface ProgressState {
  env: Env;
  runId: number;
  lastWriteMs: number;
  /** Latest values not yet written (throttled). */
  pending: { done: number | null; total: number | null; step: string | null } | null;
  /** Chain of in-flight writes; the runner awaits it before recording finish. */
  chain: Promise<void>;
  now: () => number;
  throttleMs: number;
}

const storage = new AsyncLocalStorage<ProgressState>();

const cleanCount = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

function write(state: ProgressState, heartbeatOnly = false): void {
  const p = state.pending;
  state.pending = null;
  state.lastWriteMs = state.now();
  const { env, runId } = state;
  state.chain = state.chain.then(async () => {
    try {
      if (heartbeatOnly || !p) {
        await env.DB.prepare(`UPDATE cron_runs SET heartbeat_at=datetime('now') WHERE id=?1 AND status='running'`)
          .bind(runId).run();
      } else {
        // COALESCE keeps the last known total/step when a call only moves `done`.
        await env.DB.prepare(
          `UPDATE cron_runs SET heartbeat_at=datetime('now'),
             progress_done=COALESCE(?2, progress_done),
             progress_total=COALESCE(?3, progress_total),
             progress_step=COALESCE(?4, progress_step)
           WHERE id=?1 AND status='running'`,
        ).bind(runId, p.done, p.total, p.step).run();
      }
    } catch (e) {
      console.warn('[job-progress] write failed open:', (e as Error).message);
    }
  });
}

/**
 * Report how far the current job is. `total` and `step` are optional and are
 * kept from the previous call when omitted. No-op outside a tracked run.
 */
export function reportProgress(done: number | null, total?: number | null, step?: string | null): void {
  const state = storage.getStore();
  if (!state) return;
  const prev = state.pending;
  const d = done == null ? prev?.done ?? null : cleanCount(done);
  const t = total == null ? prev?.total ?? null : cleanCount(total);
  const s = step == null ? prev?.step ?? null : String(step).slice(0, 120);
  state.pending = { done: d, total: t, step: s };
  const finished = d != null && t != null && t > 0 && d >= t;
  if (finished || state.now() - state.lastWriteMs >= state.throttleMs) write(state);
}

/** Name the phase the job is in ("Downloading CSV", "Matching sets"). */
export function reportStep(step: string, done?: number | null, total?: number | null): void {
  reportProgress(done ?? null, total ?? null, step);
}

export interface ProgressHandle {
  /** Write any throttled value and wait for every in-flight write. */
  flush(): Promise<void>;
  /** Stop the heartbeat timer. */
  stop(): void;
}

/**
 * Run `fn` inside a progress context for cron_runs row `runId`, with a
 * heartbeat timer. The caller must `stop()` and `flush()` the handle before it
 * writes the run's final status.
 */
export function withProgress<T>(
  env: Env,
  runId: number,
  fn: () => Promise<T>,
  cfg: { now?: () => number; throttleMs?: number; heartbeatMs?: number } = {},
): { result: Promise<T>; handle: ProgressHandle } {
  const now = cfg.now ?? Date.now;
  const state: ProgressState = {
    env, runId, lastWriteMs: now(), pending: null, chain: Promise.resolve(), now,
    throttleMs: cfg.throttleMs ?? PROGRESS_THROTTLE_MS,
  };
  const heartbeatMs = cfg.heartbeatMs ?? HEARTBEAT_EVERY_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  if (heartbeatMs > 0) {
    timer = setInterval(() => {
      // Pending progress doubles as the heartbeat; otherwise write a bare one.
      if (state.now() - state.lastWriteMs >= heartbeatMs / 2) write(state, !state.pending);
    }, heartbeatMs);
  }
  const result = storage.run(state, fn);
  return {
    result,
    handle: {
      stop() { if (timer) { clearInterval(timer); timer = undefined; } },
      async flush() {
        if (state.pending) write(state);
        await state.chain;
      },
    },
  };
}
