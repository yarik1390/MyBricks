import type { Env } from '../types';
import { setSourceWeightMultipliers } from './market-sources';
import { setQuotaCapOverrides } from './api-quota';
import { applyFeatureFlags } from './feature-flags';

// ---------------------------------------------------------------------------
// Admin source-tuning config. One DB-backed row (app_settings['source_config'])
// holds per-source operational knobs the admin can tune from the console:
//   enabled     — kill switch (crons skip a disabled source)
//   weight      — blend trust multiplier (1.0 = unchanged; 0 = excluded)
//   dailyCap    — daily external-API budget (overrides QUOTA_CAPS)
//   refreshDays — how stale before a source re-fetches a set
//
// Reads ALWAYS fall back to DEFAULT_SOURCE_CONFIG (= current code behavior), so a
// missing/corrupt row can never break pricing. A short per-isolate memo keeps
// crons from re-reading the row on every call.
// ---------------------------------------------------------------------------

export interface SourceTuning {
  enabled: boolean;
  weight: number;       // blend multiplier (0–3), 1.0 = default
  dailyCap: number | null;
  refreshDays: number | null;
}

export type SourceName =
  | 'bricklink' | 'ebay' | 'brickeconomy' | 'brickowl'
  | 'pricecharting' | 'pricesapi' | 'firecrawl' | 'brightdata' | 'amazon';

export const DEFAULT_SOURCE_CONFIG: Record<SourceName, SourceTuning> = {
  bricklink:     { enabled: true,  weight: 1.0,  dailyCap: 4000, refreshDays: 14 },
  ebay:          { enabled: true,  weight: 1.0,  dailyCap: 4000, refreshDays: 14 },
  brickeconomy:  { enabled: true,  weight: 1.0,  dailyCap: 80,   refreshDays: 14 },
  brickowl:      { enabled: true,  weight: 1.0,  dailyCap: 1500, refreshDays: 14 },
  // Quarantined until every product mapping is identity-verified. PriceCharting
  // is part of the ebay_market family and never independently raises confidence.
  pricecharting: { enabled: false, weight: 0,    dailyCap: 0,    refreshDays: 14 },
  pricesapi:     { enabled: false, weight: 1.0,  dailyCap: 60,   refreshDays: 7 },
  firecrawl:     { enabled: true,  weight: 1.0,  dailyCap: 2000, refreshDays: 14 },
  brightdata:    { enabled: true,  weight: 1.0,  dailyCap: 150,  refreshDays: 14 },
  // Amazon Creators API retail offers (ephemeral KV only, never a valuation
  // input — weight is 0 by design and must stay 0 per Associates terms).
  amazon:        { enabled: true,  weight: 0,    dailyCap: 300,  refreshDays: 1 },
};

const SETTINGS_KEY = 'source_config';
const MEMO_TTL_MS = 60_000;

let memo: Record<SourceName, SourceTuning> | null = null;
let memoAt = 0;

const clampWeight = (n: unknown, dflt: number): number => {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 3) : dflt;
};
const clampInt = (n: unknown, dflt: number | null): number | null => {
  if (n === null) return null;
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : dflt;
};

function mergeOne(name: SourceName, stored: Partial<SourceTuning> | undefined): SourceTuning {
  const d = DEFAULT_SOURCE_CONFIG[name];
  if (!stored || typeof stored !== 'object') return { ...d };
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : d.enabled,
    weight: clampWeight(stored.weight, d.weight),
    dailyCap: 'dailyCap' in stored ? clampInt(stored.dailyCap, d.dailyCap) : d.dailyCap,
    refreshDays: 'refreshDays' in stored ? clampInt(stored.refreshDays, d.refreshDays) : d.refreshDays,
  };
}

function merge(stored: Record<string, Partial<SourceTuning>> | null): Record<SourceName, SourceTuning> {
  const out = {} as Record<SourceName, SourceTuning>;
  for (const name of Object.keys(DEFAULT_SOURCE_CONFIG) as SourceName[]) {
    out[name] = mergeOne(name, stored?.[name]);
  }
  return out;
}

/** Effective source config (defaults deep-merged with the stored overrides).
 *  Fail-open: returns defaults on any error. Memoized per isolate for 60s. */
export async function getSourceConfig(env: Env): Promise<Record<SourceName, SourceTuning>> {
  if (memo && Date.now() - memoAt < MEMO_TTL_MS) return memo;
  let stored: Record<string, Partial<SourceTuning>> | null = null;
  try {
    const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key=?`).bind(SETTINGS_KEY).first<{ value: string }>();
    if (row?.value) stored = JSON.parse(row.value);
  } catch { /* defaults */ }
  memo = merge(stored);
  if (!/^(1|true|yes|on)$/i.test(String(env.PRICECHARTING_VERIFIED_ENABLED || ''))) {
    memo.pricecharting = { ...memo.pricecharting, enabled: false, weight: 0, dailyCap: 0 };
  }
  memoAt = Date.now();
  return memo;
}

/** Apply the config's blend weights AND daily-cap overrides for this isolate.
 *  Call once at the start of a cron invocation or read request. */
export async function applySourceConfig(env: Env): Promise<void> {
  const cfg = await getSourceConfig(env);
  const mult: Record<string, number> = {};
  const caps: Record<string, number | null> = {};
  for (const [name, t] of Object.entries(cfg)) {
    // `enabled` is a real global kill switch, including read-side blends. Jobs
    // still check sourceEnabled() before external calls, but stale values cannot
    // leak back into a headline while a provider is disabled.
    mult[name] = t.enabled ? t.weight : 0;
    caps[name] = t.dailyCap;
  }
  setSourceWeightMultipliers(mult);
  setQuotaCapOverrides(caps);
  // Load runtime feature-flag overrides for this isolate on the same lifecycle
  // (this runs at the start of every request and every cron invocation).
  await applyFeatureFlags(env).catch(() => {});
}

/** Is a source enabled? Fail-open to the default. */
export async function sourceEnabled(env: Env, name: SourceName): Promise<boolean> {
  const cfg = await getSourceConfig(env);
  return cfg[name]?.enabled ?? DEFAULT_SOURCE_CONFIG[name].enabled;
}

/** Admin write: validate + persist the config and clear the memo. */
export async function saveSourceConfig(env: Env, incoming: unknown): Promise<Record<SourceName, SourceTuning>> {
  const merged = merge((incoming && typeof incoming === 'object' ? incoming : {}) as Record<string, Partial<SourceTuning>>);
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=datetime('now')`,
  ).bind(SETTINGS_KEY, JSON.stringify(merged)).run();
  memo = merged;
  memoAt = Date.now();
  return merged;
}

/** Clear the per-isolate memo (tests / after a write from another path). */
export function clearSourceConfigCache(): void {
  memo = null;
  memoAt = 0;
}
