import type { Env } from '../types';
import { pricingWritesAllowed, recordPricingWrites } from '../lib/pricing-budget';

// First-party community comps — the one price source nobody can scrape away.
//
// Collectors already record what they PAID (user_collection.purchase_price)
// and, since the sold-logging release, what they SOLD for (sold_price). This
// nightly job aggregates those real transactions into per-set, per-condition
// medians in community_comps, and mirrors each published aggregate into
// pricing_signals as the verified 'community' sold family — the blend picks it
// up automatically the moment enough collectors have priced a set.
// Privacy and integrity rules:
//   - k-anonymity: a row is published only when >= 5 DISTINCT users contributed.
//   - Only aggregates are stored — never per-user prices.
//   - 3x outlier trim vs the set's blended/current value (typo & lot protection);
//     when the set has no reference value the raw spread stands (median is
//     robust and the k-gate already requires 5 independent people).
//   - 365-day window so old retail prices age out of a retiring set's comps.

const WINDOW_DAYS = 365;
const MIN_CONTRIBUTORS = 5;

const median = (sorted: number[]): number => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
const round2 = (n: number): number => Math.round(n * 100) / 100;

export async function runCommunityComps(env: Env) {
  if (!(await pricingWritesAllowed(env.DB))) {
    return { published: 0, candidates: 0, skipped: 'pricing write budget exhausted' };
  }

  // Purchases AND sales are both real transactions; soft-deleted rows still
  // count (a sold set's purchase happened). Condition buckets mirror v3.
  const { results } = await env.DB.prepare(`
    SELECT t.set_num, t.bucket, t.user_id, t.price,
           COALESCE(NULLIF(s.blended_value, 0), s.current_value) AS ref
    FROM (
      SELECT set_num, user_id, purchase_price AS price,
             CASE WHEN condition IN ('new','sealed') THEN 'new_sealed' ELSE 'used_complete' END AS bucket
      FROM user_collection
      WHERE purchase_price > 0
        AND purchased_at IS NOT NULL AND purchased_at >= date('now', ?1)
      UNION ALL
      SELECT set_num, user_id, sold_price AS price,
             CASE WHEN condition IN ('new','sealed') THEN 'new_sealed' ELSE 'used_complete' END AS bucket
      FROM user_collection
      WHERE sold_price > 0
        AND sold_at IS NOT NULL AND sold_at >= date('now', ?1)
    ) t
    JOIN lego_sets s ON s.set_num = t.set_num
  `).bind(`-${WINDOW_DAYS} days`)
    .all<{ set_num: string; bucket: 'new_sealed' | 'used_complete'; user_id: string; price: number; ref: number | null }>();

  const groups = new Map<string, { set_num: string; bucket: string; prices: number[]; users: Set<string> }>();
  for (const row of results) {
    // Outlier trim: a price wildly off the set's known value is a typo or a
    // bundle/lot, not a comp.
    const ref = Number(row.ref);
    if (Number.isFinite(ref) && ref > 0 && (row.price < ref / 3 || row.price > ref * 3)) continue;
    const key = `${row.set_num}|${row.bucket}`;
    const g = groups.get(key) ?? { set_num: row.set_num, bucket: row.bucket, prices: [], users: new Set<string>() };
    g.prices.push(row.price);
    g.users.add(row.user_id);
    groups.set(key, g);
  }

  const stmts: D1PreparedStatement[] = [];
  for (const g of groups.values()) {
    if (g.users.size < MIN_CONTRIBUTORS) continue;
    const sorted = [...g.prices].sort((a, b) => a - b);
    const med = round2(median(sorted));
    const p25 = round2(percentile(sorted, 0.25));
    const p75 = round2(percentile(sorted, 0.75));
    stmts.push(env.DB.prepare(`
      INSERT INTO community_comps (set_num, condition, median, p25, p75, sample_count, contributor_count, window_days, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
      ON CONFLICT(set_num, condition) DO UPDATE SET
        median=excluded.median, p25=excluded.p25, p75=excluded.p75,
        sample_count=excluded.sample_count, contributor_count=excluded.contributor_count,
        window_days=excluded.window_days, updated_at=datetime('now')
    `).bind(
      g.set_num, g.bucket, med, p25, p75,
      sorted.length, g.users.size, WINDOW_DAYS,
    ));
    // Mirror into pricing_signals so the 'community' provider family joins the
    // v3 blend automatically (loadNormalizedSignals reads verified rows — no
    // read-path change needed). Identity is inherent: collectors record
    // against exact catalog set numbers, and the k-gate + outlier trim above
    // are the quality bar.
    stmts.push(env.DB.prepare(`
      INSERT INTO pricing_signals (
        set_num, source, provider_family, condition, signal_type, currency,
        value, low, high, sample_count, checked_at, source_observed_at, match_status
      ) VALUES (?1, 'community_comps', 'community', ?2, 'sold', 'USD', ?3, ?4, ?5, ?6, datetime('now'), datetime('now'), 'verified')
      ON CONFLICT(set_num, source, condition) DO UPDATE SET
        value=excluded.value, low=excluded.low, high=excluded.high,
        sample_count=excluded.sample_count, checked_at=datetime('now'),
        source_observed_at=datetime('now'), match_status='verified'
    `).bind(g.set_num, g.bucket, med, p25, p75, sorted.length));
  }
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));

  // Rows that fell below the k-gate (contributors churned out of the window)
  // must disappear rather than go stale — an unpublishable aggregate is not
  // "last known good", it's a privacy/staleness liability. Every still-valid
  // row was upserted with updated_at=now above, so anything older than 2 days
  // is by definition no longer publishable (param-free, no D1 bind limits).
  const del = await env.DB.prepare(
    `DELETE FROM community_comps WHERE updated_at < datetime('now', '-2 days')`,
  ).run().catch(() => null);
  const pruned = Number(del?.meta?.changes || 0);
  // The blend mirror follows the same rule: an aggregate that is no longer
  // publishable must stop influencing valuations too.
  await env.DB.prepare(
    `DELETE FROM pricing_signals WHERE source='community_comps' AND checked_at < datetime('now', '-2 days')`,
  ).run().catch(() => {});

  await recordPricingWrites(env.DB, 'community-comps', stmts.length + pruned);
  return { published: stmts.length / 2, pruned, candidates: groups.size };
}
