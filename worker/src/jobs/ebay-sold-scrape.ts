import type { Env } from '../types';
import { fetchEbaySoldViaFirecrawl, type EbaySoldScrapeResult } from '../lib/ebay-firecrawl';
import { firecrawlEnabled } from '../lib/pricing-flags';
import { FIRECRAWL_MAX_CONCURRENCY } from '../lib/firecrawl';
import { quotaRemaining } from '../lib/api-quota';
import { recomputeBlendedValues } from '../lib/market-sources';
import { recordPricingWrites } from '../lib/pricing-budget';
import { ebaySoldLaneEnabled, sourceEnabled } from '../lib/source-config';
import {
  assessSoldObservation,
  observationStatements,
  pruneObservationStatement,
  selectEbaySoldReference,
  type EbaySoldAssessment,
  type EbaySoldCondition,
  type EbaySoldReference,
} from '../lib/ebay-sold-observations';

/**
 * Corroborating-only eBay-sold scrape (Firecrawl).
 *
 * Only targets sets that ALREADY have a BrickLink (or BrickEconomy) value, and
 * only accepts a scraped median that is within 3x of that existing value. So the
 * eBay-sold figure is always cross-checked and can never become a noisy SOLE
 * source — the collision-prone long-tail failure found in Phase-0 validation
 * (e.g. Darth Maul) is structurally excluded (no BrickLink/BE -> not a candidate).
 * Writes condition-separated ebay_new_value and ebay_used_value observations so
 * the v3 blend can corroborate sealed and used values independently.
 *
 * PROVIDER: Firecrawl, and only Firecrawl. Bright Data used to be primary here
 * with a Firecrawl rescue behind a circuit breaker, but it could not reach eBay
 * sold search at all — no answer at 90s synchronously, still pending after
 * hours asynchronously, on a healthy token — so the breaker sat permanently
 * open and every tick spent a call on a probe that never recovered. Removing it
 * deletes the breaker, the half-open canary and the rescue path with it.
 *
 * ANTI-STALL: a miss stamps condition-specific set_market_ext attempt markers
 * (14-day cooldown, SQL-visible) instead of a KV neg-cache the candidate query
 * couldn't see, so neither sweep can wall itself or starve the other condition.
 */
// Max sets per run when Firecrawl is the primary engine. Sized to WALL CLOCK,
// not to appetite: the plan allows 2 concurrent scrapes at ~30s each, so 16 sets
// ≈ 8 waves ≈ 4 min — the same budget the old 40/5-concurrent figure bought
// before the concurrency cap below dropped 5 → 2. Raising this without raising
// the plan's concurrency just makes a run that gets killed before it flushes.
const FIRECRAWL_PRIMARY_MAX = 16;

export interface EbaySoldScrapeRun {
  // Index signature: the admin /jobs/:job handler hands run summaries around as
  // Record<string, unknown> before serialising them.
  [key: string]: unknown;
  processed: number;
  updated: number;
  rejected: number;
  limit: number;
  skipped?: string;
  newUpdated?: number;
  usedUpdated?: number;
  /** Which scraper ran this batch. Only Firecrawl remains. */
  engine?: 'firecrawl';
}

export async function runEbaySoldScrape(
  env: Env,
  options: { limit?: number; concurrency?: number; preferFirecrawl?: boolean } = {},
): Promise<EbaySoldScrapeRun> {
  if (!(await sourceEnabled(env, 'ebay'))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'ebay disabled in source tuning' };
  }
  // Compliance hold: scraping eBay sold-search stays blocked until provider
  // authorization is documented — independent of the master eBay switch.
  if (!ebaySoldLaneEnabled(env)) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'ebay sold-comps lane held pending provider authorization' };
  }
  if (!(firecrawlEnabled(env) && await sourceEnabled(env, 'firecrawl'))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'firecrawl not configured' };
  }

  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), 200)
    : 20;
  // Firecrawl is metered by its own per-scrape guard (5cr/json extract) inside
  // firecrawlScrape, so size to remaining daily credits WITHOUT reserving — a
  // double reservation here would make the admin Firecrawl credits panel
  // over-report.
  const remaining = await quotaRemaining(env, 'firecrawl');
  if (remaining < 5) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'firecrawl daily ceiling reached' };
  // A Firecrawl scrape is ~20-40s, so cap the wave count to keep the run inside
  // its tick — that is how runs used to get killed before they could flush.
  const capLimit = Math.min(limit, FIRECRAWL_PRIMARY_MAX, Math.floor(remaining / 5));

  // New and used have independent success freshness and miss cooldowns. A miss
  // only stamps set_market_ext; it never stamps either blend-facing cached_at
  // column. This lets one scrape fill the much broader used market without an
  // absent condition masquerading as fresh evidence.
  const { results: candidates } = await env.DB.prepare(`
    SELECT ls.set_num, ls.name, ls.bl_new_value, ls.bl_used_qty, ls.used_value,
      ls.be_value_new, ls.be_value_used, ls.bl_cached_at, ls.be_cached_at,
      ls.current_value, ls.cached_at, ls.valuation_method,
      CASE WHEN (ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-30 days'))
        AND (ext.ebay_sold_attempted_at IS NULL OR ext.ebay_sold_attempted_at < datetime('now', '-14 days'))
        THEN 1 ELSE 0 END AS new_due,
      CASE WHEN (ls.ebay_used_cached_at IS NULL OR ls.ebay_used_cached_at < datetime('now', '-30 days'))
        AND (ext.ebay_used_attempted_at IS NULL OR ext.ebay_used_attempted_at < datetime('now', '-14 days'))
        THEN 1 ELSE 0 END AS used_due
    FROM lego_sets ls
    LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE (ls.bl_new_value IS NOT NULL OR ls.used_value IS NOT NULL OR ls.valuation_method = 'brickeconomy')
      AND (
        ((ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-30 days'))
          AND (ext.ebay_sold_attempted_at IS NULL OR ext.ebay_sold_attempted_at < datetime('now', '-14 days')))
        OR
        ((ls.ebay_used_cached_at IS NULL OR ls.ebay_used_cached_at < datetime('now', '-30 days'))
          AND (ext.ebay_used_attempted_at IS NULL OR ext.ebay_used_attempted_at < datetime('now', '-14 days')))
      )
    ORDER BY
      -- Uncorrelated IN rather than two correlated EXISTS: one materialized
      -- subquery instead of two lookups per candidate row. Same result set.
      CASE WHEN ls.set_num IN (
        SELECT set_num FROM user_collection WHERE deleted_at IS NULL
        UNION SELECT set_num FROM user_wishlist
      ) THEN 0 ELSE 1 END,
      -- HIGHEST-VALUE first: eBay sold listings exist for desirable sets; ordering by
      -- set_num front-loaded low-numbered vintage sets with no sold activity, wasting
      -- the scrape (Firecrawl credits) on guaranteed no-data misses.
      COALESCE(ls.bl_new_value, ls.current_value) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(capLimit).all<{
    set_num: string;
    name: string;
    bl_new_value: number | null;
    bl_used_qty: number | null;
    used_value: number | null;
    be_value_new: number | null;
    be_value_used: number | null;
    bl_cached_at: string | null;
    be_cached_at: string | null;
    current_value: number | null;
    cached_at: string | null;
    valuation_method: string | null;
    new_due: number;
    used_due: number;
  }>();
  if (!candidates.length) return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: undefined };

  const results = candidates;
  const effLimit = candidates.length;

  // Plan concurrency is account-wide, so it comes from lib/firecrawl.ts rather
  // than being restated here — a local copy is how the other jobs drifted.
  const concurrency = Math.max(1, Math.min(options.concurrency ?? FIRECRAWL_MAX_CONCURRENCY, FIRECRAWL_MAX_CONCURRENCY));
  let updated = 0;
  let newUpdated = 0;
  let usedUpdated = 0;
  let processed = 0;
  let rejected = 0;
  const stmts: D1PreparedStatement[] = [];
  const touched: string[] = [];

  // Stamp the attempt marker on a MISS so the set drops out of the candidate query
  // for 14 days (see the query above). A SQL column — NOT ebay_new_cached_at, which
  // is success-only and feeds the blend — so absent data never looks fresh to the
  // blend while still being skipped by the scrape queue. Batched with the writes.
  const stampNewAttempt = (setNum: string) =>
    stmts.push(env.DB.prepare(
      `INSERT INTO set_market_ext (set_num, ebay_sold_attempted_at) VALUES (?1, datetime('now'))
       ON CONFLICT(set_num) DO UPDATE SET ebay_sold_attempted_at=datetime('now')`,
    ).bind(setNum));
  const stampUsedAttempt = (setNum: string) =>
    stmts.push(env.DB.prepare(
      `INSERT INTO set_market_ext (set_num, ebay_used_attempted_at) VALUES (?1, datetime('now'))
       ON CONFLICT(set_num) DO UPDATE SET ebay_used_attempted_at=datetime('now')`,
    ).bind(setNum));

  // Incremental persistence: flush accumulated writes + re-blend as we go, so a
  // dying invocation (the "stale: invocation ended" cron_runs rows) keeps every
  // completed wave instead of losing the whole run's work.
  const flush = async () => {
    if (!stmts.length && !touched.length) return;
    const s = stmts.splice(0);
    const t = touched.splice(0);
    for (let j = 0; j < s.length; j += 90) await env.DB.batch(s.slice(j, j + 90));
    await recordPricingWrites(env.DB, 'ebay-sold-scrape', s.length);
    if (t.length) await recomputeBlendedValues(env.DB, t);
  };

  for (let i = 0; i < results.length; i += concurrency) {
    const batch = results.slice(i, i + concurrency);
    const outs = await Promise.all(batch.map(async (set) => {
      const fetchOptions = { includeNew: !!set.new_due, includeUsed: !!set.used_due };
      const r: EbaySoldScrapeResult = await fetchEbaySoldViaFirecrawl(set.set_num, set.name, env, fetchOptions)
        .catch((e: unknown): EbaySoldScrapeResult => ({
          status: 'error',
          new_value: null,
          new_count: 0,
          used_value: null,
          used_count: 0,
          error: (e as Error)?.message,
        }));
      return { set, r };
    }));
    for (const { set, r } of outs) {
      processed++;

      const addAnomaly = (
        condition: 'new_sealed' | 'used_complete',
        observed: number,
        reference: EbaySoldReference,
        assessment: EbaySoldAssessment,
      ) => {
        const key = condition === 'new_sealed'
          ? `ebay_sold:${set.set_num}:value_divergence`
          : `ebay_sold_used:${set.set_num}:value_divergence`;
        stmts.push(env.DB.prepare(`
          INSERT INTO pricing_anomalies (
            anomaly_key, set_num, condition, source, anomaly_type, severity,
            detail_json, status, first_seen_at, last_seen_at
          ) VALUES (?1, ?2, ?3, 'ebay_sold', ?4, 'warning', ?5, 'open', datetime('now'), datetime('now'))
          ON CONFLICT(anomaly_key) DO UPDATE SET
            detail_json=excluded.detail_json, status='open', last_seen_at=datetime('now'), resolved_at=NULL
        `).bind(
          key, set.set_num, condition,
          assessment.decision === 'review_needed' ? 'reference_review' : 'value_divergence',
          JSON.stringify({
            observed,
            reference: reference.value,
            reference_provenance: reference.provenance,
            reference_freshness: reference.freshness,
            decision: assessment.decision,
            rejection_reason: assessment.rejectionReason,
            engine: 'firecrawl',
          }),
        ));
      };

      const recordCondition = (
        condition: Exclude<EbaySoldCondition, 'unknown'>,
        observed: number | null,
        assessment: EbaySoldAssessment,
        reference: EbaySoldReference,
      ) => {
        stmts.push(...observationStatements(env.DB, {
          setNum: set.set_num,
          engine: 'firecrawl',
          observedAt: r.observed_at || new Date().toISOString(),
          evidence: (r.evidence || []).filter((row) =>
            row.condition === condition || (row.condition === 'unknown' && (condition === 'new_sealed' || !set.new_due)),
          ),
          condition,
          assessment,
          reference,
        }));
        if (observed != null && assessment.decision !== 'accepted') addAnomaly(condition, observed, reference, assessment);
      };

      let acceptedNew: number | null = null;
      let acceptedUsed: number | null = null;
      if (set.new_due) {
        const reference = selectEbaySoldReference(set as unknown as Record<string, unknown>, 'new_sealed');
        const assessment: EbaySoldAssessment = r.new_value != null
          ? assessSoldObservation(r.new_value, reference)
          : { decision: r.status === 'error' ? 'error' : 'no_data', rejectionReason: r.error || (r.status === 'error' ? 'provider_error' : 'no_matching_listings') };
        recordCondition('new_sealed', r.new_value, assessment, reference);
        if (r.new_value != null && assessment.decision === 'accepted') {
          acceptedNew = r.new_value;
          newUpdated++;
        } else {
          if (r.new_value != null) rejected++;
          stampNewAttempt(set.set_num);
        }
      }

      if (set.used_due) {
        const reference = selectEbaySoldReference(set as unknown as Record<string, unknown>, 'used_complete');
        const assessment: EbaySoldAssessment = r.used_value != null
          ? assessSoldObservation(r.used_value, reference)
          : { decision: r.status === 'error' ? 'error' : 'no_data', rejectionReason: r.error || (r.status === 'error' ? 'provider_error' : 'no_matching_listings') };
        recordCondition('used_complete', r.used_value ?? null, assessment, reference);
        if (r.used_value != null && assessment.decision === 'accepted') {
          acceptedUsed = r.used_value;
          usedUpdated++;
        } else {
          if (r.used_value != null) rejected++;
          stampUsedAttempt(set.set_num);
        }
      }

      if (acceptedNew != null || acceptedUsed != null) {
        stmts.push(env.DB.prepare(`
          UPDATE lego_sets SET
            ebay_new_value=COALESCE(?1, ebay_new_value),
            ebay_new_qty=CASE WHEN ?1 IS NULL THEN ebay_new_qty ELSE ?2 END,
            ebay_new_cached_at=CASE WHEN ?1 IS NULL THEN ebay_new_cached_at ELSE datetime('now') END,
            ebay_new_last_sold=CASE WHEN ?1 IS NULL THEN ebay_new_last_sold ELSE COALESCE(?3, ebay_new_last_sold) END,
            ebay_used_value=COALESCE(?4, ebay_used_value),
            ebay_used_qty=CASE WHEN ?4 IS NULL THEN ebay_used_qty ELSE ?5 END,
            ebay_used_cached_at=CASE WHEN ?4 IS NULL THEN ebay_used_cached_at ELSE datetime('now') END,
            ebay_used_last_sold=CASE WHEN ?4 IS NULL THEN ebay_used_last_sold ELSE COALESCE(?6, ebay_used_last_sold) END
          WHERE set_num=?7
        `).bind(
          acceptedNew, r.new_count || 0, r.new_last_sold ?? null,
          acceptedUsed, r.used_count || 0, r.used_last_sold ?? null,
          set.set_num,
        ));
        touched.push(set.set_num);
        updated++;
      }
    }
    if (stmts.length >= 90) await flush();
  }

  await flush();
  const prune = pruneObservationStatement(env.DB);
  const pruneResult = await prune.run();
  await recordPricingWrites(env.DB, 'ebay-sold-scrape', pruneResult.meta.changes || 0);
  return {
    processed, updated, newUpdated, usedUpdated, rejected, limit: effLimit,
    engine: 'firecrawl',
  };
}
