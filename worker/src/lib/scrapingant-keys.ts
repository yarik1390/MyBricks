import type { Env } from '../types';

// ScrapingAnt's free plan is 10,000 credits/month. Keep a 2% provider-side
// safety margin per configured key; operators may only lower this cap.
const DEFAULT_KEY_CAP = 9800;
const MAX_KEY_CAP = 9800;

export interface PickedScrapingAntKey {
  key: string;
  hash: string;
  index: number;
}

interface KeyRow {
  key_hash: string;
  used: number;
  period_month: string | null;
  exhausted_at: string | null;
  last_used_at?: string | null;
}

function keyCap(env: Env): number {
  const raw = env.SCRAPINGANT_KEY_CAP?.trim();
  if (!raw) return DEFAULT_KEY_CAP;
  const configured = Number(raw);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), MAX_KEY_CAP)
    : DEFAULT_KEY_CAP;
}

function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function configuredScrapingAntKeys(env: Env): string[] {
  const keys = [
    env.SCRAPINGANT_API_KEY ?? '',
    ...(env.SCRAPINGANT_API_KEYS?.split(',') ?? []),
  ].map((key) => key.trim()).filter(Boolean);
  return [...new Set(keys)];
}

export async function hashScrapingAntKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function pickScrapingAntKey(env: Env): Promise<PickedScrapingAntKey | null> {
  const keys = configuredScrapingAntKeys(env);
  if (!keys.length) return null;
  const hashes = await Promise.all(keys.map(hashScrapingAntKey));
  const cap = keyCap(env);
  const placeholders = hashes.map((_, index) => `?${index + 1}`).join(',');
  const result = await env.DB.prepare(
    `SELECT key_hash, used, period_month, exhausted_at FROM scrapingant_keys WHERE key_hash IN (${placeholders})`,
  ).bind(...hashes).all<KeyRow>();

  const month = monthKey();
  const byHash = new Map((result.results ?? []).map((row) => [row.key_hash, row]));
  const candidates = hashes.map((hash, index) => {
    const row = byHash.get(hash);
    const current = row?.period_month === month;
    return {
      key: keys[index],
      hash,
      index,
      used: current ? Number(row?.used ?? 0) : 0,
      exhausted: !!(current && (row?.exhausted_at || Number(row?.used ?? 0) >= cap)),
    };
  }).filter((candidate) => !candidate.exhausted);

  candidates.sort((a, b) => a.used - b.used || a.hash.localeCompare(b.hash));
  const picked = candidates[0];
  return picked ? { key: picked.key, hash: picked.hash, index: picked.index } : null;
}

/** Atomically reserve one monthly credit before making the provider request. */
export async function reserveScrapingAntUnit(
  env: Env,
  picked: PickedScrapingAntKey,
): Promise<boolean> {
  const cap = keyCap(env);
  const month = monthKey();
  const result = await env.DB.prepare(
    `INSERT INTO scrapingant_keys (key_hash, used, cap, period_month, last_used_at, updated_at)
     VALUES (?1, 1, ?2, ?3, datetime('now'), datetime('now'))
     ON CONFLICT(key_hash) DO UPDATE SET
       used = CASE WHEN scrapingant_keys.period_month = ?3 THEN scrapingant_keys.used + 1 ELSE 1 END,
       period_month = ?3,
       cap = ?2,
       exhausted_at = CASE WHEN scrapingant_keys.period_month = ?3 THEN scrapingant_keys.exhausted_at ELSE NULL END,
       last_used_at = datetime('now'), updated_at = datetime('now')
     WHERE scrapingant_keys.period_month != ?3
        OR (scrapingant_keys.used < ?2 AND scrapingant_keys.exhausted_at IS NULL)
     RETURNING used`,
  ).bind(picked.hash, cap, month).first<{ used: number }>();
  return result != null;
}

/** Latch a key as exhausted for the current UTC month after provider 401/429. */
export async function markScrapingAntExhausted(
  env: Env,
  picked: PickedScrapingAntKey,
): Promise<void> {
  const month = monthKey();
  await env.DB.prepare(
    `INSERT INTO scrapingant_keys (key_hash, used, cap, period_month, exhausted_at, updated_at)
     VALUES (?1, 0, ?2, ?3, datetime('now'), datetime('now'))
     ON CONFLICT(key_hash) DO UPDATE SET
       used = CASE WHEN scrapingant_keys.period_month = ?3 THEN scrapingant_keys.used ELSE 0 END,
       cap = ?2, period_month = ?3, exhausted_at = datetime('now'), updated_at = datetime('now')`,
  ).bind(picked.hash, keyCap(env), month).run();
}

export interface ScrapingAntKeyPoolStatus {
  keys_configured: number;
  pooled_remaining: number;
  period_month: string;
  ledger_available: boolean;
  status: 'ok' | 'degraded';
  entries: Array<{
    key_hash: string;
    index: number;
    used: number;
    cap: number;
    remaining: number;
    exhausted: boolean;
    period_month: string;
    last_used_at: string | null;
    usage_unknown?: boolean;
  }>;
}

export async function getScrapingAntKeyPoolStatus(env: Env): Promise<ScrapingAntKeyPoolStatus> {
  const keys = configuredScrapingAntKeys(env);
  const hashes = await Promise.all(keys.map(hashScrapingAntKey));
  const month = monthKey();
  const cap = keyCap(env);
  let rows: KeyRow[] = [];
  let ledgerOk = true;
  try {
    if (hashes.length) {
      const placeholders = hashes.map((_, index) => `?${index + 1}`).join(',');
      rows = (await env.DB.prepare(
        `SELECT key_hash, used, period_month, exhausted_at, last_used_at FROM scrapingant_keys WHERE key_hash IN (${placeholders})`,
      ).bind(...hashes).all<KeyRow>()).results ?? [];
    }
  } catch {
    ledgerOk = false;
  }

  const byHash = new Map(rows.map((row) => [row.key_hash, row]));
  const entries = hashes.map((hash, index) => {
    const row = byHash.get(hash);
    const current = row?.period_month === month;
    const used = current ? Math.max(0, Number(row?.used ?? 0)) : 0;
    const exhausted = !!(current && (row?.exhausted_at || used >= cap));
    return {
      key_hash: hash.slice(0, 12),
      index,
      used: ledgerOk ? used : 0,
      cap,
      remaining: ledgerOk && !exhausted ? Math.max(0, cap - used) : 0,
      exhausted: ledgerOk ? exhausted : true,
      period_month: month,
      last_used_at: current ? row?.last_used_at ?? null : null,
      ...(ledgerOk ? {} : { usage_unknown: true }),
    };
  });
  return {
    keys_configured: keys.length,
    pooled_remaining: entries.reduce((sum, entry) => sum + entry.remaining, 0),
    period_month: month,
    ledger_available: ledgerOk,
    status: ledgerOk ? 'ok' : 'degraded',
    entries,
  };
}
