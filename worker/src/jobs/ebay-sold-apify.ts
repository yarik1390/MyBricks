import type { Env } from '../types';
import { fetchEbaySoldViaApifyBatch } from '../lib/ebay-apify';
import { apifyEnabled } from '../lib/pricing-flags';
import { reserveQuota } from '../lib/api-quota';
import { recomputeBlendedValues } from '../lib/market-sources';
import { recordPricingWrites } from '../lib/pricing-budget';
import { sourceEnabled } from '../lib/source-config';

const APIFY_MAX_SETS_PER_RUN = 20;

export interface EbaySoldApifyRun {
  [key: string]: unknown;
  processed: number;
  updated: number;
  rejected: number;
  limit: number;
  newUpdated?: number;
  usedUpdated?: number;
  skipped?: string;
  engine?: 'apify';
}

/**
 * Weekly corroborating eBay sold-comps lane backed by one batched Apify actor run.
 * It deliberately writes the existing eBay observation columns and attempt markers,
 * so no schema migration or new blend family is needed.
 */
export async function runEbaySoldApifyScrape(
  env: Env,
  options: { limit?: number } = {},
): Promise<EbaySoldApifyRun> {
  if (!(await sourceEnabled(env, 'ebay'))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'ebay disabled in source tuning' };
  }
  if (!(apifyEnabled(env) && await sourceEnabled(env, 'apify'))) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'apify not configured' };
  }

  const requestedLimit = Number(options.limit);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), APIFY_MAX_SETS_PER_RUN)
    : APIFY_MAX_SETS_PER_RUN;

  const { results: candidates } = await env.DB.prepare(`
    SELECT ls.set_num, ls.bl_new_value, ls.used_value, ls.current_value,
      1 AS new_due,
      0 AS used_due
    FROM lego_sets ls
    LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num
    WHERE (ls.bl_new_value IS NOT NULL OR ls.valuation_method = 'brickeconomy')
      AND (ls.ebay_new_cached_at IS NULL OR ls.ebay_new_cached_at < datetime('now', '-30 days'))
      AND (ext.ebay_sold_attempted_at IS NULL OR ext.ebay_sold_attempted_at < datetime('now', '-14 days'))
    ORDER BY
      CASE WHEN ls.set_num IN (
        SELECT set_num FROM user_collection WHERE deleted_at IS NULL
        UNION SELECT set_num FROM user_wishlist
      ) THEN 0 ELSE 1 END,
      COALESCE(ls.bl_new_value, ls.current_value) DESC,
      ls.set_num ASC
    LIMIT ?
  `).bind(limit).all<{
    set_num: string;
    bl_new_value: number | null;
    used_value: number | null;
    current_value: number | null;
    new_due: number;
    used_due: number;
  }>();

  if (!candidates.length) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, engine: 'apify' };
  }

  // One unit is one set/search-chain in the daily ledger. Reserve only after the
  // candidate query so an empty weekly sweep cannot consume quota.
  const grants = await reserveQuota(env, { apify: candidates.length });
  const granted = Math.floor(grants.apify || 0);
  if (granted <= 0) {
    return { processed: 0, updated: 0, rejected: 0, limit: 0, skipped: 'apify daily ceiling reached' };
  }
  const selected = candidates.slice(0, granted);
  const fetched = await fetchEbaySoldViaApifyBatch(selected.map((set) => set.set_num), env);

  let processed = 0;
  let updated = 0;
  let newUpdated = 0;
  let usedUpdated = 0;
  let rejected = 0;
  const stmts: D1PreparedStatement[] = [];
  const touched: string[] = [];

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

  for (const set of selected) {
    processed++;
    const result = fetched[set.set_num] || {
      status: 'error' as const,
      new_value: null,
      new_count: 0,
      used_value: null,
      used_count: 0,
      error: 'Apify batch omitted set result',
    };

    const addAnomaly = (condition: 'new_sealed' | 'used_complete', observed: number, reference: number | null) => {
      const key = condition === 'new_sealed'
        ? `ebay_sold:${set.set_num}:value_divergence`
        : `ebay_sold_used:${set.set_num}:value_divergence`;
      stmts.push(env.DB.prepare(`
        INSERT INTO pricing_anomalies (
          anomaly_key, set_num, condition, source, anomaly_type, severity,
          detail_json, status, first_seen_at, last_seen_at
        ) VALUES (?1, ?2, ?3, 'ebay_sold', 'value_divergence', 'warning', ?4, 'open', datetime('now'), datetime('now'))
        ON CONFLICT(anomaly_key) DO UPDATE SET
          detail_json=excluded.detail_json, status='open', last_seen_at=datetime('now'), resolved_at=NULL
      `).bind(key, set.set_num, condition, JSON.stringify({ observed, reference, engine: 'apify' })));
    };

    let acceptedNew: number | null = null;
    let acceptedUsed: number | null = null;
    if (set.new_due) {
      if (result.new_value != null) {
        const reference = set.bl_new_value ?? set.current_value ?? null;
        if (reference == null || (result.new_value >= reference / 3 && result.new_value <= reference * 3)) {
          acceptedNew = result.new_value;
          newUpdated++;
        } else {
          rejected++;
          stampNewAttempt(set.set_num);
          addAnomaly('new_sealed', result.new_value, reference);
        }
      } else {
        stampNewAttempt(set.set_num);
      }
    }

    if (set.used_due) {
      if (result.used_value != null) {
        const reference = set.used_value ?? set.bl_new_value ?? set.current_value ?? null;
        if (reference == null || (result.used_value >= reference / 3 && result.used_value <= reference * 3)) {
          acceptedUsed = result.used_value;
          usedUpdated++;
        } else {
          rejected++;
          stampUsedAttempt(set.set_num);
          addAnomaly('used_complete', result.used_value, reference);
        }
      } else {
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
        acceptedNew, result.new_count || 0, result.new_last_sold ?? null,
        acceptedUsed, result.used_count || 0, result.used_last_sold ?? null,
        set.set_num,
      ));
      touched.push(set.set_num);
      updated++;
    }
  }

  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  await recordPricingWrites(env.DB, 'ebay-sold-apify', stmts.length);
  if (touched.length) await recomputeBlendedValues(env.DB, touched);

  return {
    processed,
    updated,
    newUpdated,
    usedUpdated,
    rejected,
    limit: selected.length,
    engine: 'apify',
  };
}
