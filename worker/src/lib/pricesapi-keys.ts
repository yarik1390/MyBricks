import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Rotating-key pool for pricesAPI.io.
//
// Each pricesAPI key carries its own monthly budget (free tier = 1000 calls/mo).
// The shared api_quota ledger is keyed by (service, day) and cannot see
// individual keys, so this module tracks per-key spend in the pricesapi_keys
// table and fails over to the next key when one drains. EVERY helper FAILS OPEN:
// a bookkeeping hiccup must never stop pricing from issuing a call.
//
//   pricesapi_keys(key_hash PK, used, cap, period_month, exhausted_at, ...)
//
// Keys are never stored raw — only their SHA-256 hash — so the table is safe to
// dump in admin diagnostics. The budget resets when period_month rolls over.
// ---------------------------------------------------------------------------

const DEFAULT_KEY_CAP = 1000;

export interface PickedKey {
  key: string;
  hash: string;
}

// Current monthly budget bucket, e.g. "2026-06".
function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

// All configured keys, trimmed and de-duplicated, in a stable order. Reads the
// canonical PRICESAPI_API_KEY(S) plus the PRICE_API_KEY(S) aliases (some
// deployments name the Cloudflare secret PRICE_API_KEYS).
export function configuredKeys(env: Env): string[] {
  const all = [
    env.PRICESAPI_API_KEY ?? '',
    env.PRICE_API_KEY ?? '',
    ...(env.PRICESAPI_API_KEYS?.split(',') ?? []),
    ...(env.PRICE_API_KEYS?.split(',') ?? []),
  ]
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

// True when at least one pricesAPI key is configured (under any accepted name).
export function hasPricesApiKey(env: Env): boolean {
  return configuredKeys(env).length > 0;
}

// SHA-256 hex of a key, for safe storage/identification.
export async function hashKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface KeyRow {
  key_hash: string;
  used: number;
  cap: number;
  period_month: string | null;
  exhausted_at: string | null;
}

// Pick the live key with the most remaining budget this month (lowest used).
// Returns null when every configured key is exhausted/drained for the month.
// Fails open to the first configured key if the ledger read throws.
export async function pickKey(env: Env): Promise<PickedKey | null> {
  const keys = configuredKeys(env);
  if (!keys.length) return null;

  const month = monthKey();
  const byHash = new Map<string, string>();
  for (const k of keys) byHash.set(await hashKey(k), k);
  const hashes = [...byHash.keys()];

  let rows: KeyRow[] = [];
  try {
    const placeholders = hashes.map((_, i) => `?${i + 1}`).join(',');
    const res = await env.DB.prepare(
      `SELECT key_hash, used, cap, period_month, exhausted_at FROM pricesapi_keys WHERE key_hash IN (${placeholders})`,
    ).bind(...hashes).all<KeyRow>();
    rows = res.results ?? [];
  } catch {
    // Ledger unavailable: don't starve pricing — use the first configured key.
    return { key: keys[0], hash: hashes[0] };
  }

  const rowByHash = new Map(rows.map((r) => [r.key_hash, r]));
  let best: { hash: string; used: number } | null = null;
  for (const hash of hashes) {
    const row = rowByHash.get(hash);
    // A stale-month row is treated as a fresh, unused budget.
    const sameMonth = row?.period_month === month;
    const used = sameMonth ? Number(row?.used ?? 0) : 0;
    const cap = Number(row?.cap ?? DEFAULT_KEY_CAP) || DEFAULT_KEY_CAP;
    const exhausted = sameMonth && (!!row?.exhausted_at || used >= cap);
    if (exhausted) continue;
    if (!best || used < best.used) best = { hash, used };
  }

  if (!best) return null;
  return { key: byHash.get(best.hash)!, hash: best.hash };
}

// Record one call against a key. `exhausted` marks the key drained for the month
// (set it on a 403 CREDITS_EXCEEDED or a 401 dead-key response). Fails open.
export async function recordKeyCall(
  env: Env,
  picked: PickedKey,
  opts: { exhausted?: boolean } = {},
): Promise<void> {
  const month = monthKey();
  const exhausted = opts.exhausted ? 1 : 0;
  try {
    await env.DB.prepare(
      `INSERT INTO pricesapi_keys (key_hash, used, cap, period_month, exhausted_at, last_used_at, updated_at)
       VALUES (?1, 1, ?2, ?3, CASE WHEN ?4 = 1 THEN datetime('now') END, datetime('now'), datetime('now'))
       ON CONFLICT(key_hash) DO UPDATE SET
         used = CASE WHEN pricesapi_keys.period_month = ?3 THEN pricesapi_keys.used + 1 ELSE 1 END,
         period_month = ?3,
         exhausted_at = CASE
           WHEN ?4 = 1 THEN datetime('now')
           WHEN pricesapi_keys.period_month = ?3 THEN pricesapi_keys.exhausted_at
           ELSE NULL END,
         last_used_at = datetime('now'),
         updated_at = datetime('now')`,
    ).bind(picked.hash, DEFAULT_KEY_CAP, month, exhausted).run();
  } catch (e) {
    console.warn('[pricesapi-keys] recordKeyCall failed open:', (e as Error).message);
  }
}

export interface KeyPoolEntry {
  key_hash: string;
  used: number;
  cap: number;
  remaining: number;
  exhausted: boolean;
  last_used_at: string | null;
}

export interface KeyPoolStatus {
  keys_configured: number;
  keys_live: number;
  pooled_remaining: number;
  entries: KeyPoolEntry[];
}

// Admin diagnostics: per-key budget snapshot for the current month. Configured
// keys with no ledger row appear as a full, unused budget.
export async function getKeyPoolStatus(env: Env): Promise<KeyPoolStatus> {
  const keys = configuredKeys(env);
  const month = monthKey();
  const hashes = await Promise.all(keys.map(hashKey));

  let rows: KeyRow[] = [];
  if (hashes.length) {
    try {
      const placeholders = hashes.map((_, i) => `?${i + 1}`).join(',');
      const res = await env.DB.prepare(
        `SELECT key_hash, used, cap, period_month, exhausted_at, last_used_at FROM pricesapi_keys WHERE key_hash IN (${placeholders})`,
      ).bind(...hashes).all<KeyRow & { last_used_at: string | null }>();
      rows = res.results ?? [];
    } catch (e) {
      console.warn('[pricesapi-keys] status read failed:', (e as Error).message);
    }
  }
  const rowByHash = new Map(rows.map((r) => [r.key_hash, r]));

  const entries: KeyPoolEntry[] = hashes.map((hash) => {
    const row = rowByHash.get(hash) as (KeyRow & { last_used_at: string | null }) | undefined;
    const sameMonth = row?.period_month === month;
    const used = sameMonth ? Number(row?.used ?? 0) : 0;
    const cap = Number(row?.cap ?? DEFAULT_KEY_CAP) || DEFAULT_KEY_CAP;
    const exhausted = sameMonth && (!!row?.exhausted_at || used >= cap);
    return {
      key_hash: hash.slice(0, 12),
      used,
      cap,
      remaining: Math.max(0, cap - used),
      exhausted,
      last_used_at: row?.last_used_at ?? null,
    };
  });

  return {
    keys_configured: keys.length,
    keys_live: entries.filter((e) => !e.exhausted).length,
    pooled_remaining: entries.reduce((s, e) => s + (e.exhausted ? 0 : e.remaining), 0),
    entries,
  };
}
