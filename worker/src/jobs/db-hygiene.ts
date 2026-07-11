import type { Env } from '../types';
import { sweepStaleCronRuns } from '../lib/cron-runs';

// Daily cleanup of unbounded tables. Each table accumulates rows that are only
// useful for a short window: rate-limit counters, short-lived OAuth nonces, and
// import job history. Without this, they grow forever on a busy deployment.
export async function runDbHygiene(env: Env): Promise<{ deleted: Record<string, number>; retailBackfilled: number; comingSoonHealed: number; staleCronRuns: number }> {
  // Close out cron_runs rows orphaned at 'running' by a killed invocation, so the
  // admin Activity view doesn't show dead jobs as live indefinitely.
  const staleCronRuns = await sweepStaleCronRuns(env);

  const stmts = [
    // Hourly/daily windows — anything older than 48h can never match a live window.
    env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < datetime('now', '-48 hours')`),
    // OAuth nonces expire in minutes; keep a day of slack for clock skew, then purge.
    env.DB.prepare(`DELETE FROM oauth_sessions WHERE expires_at < unixepoch() - 86400`),
    env.DB.prepare(`DELETE FROM oauth_states WHERE expires_at < unixepoch() - 86400`),
    // Job history: keep the 20 most recent runs regardless of age, drop the rest
    // once they're older than 30 days.
    env.DB.prepare(`
      DELETE FROM import_runs
      WHERE started_at < datetime('now', '-30 days')
        AND id NOT IN (SELECT id FROM import_runs ORDER BY started_at DESC LIMIT 20)
    `),
  ];

  const results = await env.DB.batch(stmts);
  const tables = ['rate_limits', 'oauth_sessions', 'oauth_states', 'import_runs'];
  const deleted: Record<string, number> = {};
  results.forEach((r, i) => { deleted[tables[i]] = r.meta?.changes ?? 0; });

  // Backfill the canonical ROI field (retail_price) from MSRP / retail data we
  // already have but never copied into it — the brickset-enrich cron historically
  // wrote brickset_msrp only, leaving retail_price null so ROI/discount math fell
  // back to estimates. Pure D1, idempotent, bounded (drains over a few nights).
  let retailBackfilled = 0;
  try {
    const fix = await env.DB.prepare(`
      UPDATE lego_sets SET retail_price = COALESCE(brickset_msrp, be_retail)
      WHERE set_num IN (
        SELECT set_num FROM lego_sets
        WHERE COALESCE(brickset_msrp, be_retail) > 0
          AND (
            retail_price IS NULL OR retail_price <= 0
            -- Formula-valued rows (imported with pieces=0 etc.) can carry a
            -- nonsense retail like $9.90 on an $800 set; when an authoritative
            -- MSRP disagrees by more than 2x either way, the MSRP wins.
            OR (valuation_method LIKE 'formula%' AND (
                 retail_price * 2 < COALESCE(brickset_msrp, be_retail)
              OR retail_price > COALESCE(brickset_msrp, be_retail) * 2))
          )
        LIMIT 5000
      )
    `).run();
    retailBackfilled = (fix.meta?.changes as number | undefined) ?? 0;
  } catch (e) {
    console.warn('[db-hygiene] retail_price backfill failed:', (e as Error).message);
  }

  // Unreleased ("coming soon") sets have no market yet: their current value is
  // their retail price, not a formula guess. Keeps wishlist "Now" prices sane.
  let comingSoonHealed = 0;
  try {
    const fix = await env.DB.prepare(`
      UPDATE lego_sets SET current_value = retail_price
      WHERE lego_availability = 'coming_soon'
        AND valuation_method LIKE 'formula%'
        AND retail_price > 0
        AND (current_value IS NULL OR current_value < retail_price * 0.8 OR current_value > retail_price * 1.2)
    `).run();
    comingSoonHealed = (fix.meta?.changes as number | undefined) ?? 0;
  } catch (e) {
    console.warn('[db-hygiene] coming-soon value heal failed:', (e as Error).message);
  }

  return { deleted, retailBackfilled, comingSoonHealed, staleCronRuns };
}
