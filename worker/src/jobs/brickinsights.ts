import type { Env } from '../types';
import { fetchBrickInsightsRating } from '../lib/brickinsights';
import { brickInsightsEnabled } from '../lib/pricing-flags';
import { recordIntegrationHealth } from '../lib/integration-health';

// Backfill BrickInsights review ratings for sets whose rating is missing or
// stale (>30 days), prioritized owned/wishlist then retired then oldest, then by
// highest value so marquee sets are rated before the cheap long tail. Stamps
// brickinsights_cached_at on every SUCCESSFUL response (even when the set isn't
// reviewed there) so we don't re-probe missing sets each run; a transport
// failure leaves cached_at untouched so it retries next run. One GET per set;
// the API allows 60/min and ratings move slowly, so a modest daily batch fits.
export async function runBrickInsightsBackfill(env: Env, options: { limit?: number } = {}) {
  if (!brickInsightsEnabled(env)) {
    return { processed: 0, updated: 0, limit: 0, skipped: 'brickinsights disabled' };
  }
  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 400)
    : 50;
  const { results } = await env.DB.prepare(`
    SELECT ls.set_num
    FROM lego_sets ls
    WHERE ls.brickinsights_cached_at IS NULL OR ls.brickinsights_cached_at < datetime('now', '-30 days')
    ORDER BY
      CASE WHEN EXISTS (
        SELECT 1 FROM user_collection uc WHERE uc.set_num = ls.set_num AND uc.deleted_at IS NULL
      ) OR EXISTS (
        SELECT 1 FROM user_wishlist uw WHERE uw.set_num = ls.set_num
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.retired, 0) DESC,
      COALESCE(ls.brickinsights_cached_at, '2000-01-01') ASC,
      COALESCE(ls.blended_value, ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{ set_num: string }>();
  if (!results.length) return { processed: 0, updated: 0, limit };

  let updated = 0;
  let processed = 0;
  const health = { ok: 0, fail: 0, lastError: undefined as string | undefined };
  const stmts: D1PreparedStatement[] = [];
  for (const set of results) {
    processed++;
    try {
      const rating = await fetchBrickInsightsRating(set.set_num, env);
      health.ok++;
      stmts.push(
        env.DB.prepare(
          `UPDATE lego_sets SET brickinsights_rating=?, brickinsights_review_count=?, ` +
          `brickinsights_url=?, brickinsights_cached_at=datetime('now') WHERE set_num=?`,
        ).bind(rating?.rating ?? null, rating?.review_count ?? null, rating?.url ?? null, set.set_num),
      );
      if (rating?.rating != null) updated++;
    } catch (e) {
      // Transport/HTTP failure — leave cached_at so it retries next run.
      health.fail++;
      health.lastError = (e as Error)?.message || String(e);
    }
  }
  for (let i = 0; i < stmts.length; i += 90) {
    await env.DB.batch(stmts.slice(i, i + 90));
  }
  await recordIntegrationHealth(env, 'brickinsights', health);
  return { processed, updated, limit };
}
