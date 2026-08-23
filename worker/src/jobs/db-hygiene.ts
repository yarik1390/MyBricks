import type { Env } from '../types';
import { sweepStaleCronRuns } from '../lib/cron-runs';
import { runOpsHealthCheck } from '../lib/ops-alerts';
import { formulaValuation, valuationExpiryModifier } from '../lib/valuation';
import { recomputeBlendedValues } from '../lib/market-sources';

// Daily cleanup of unbounded tables. Each table accumulates rows that are only
// useful for a short window: rate-limit counters, short-lived OAuth nonces, and
// import job history. Without this, they grow forever on a busy deployment.
export async function runDbHygiene(env: Env): Promise<{ deleted: Record<string, number>; retailBackfilled: number; comingSoonHealed: number; retailEchoScrubbed: number; beValuesHealed: number; staleCronRuns: number; opsAlerts: number }> {
  // Close out cron_runs rows orphaned at 'running' by a killed invocation, so the
  // admin Activity view doesn't show dead jobs as live indefinitely.
  const staleCronRuns = await sweepStaleCronRuns(env);

  // ...then actually LOOK at what the sweep and integration_health are saying.
  // Runs after the sweep so jobs killed mid-flight are already marked failed.
  const ops = await runOpsHealthCheck(env);

  const stmts = [
    // Hourly/daily windows — anything older than 48h can never match a live window.
    env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < datetime('now', '-48 hours')`),
    // Idempotency ledgers are short-lived operational state. Failed/abandoned
    // processing records become retryable once their quota lease is stale.
    // A killed invocation cannot finalize its lease; expire it promptly so a
    // provider outage does not strand a user's hourly/daily allowance.
    env.DB.prepare(`UPDATE scan_quota_reservations SET state='released', updated_at=CURRENT_TIMESTAMP WHERE state='reserved' AND updated_at < datetime('now', '-30 minutes')`),
    env.DB.prepare(`DELETE FROM scan_quota_reservations WHERE updated_at < datetime('now', '-48 hours')`),
    env.DB.prepare(`DELETE FROM scan_requests WHERE updated_at < datetime('now', '-48 hours')`),
    // Admin operation keys protect retries only for the lifetime of a job. Keep
    // enough history to absorb delayed client retries without growing forever.
    env.DB.prepare(`DELETE FROM admin_operation_claims WHERE updated_at < datetime('now', '-7 days')`),
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
  const tables = [
    'rate_limits',
    'stale_scan_quota_reservations',
    'scan_quota_reservations',
    'scan_requests',
    'admin_operation_claims',
    'oauth_sessions',
    'oauth_states',
    'import_runs',
  ];
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

  // Fabricated retail echo: the BrickEconomy LLM scrape sometimes copies the
  // market value into the retail field (Ole Kirk's House stored retail =
  // $13,037 = value). With no independent MSRP and a ≥$500 figure, such a
  // retail is fiction — and it used to anchor the plausibility gate for the
  // very value that fabricated it. Scrub be_retail, and retail_price too when
  // it was fed by that echo. New sets genuinely worth exactly RRP either have
  // a brickset_msrp or sit under the $500 bar, so they're untouched.
  let retailEchoScrubbed = 0;
  try {
    const fix = await env.DB.prepare(`
      UPDATE lego_sets SET
        retail_price = CASE WHEN retail_price = be_retail THEN NULL ELSE retail_price END,
        be_retail = NULL
      WHERE be_retail IS NOT NULL
        AND be_retail = be_value_new
        AND brickset_msrp IS NULL
        AND be_value_new >= 500
    `).run();
    retailEchoScrubbed = (fix.meta?.changes as number | undefined) ?? 0;
  } catch (e) {
    console.warn('[db-hygiene] retail echo scrub failed:', (e as Error).message);
  }

  const beValuesHealed = await healImplausibleBeValues(env);

  return { deleted, retailBackfilled, comingSoonHealed, retailEchoScrubbed, beValuesHealed, staleCronRuns, opsAlerts: ops.alerts.length };
}

// Rows whose current_value came from an UNCORROBORATED BrickEconomy scrape that
// the plausibility gate (lib/valuation.ts) would now reject — no comps, no
// independent retail anchor, and an absurd $/piece or an anchorless four-figure
// claim. These are the "$15,000 for a 177-piece kit" / "$3,999 pencil case"
// rows that used to top the value-sorted catalog. Replace with the honest
// formula estimate, drop the poisoned be_* staging figures, and re-blend so
// the persisted headline/confidence match. Idempotent: healed rows carry
// valuation_method='formula_bulk' and no longer match the predicate.
async function healImplausibleBeValues(env: Env): Promise<number> {
  try {
    const { results } = await env.DB.prepare(`
      SELECT set_num, name, pieces, year, theme, minifigs, retired, current_value
      FROM lego_sets
      WHERE valuation_method = 'brickeconomy'
        AND bl_new_value IS NULL AND ebay_new_value IS NULL
        AND ebay_ask_value IS NULL AND bo_new_value IS NULL
        AND brickset_msrp IS NULL
        AND (retail_price IS NULL OR retail_price = current_value OR retail_price = be_retail)
        AND ((pieces >= 30 AND current_value / pieces > 20)
             OR (COALESCE(pieces, 0) < 30 AND current_value > 2000))
      LIMIT 200
    `).all<{ set_num: string; name: string; pieces: number; year: number; theme: string | null; minifigs: number; retired: number; current_value: number }>();
    if (!results.length) return 0;

    const stmts = results.map((s) => {
      const f = formulaValuation({ pieces: s.pieces, year: s.year, theme: s.theme, retired: !!s.retired, minifigs: s.minifigs });
      console.warn(`[db-hygiene] healing implausible BE value on ${s.set_num} (${s.name}): $${s.current_value} -> formula $${f.current_value}`);
      return env.DB.prepare(`
        UPDATE lego_sets SET
          current_value=?, forecast_2y=?, forecast_5y=?,
          valuation_method='formula_bulk',
          be_value_new=NULL, be_forecast_2y=NULL, be_forecast_5y=NULL,
          retail_price = CASE WHEN retail_price = be_retail THEN NULL ELSE retail_price END,
          be_retail=NULL,
          valuation_expires_at=datetime('now', ?),
          cached_at=datetime('now')
        WHERE set_num=?
      `).bind(f.current_value, f.forecast_2y, f.forecast_5y, valuationExpiryModifier('formula_bulk'), s.set_num);
    });
    for (let i = 0; i < stmts.length; i += 90) {
      await env.DB.batch(stmts.slice(i, i + 90));
    }
    // Re-blend so blended_value / confidence / the v3 state rows reflect the
    // healed figures instead of the quarantined scrape.
    await recomputeBlendedValues(env.DB, results.map((s) => s.set_num));
    return results.length;
  } catch (e) {
    console.warn('[db-hygiene] BE value heal failed:', (e as Error).message);
    return 0;
  }
}
