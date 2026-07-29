import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Daily ops health check.
//
// Motivation, from a real incident: the eBay-sold scrape died on every run for
// six days — Bright Data 502'd every call, each invocation was killed before it
// could flush, and not one price was written. Nothing surfaced it. `cron_runs`
// and `integration_health` had recorded the whole outage faithfully; no one was
// reading them.
//
// This reads those two tables once a day and shouts when a job or a provider has
// stopped working. It is deliberately dumb — two thresholds, no state machine,
// no per-service tuning — because an alert nobody trusts is worse than none.
// Everything FAILS OPEN: the health check must never break db-hygiene.
// ---------------------------------------------------------------------------

export interface OpsAlert {
  kind: 'cron' | 'integration';
  name: string;
  detail: string;
}

export interface OpsHealthReport {
  alerts: OpsAlert[];
  notified: boolean;
}

// A job that failed this many times in 24h with no success since is "dead", not
// "flaky". Scrapers legitimately fail individual runs; three in a row is a break.
const CRON_FAIL_THRESHOLD = 3;

export async function runOpsHealthCheck(env: Env): Promise<OpsHealthReport> {
  const alerts: OpsAlert[] = [];

  try {
    // Jobs whose recent history is failures with no success after the last one.
    // `status='running'` rows count as failures here: db-hygiene's stale sweep
    // only closes them out after 30 minutes, and a run that never reported is
    // exactly the symptom the eBay incident presented with.
    const { results } = await env.DB.prepare(`
      SELECT name,
             SUM(CASE WHEN status IN ('failed','running') THEN 1 ELSE 0 END) AS bad,
             SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS good,
             MAX(CASE WHEN status = 'ok' THEN started_at END) AS last_ok,
             MAX(CASE WHEN status IN ('failed','running') THEN started_at END) AS last_bad
      FROM cron_runs
      WHERE started_at > datetime('now', '-24 hours')
      GROUP BY name
      HAVING bad >= ?1
    `).bind(CRON_FAIL_THRESHOLD).all<{ name: string; bad: number; good: number; last_ok: string | null; last_bad: string | null }>();

    for (const r of results ?? []) {
      // A job that also succeeded more recently than it failed has recovered.
      if (r.last_ok && r.last_bad && r.last_ok > r.last_bad) continue;
      alerts.push({
        kind: 'cron',
        name: r.name,
        detail: `${r.bad} failed/stalled run(s) in 24h, ${r.good} ok · last success ${r.last_ok ?? 'never in window'}`,
      });
    }
  } catch (e) {
    console.warn('[ops-alerts] cron scan failed open:', (e as Error).message);
  }

  try {
    // Providers that are actively failing and have not succeeded in 24h. Ones
    // that are simply idle (no recent failures either) are not reported —
    // BrickOwl is switched off on purpose and must not alert forever.
    const { results } = await env.DB.prepare(`
      SELECT service, last_ok_at, last_fail_at, fail_count, last_error
      FROM integration_health
      WHERE last_fail_at > datetime('now', '-24 hours')
        AND (last_ok_at IS NULL OR last_ok_at < datetime('now', '-24 hours'))
    `).all<{ service: string; last_ok_at: string | null; last_fail_at: string | null; fail_count: number; last_error: string | null }>();

    for (const r of results ?? []) {
      alerts.push({
        kind: 'integration',
        name: r.service,
        detail: `no success since ${r.last_ok_at ?? 'ever'} · ${r.fail_count} lifetime failures · ${(r.last_error ?? '').slice(0, 120)}`,
      });
    }
  } catch (e) {
    console.warn('[ops-alerts] integration scan failed open:', (e as Error).message);
  }

  if (!alerts.length) return { alerts, notified: false };

  for (const a of alerts) console.error(`[ops-alerts] ${a.kind} ${a.name}: ${a.detail}`);
  const notified = await postOpsAlert(env, alerts);
  return { alerts, notified };
}

async function postOpsAlert(env: Env, alerts: OpsAlert[]): Promise<boolean> {
  const url = env.DISCORD_OPS_WEBHOOK?.trim();
  if (!url) return false;
  const lines = alerts.slice(0, 15).map((a) => `• **${a.name}** (${a.kind}) — ${a.detail}`);
  if (alerts.length > lines.length) lines.push(`…and ${alerts.length - lines.length} more`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Discord caps a message at 2000 characters and drops the whole payload
      // if exceeded — truncate rather than lose the alert entirely.
      body: JSON.stringify({ content: `⚠️ **Brickvault ops** — ${alerts.length} issue(s)\n${lines.join('\n')}`.slice(0, 1900) }),
    });
    return res.ok;
  } catch (e) {
    console.warn('[ops-alerts] webhook post failed:', (e as Error).message);
    return false;
  }
}
