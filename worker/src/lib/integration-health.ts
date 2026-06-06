import type { Env } from '../types';

// External services whose reachability we track so silent fallbacks become visible.
export type IntegrationName =
  | 'ebay'
  | 'bricklink'
  | 'brickeconomy'
  | 'brickset'
  | 'brickowl'
  | 'gemini'
  | 'openai'
  | 'rebrickable';

export interface IntegrationTally {
  ok: number;
  fail: number;
  lastError?: string | null;
}

export interface IntegrationHealthRow {
  service: string;
  last_ok_at: string | null;
  last_fail_at: string | null;
  last_error: string | null;
  ok_count: number;
  fail_count: number;
  updated_at: string | null;
  // Computed (not stored): 'ok' | 'degraded' | 'down'. Lets the UI surface a
  // silent integration outage instead of hiding it behind graceful fallbacks.
  status?: 'ok' | 'degraded' | 'down';
}

/**
 * Classify a health row. 'down' = the most recent attempt failed; 'degraded' =
 * recent attempts include a meaningful share of failures; 'ok' otherwise.
 */
export function classifyHealth(row: IntegrationHealthRow): 'ok' | 'degraded' | 'down' {
  const okAt = row.last_ok_at ? Date.parse(row.last_ok_at) : 0;
  const failAt = row.last_fail_at ? Date.parse(row.last_fail_at) : 0;
  if (failAt && failAt >= okAt) return 'down';
  const total = (row.ok_count || 0) + (row.fail_count || 0);
  if (total > 0 && row.fail_count / total >= 0.25) return 'degraded';
  return 'ok';
}

/**
 * Upsert an aggregate health tally for one service. Designed to be called once
 * per service per job run (not per request) to avoid write amplification.
 * Never throws — health tracking must never break the caller.
 */
export async function recordIntegrationHealth(
  env: Env,
  service: IntegrationName,
  tally: IntegrationTally,
): Promise<void> {
  const ok = Math.max(0, tally.ok | 0);
  const fail = Math.max(0, tally.fail | 0);
  if (ok === 0 && fail === 0) return;
  const err = fail > 0 ? (tally.lastError ?? 'unknown error')?.slice(0, 300) : null;
  try {
    await env.DB.prepare(`
      INSERT INTO integration_health (service, last_ok_at, last_fail_at, last_error, ok_count, fail_count, updated_at)
      VALUES (
        ?1,
        CASE WHEN ?2 > 0 THEN datetime('now') END,
        CASE WHEN ?3 > 0 THEN datetime('now') END,
        ?4, ?2, ?3, datetime('now')
      )
      ON CONFLICT(service) DO UPDATE SET
        last_ok_at  = CASE WHEN ?2 > 0 THEN datetime('now') ELSE integration_health.last_ok_at END,
        last_fail_at = CASE WHEN ?3 > 0 THEN datetime('now') ELSE integration_health.last_fail_at END,
        last_error  = CASE WHEN ?3 > 0 THEN ?4 ELSE integration_health.last_error END,
        ok_count    = integration_health.ok_count + ?2,
        fail_count  = integration_health.fail_count + ?3,
        updated_at  = datetime('now')
    `).bind(service, ok, fail, err).run();
  } catch (e) {
    console.warn('[integration-health] record failed:', (e as Error).message);
  }
}

/** Read all tracked integration health rows, ordered by service name. */
export async function getIntegrationHealth(env: Env): Promise<IntegrationHealthRow[]> {
  try {
    const { results } = await env.DB
      .prepare('SELECT * FROM integration_health ORDER BY service')
      .all<IntegrationHealthRow>();
    return (results ?? []).map(r => ({ ...r, status: classifyHealth(r) }));
  } catch (e) {
    console.warn('[integration-health] read failed:', (e as Error).message);
    return [];
  }
}
