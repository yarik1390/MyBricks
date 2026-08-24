import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Background-process run tracking. The run() wrapper in index.ts calls
// recordCronStart before a cron and recordCronFinish after, so the admin
// "Activity" view shows every process running -> ok|failed with a short result
// summary. EVERY helper FAILS OPEN: tracking must never break a cron.
// ---------------------------------------------------------------------------

const KEEP_PER_NAME = 5; // history depth retained per process

export interface CronRunRow {
  id: number;
  name: string;
  started_at: string | null;
  finished_at: string | null;
  status: string; // running | ok | failed
  summary: string | null;
  error: string | null;
  duration_ms: number | null;
}

// Turn a cron's return value into a compact one-line summary for the UI.
export function summarizeResult(res: unknown): string | null {
  if (res == null || typeof res !== 'object') return null;
  const r = res as Record<string, unknown>;
  if (typeof r.skipped === 'string' && r.skipped) return `skipped: ${r.skipped}`;
  const parts: string[] = [];
  const add = (key: string, label: string) => {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v)) parts.push(`${label} ${v}`);
  };
  add('updated', 'updated');
  add('matched', 'matched');
  add('fired', 'fired');
  add('discovered', 'found');
  add('processed', 'processed');
  add('rows', 'rows');
  // Job-specific keys that predate the generic schema. Without these the
  // Activity card shows nothing even though the job ran (e.g. minifig jobs).
  add('figs', 'figs');            // valuate-minifigs / minifig-verify
  add('verified', 'verified');    // minifig-verify, community-comps-adjacent
  add('priced', 'priced');        // valuate-minifigs
  add('published', 'published');  // community-comps
  add('candidates', 'cands');     // community-comps / pricecharting candidates
  add('flagged', 'flagged');      // pricing-movers anomaly detection
  add('resolved', 'resolved');    // anomaly auto-resolution
  add('snapshotted', 'snapshotted'); // snapshot-set-values
  add('v3Snapshotted', 'v3 snapshotted');
  add('figSnapshotted', 'fig snapshotted');
  add('pruned', 'pruned');
  add('checked', 'checked');      // minifig-verify
  add('promoted', 'promoted');    // pricecharting-verify
  add('signals', 'signals');      // pricecharting-verify
  add('reblended', 'reblended');  // pricecharting-verify
  add('recomputed', 'recomputed'); // pricing-v3-shadow (blend recompute)
  // Common nested alert counts from wishlist-alerts.
  for (const k of ['spikes', 'retiring', 'deals', 'preorders']) {
    const v = r[k];
    if (typeof v === 'number' && v > 0) parts.push(`${k} ${v}`);
  }
  return parts.length ? parts.slice(0, 4).join(' · ') : null;
}

// Mark orphaned 'running' rows as failed. A Worker invocation killed at the CPU
// limit (or crashed) never reaches recordCronFinish, so its row stays 'running'
// forever and the admin Activity view shows a dead job as live. Swept daily by
// db-hygiene. 30 min is safely beyond any real job's wall time. Fails open.
export async function sweepStaleCronRuns(env: Env, maxAgeMinutes = 30): Promise<number> {
  try {
    const res = await env.DB.prepare(
      `UPDATE cron_runs
         SET status='failed', finished_at=datetime('now'),
             error=COALESCE(NULLIF(error, ''), 'stale: invocation ended before finish was recorded')
       WHERE status='running' AND started_at < datetime('now', ?1)`,
    ).bind(`-${maxAgeMinutes} minutes`).run();
    return Number((res.meta?.changes as number | undefined) ?? 0);
  } catch (e) {
    console.warn('[cron-runs] stale sweep failed open:', (e as Error).message);
    return 0;
  }
}

// Overlap guard: is a previous invocation of this cron still running (and not
// yet stale-swept)? Lets the scheduled dispatcher skip a tick rather than double-
// run a long job that overran its interval. maxAgeMinutes matches the stale sweep
// so a crashed run can never wedge the lease past that window. FAILS OPEN (returns
// false → "not running" → the job proceeds) so a bookkeeping hiccup never stalls crons.
export async function isCronRunning(env: Env, name: string, maxAgeMinutes = 30): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS x FROM cron_runs WHERE name=?1 AND status='running' AND started_at > datetime('now', ?2) LIMIT 1`,
    ).bind(name, `-${maxAgeMinutes} minutes`).first<{ x: number }>();
    return !!row;
  } catch {
    return false;
  }
}

// Insert a 'running' row; returns its id (or null if tracking is unavailable).
export async function recordCronStart(env: Env, name: string): Promise<number | null> {
  try {
    const res = await env.DB.prepare(
      `INSERT INTO cron_runs (name, started_at, status) VALUES (?1, datetime('now'), 'running')`,
    ).bind(name).run();
    return Number(res.meta?.last_row_id ?? 0) || null;
  } catch {
    return null;
  }
}

// Stamp a run as ok/failed with its summary/error + duration, then prune history.
export async function recordCronFinish(
  env: Env,
  id: number | null,
  name: string,
  opts: { ok: boolean; summary?: string | null; error?: string | null; durationMs?: number },
): Promise<void> {
  try {
    if (id) {
      await env.DB.prepare(
        `UPDATE cron_runs SET finished_at=datetime('now'), status=?2, summary=?3, error=?4, duration_ms=?5 WHERE id=?1`,
      ).bind(id, opts.ok ? 'ok' : 'failed', opts.summary ?? null, opts.error ? String(opts.error).slice(0, 300) : null, opts.durationMs ?? null).run();
    } else {
      // Start row was never written (tracking was down then) — insert a closed row.
      await env.DB.prepare(
        `INSERT INTO cron_runs (name, started_at, finished_at, status, summary, error, duration_ms)
         VALUES (?1, datetime('now'), datetime('now'), ?2, ?3, ?4, ?5)`,
      ).bind(name, opts.ok ? 'ok' : 'failed', opts.summary ?? null, opts.error ? String(opts.error).slice(0, 300) : null, opts.durationMs ?? null).run();
    }
    // Keep only the most recent KEEP_PER_NAME rows for this process.
    await env.DB.prepare(
      `DELETE FROM cron_runs WHERE name=?1 AND id NOT IN
         (SELECT id FROM cron_runs WHERE name=?1 ORDER BY id DESC LIMIT ?2)`,
    ).bind(name, KEEP_PER_NAME).run();
  } catch {
    /* fail-open */
  }
}

export interface RecentRuns {
  latest: Record<string, CronRunRow>; // newest run per process name
  recent: CronRunRow[];               // chronological feed (newest first)
}

// Latest run per process + a recent chronological feed. Fails open to empty.
export async function getRecentRuns(env: Env): Promise<RecentRuns> {
  const latest: Record<string, CronRunRow> = {};
  let recent: CronRunRow[] = [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, started_at, finished_at, status, summary, error, duration_ms
         FROM cron_runs WHERE id IN (SELECT MAX(id) FROM cron_runs GROUP BY name)`,
    ).all<CronRunRow>();
    for (const r of results ?? []) latest[r.name] = r;
  } catch { /* none yet */ }
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, name, started_at, finished_at, status, summary, error, duration_ms
         FROM cron_runs ORDER BY id DESC LIMIT 30`,
    ).all<CronRunRow>();
    recent = results ?? [];
  } catch { /* none yet */ }
  return { latest, recent };
}
