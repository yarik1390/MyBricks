import type { Env } from '../types';
import { fetchBrickPickerBatch } from '../lib/brickpicker';
import { spendQuotaFailClosed } from '../lib/api-quota';
import { getSourceConfig } from '../lib/source-config';
import { recordIntegrationHealth } from '../lib/integration-health';
import { recomputeBlendedValues } from '../lib/market-sources';

const MAX_BATCH = 100;

export interface BrickPickerEnrichResult {
  requested: number;
  updated: number;
  misses: number;
  rejected: number;
  limit: number;
  skipped?: string;
  [key: string]: unknown;
}

/**
 * Scheduled-only BrickPicker refresh. Selection is demand-first and excludes
 * fresh successes and negative-cache cooldowns before any external request.
 * Public activation requires BOTH the secret and admin source-config enablement;
 * the code default is shadow-disabled.
 */
export async function runBrickPickerEnrich(
  env: Env,
  options: { limit?: number } = {},
): Promise<BrickPickerEnrichResult> {
  const empty = (limit: number, skipped?: string): BrickPickerEnrichResult => ({ requested: 0, updated: 0, misses: 0, rejected: 0, limit, skipped });
  if (!env.BRICKPICKER_API_KEY?.trim()) return empty(0, 'BRICKPICKER_API_KEY not set');

  const config = await getSourceConfig(env);
  if (!config.brickpicker.enabled) return empty(0, 'BrickPicker disabled in admin source tuning (shadow default)');
  const refreshDays = Math.max(1, Math.round(config.brickpicker.refreshDays ?? 14));
  const requested = Number(options.limit);
  const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), MAX_BATCH) : MAX_BATCH;

  const { results: candidates } = await env.DB.prepare(`
    SELECT ls.set_num
    FROM lego_sets ls
    LEFT JOIN pricing_source_map pm
      ON pm.source='brickpicker' AND pm.set_num=ls.set_num
    LEFT JOIN pricing_signals ps
      ON ps.set_num=ls.set_num AND ps.source='brickpicker' AND ps.condition='new_sealed'
    WHERE ls.set_num GLOB '*-1'
      AND substr(ls.set_num, 1, length(ls.set_num)-2) NOT GLOB '*[^0-9]*'
      AND (pm.status IS NULL OR pm.status != 'not_found' OR pm.updated_at < datetime('now', '-30 days'))
      AND (
        ps.checked_at IS NULL
        OR ps.checked_at < datetime(
          'now',
          CASE
            WHEN ls.set_num IN (
              SELECT set_num FROM user_collection WHERE deleted_at IS NULL
              UNION SELECT set_num FROM user_wishlist
            )
            THEN '-1 day'
            ELSE ?1
          END
        )
      )
    ORDER BY
      CASE
        WHEN ls.set_num IN (
          SELECT set_num FROM user_collection WHERE deleted_at IS NULL
          UNION SELECT set_num FROM user_wishlist
        ) THEN 0
        ELSE 1
      END,
      COALESCE(ps.checked_at, '1970-01-01') ASC,
      COALESCE(ls.blended_value, ls.current_value, 0) DESC,
      ls.set_num ASC
    LIMIT ?2
  `).bind(`-${refreshDays} days`, limit).all<{ set_num: string }>();
  const setNums = candidates.map((row) => row.set_num);
  if (!setNums.length) return empty(limit, 'No stale eligible sets');

  // Atomic fail-closed charge for every requested item, including misses.
  // A guarded update makes overlapping invocations deterministic: at most one
  // can consume the final units and proceed with its outbound request.
  const reserved = await spendQuotaFailClosed(env, 'brickpicker', setNums.length);
  if (!reserved) return empty(limit, 'BrickPicker daily quota cannot cover selected batch');

  const health = { ok: 0, fail: 0, lastError: null as string | null };
  try {
    const batch = await fetchBrickPickerBatch(setNums, env.BRICKPICKER_API_KEY);
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];

    for (const result of batch.results) {
      for (const signal of result.signals) {
        statements.push(env.DB.prepare(`
          INSERT INTO pricing_signals (
            set_num, source, source_item_id, provider_family, condition, signal_type,
            currency, value, low, high, sample_count, sales_volume, source_observed_at,
            checked_at, match_status, flags_json, updated_at
          ) VALUES (?1, 'brickpicker', ?2, 'ebay_market', ?3, 'modeled', 'USD', ?4, ?5, ?6, NULL, NULL, ?7, ?8, 'verified', ?9, ?8)
          ON CONFLICT(set_num, source, condition) DO UPDATE SET
            source_item_id=excluded.source_item_id, provider_family=excluded.provider_family,
            signal_type=excluded.signal_type, currency=excluded.currency, value=excluded.value,
            low=excluded.low, high=excluded.high, sample_count=NULL, sales_volume=NULL,
            source_observed_at=excluded.source_observed_at, checked_at=excluded.checked_at,
            match_status='verified', flags_json=excluded.flags_json, updated_at=excluded.updated_at
        `).bind(
          result.setNum, result.sourceItemId, signal.condition, signal.value,
          signal.low ?? null, signal.high ?? null, result.calculatedAt, now,
          JSON.stringify(signal.flags ?? []),
        ));
      }
      statements.push(env.DB.prepare(`
        INSERT INTO pricing_source_map (source, source_item_id, set_num, source_title, match_method, match_confidence, status, verified_at, updated_at)
        VALUES ('brickpicker', ?1, ?2, ?3, 'exact_set_num', 1.0, 'verified', ?4, ?4)
        ON CONFLICT(source, source_item_id) DO UPDATE SET
          set_num=excluded.set_num, source_title=excluded.source_title,
          status='verified', verified_at=excluded.verified_at, updated_at=excluded.updated_at
      `).bind(result.sourceItemId, result.setNum, result.title, now));
    }

    const missSet = new Set(batch.misses);
    for (const setNum of missSet) {
      const baseId = setNum.replace(/-1$/, '');
      statements.push(env.DB.prepare(`
        INSERT INTO pricing_source_map (source, source_item_id, set_num, match_method, match_confidence, status, updated_at)
        VALUES ('brickpicker', ?1, ?2, 'exact_set_num', 0, 'not_found', ?3)
        ON CONFLICT(source, source_item_id) DO UPDATE SET
          set_num=excluded.set_num, status='not_found', updated_at=excluded.updated_at
      `).bind(baseId, setNum, now));
    }
    for (let i = 0; i < statements.length; i += 90) await env.DB.batch(statements.slice(i, i + 90));

    const updatedSetNums = batch.results.map((r) => r.setNum);
    if (updatedSetNums.length) await recomputeBlendedValues(env.DB, updatedSetNums);
    health.ok = batch.results.length;
    health.fail = batch.rejected.length;
    if (batch.rejected.length) health.lastError = `${batch.rejected.length} rejected response rows`;
    await recordIntegrationHealth(env, 'brickpicker', health);
    return {
      requested: setNums.length,
      updated: batch.results.length,
      misses: batch.misses.length,
      rejected: batch.rejected.length,
      limit,
    };
  } catch (error: any) {
    health.fail = setNums.length;
    health.lastError = String(error?.message || error || 'BrickPicker enrich failed');
    await recordIntegrationHealth(env, 'brickpicker', health);
    throw error;
  }
}

