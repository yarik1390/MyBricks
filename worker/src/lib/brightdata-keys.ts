import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Rotating-key pool for Bright Data Web Unlocker (eBay sold-comp scraping).
//
// Each Bright Data token carries its own monthly credit budget (free tier =
// 5000/mo). The shared api_quota ledger is keyed by (service, day) and cannot
// see individual tokens, so this module tracks per-key spend in the
// brightdata_keys table and fails over to the next key when one drains. EVERY
// helper FAILS OPEN: a bookkeeping hiccup must never stop a scrape.
//
//   brightdata_keys(key_hash PK, used, cap, period_month, exhausted_at, ...)
//
// Mirrors lib/pricesapi-keys.ts. Keys are stored only as a SHA-256 hash, so the
// table is safe to dump in admin diagnostics. Budget resets each month.
// ---------------------------------------------------------------------------

// Per-key monthly credit budget. Deliberately set BELOW the free-tier 5000 so
// concurrent in-flight calls (the scrape runs up to ~8 at once) can never push a
// key past 5000 real credits before it's marked exhausted — a hard safety margin.
const DEFAULT_KEY_CAP = 4900;

export interface PickedKey {
  key: string;
  hash: string;
}

/**
 * Does this response mean the KEY is out of budget, as opposed to the request
 * being wrong?
 *
 * 401/402/403 are the obvious ones. The trap is that a drained Bright Data
 * account answers "Customer is not active" with HTTP **400** — a status we
 * otherwise read as "bad request" and therefore do NOT latch. Left unhandled
 * that is self-inflicted starvation: pickKey drains IN ORDER, so a dead key at
 * the head of the order is handed out again on every single call and the other
 * tokens in the pool never get a turn, no matter how much budget they have.
 *
 * Deliberately matched on the message rather than on 400 alone, because a
 * genuine malformed request is also a 400 and must NOT retire a healthy key.
 */
export function isBrightDataExhaustion(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  if (status !== 400) return false;
  return /customer is not active|not enough (credits|balance)|insufficient (credits|funds|balance)|quota exceeded|no active plan/i
    .test(body || '');
}

function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

// All configured tokens (BRIGHTDATA_API_TOKEN + comma-separated
// BRIGHTDATA_API_TOKENS), trimmed and de-duplicated, in a stable order.
export function configuredKeys(env: Env): string[] {
  const all = [
    env.BRIGHTDATA_API_TOKEN ?? '',
    ...(env.BRIGHTDATA_API_TOKENS?.split(',') ?? []),
  ]
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

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

// Pick the live token with the most remaining budget this month (lowest used).
// Returns null when every configured token is exhausted for the month. Fails
// open to the first configured token if the ledger read throws.
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
      `SELECT key_hash, used, cap, period_month, exhausted_at FROM brightdata_keys WHERE key_hash IN (${placeholders})`,
    ).bind(...hashes).all<KeyRow>();
    rows = res.results ?? [];
  } catch {
    return { key: keys[0], hash: hashes[0] };
  }

  const rowByHash = new Map(rows.map((r) => [r.key_hash, r]));
  let best: { hash: string; used: number } | null = null;
  for (const hash of hashes) {
    const row = rowByHash.get(hash);
    const sameMonth = row?.period_month === month;
    const used = sameMonth ? Number(row?.used ?? 0) : 0;
    const cap = DEFAULT_KEY_CAP; // authoritative: the code constant, not the stored row cap
    const exhausted = sameMonth && (!!row?.exhausted_at || used >= cap);
    if (exhausted) continue;
    if (!best || used < best.used) best = { hash, used };
  }

  if (!best) return null;
  return { key: byHash.get(best.hash)!, hash: best.hash };
}

// Record one call against a token. `exhausted` marks the token drained for the
// month (set it on a 401/402/403/429 credit/auth failure). Fails open.
export async function recordKeyCall(
  env: Env,
  picked: PickedKey,
  opts: { exhausted?: boolean } = {},
): Promise<void> {
  const month = monthKey();
  const exhausted = opts.exhausted ? 1 : 0;
  try {
    await env.DB.prepare(
      `INSERT INTO brightdata_keys (key_hash, used, cap, period_month, exhausted_at, last_used_at, updated_at)
       VALUES (?1, 1, ?2, ?3, CASE WHEN ?4 = 1 THEN datetime('now') END, datetime('now'), datetime('now'))
       ON CONFLICT(key_hash) DO UPDATE SET
         used = CASE WHEN brightdata_keys.period_month = ?3 THEN brightdata_keys.used + 1 ELSE 1 END,
         period_month = ?3,
         exhausted_at = CASE
           WHEN ?4 = 1 THEN datetime('now')
           WHEN brightdata_keys.period_month = ?3 THEN brightdata_keys.exhausted_at
           ELSE NULL END,
         last_used_at = datetime('now'),
         updated_at = datetime('now')`,
    ).bind(picked.hash, DEFAULT_KEY_CAP, month, exhausted).run();
  } catch (e) {
    console.warn('[brightdata-keys] recordKeyCall failed open:', (e as Error).message);
  }
}

// Admin: clear the per-key "drained/exhausted" latch so a fixed token or zone can
// be retried immediately instead of waiting for the next UTC-month rollover. Zeroes
// `used` and clears `exhausted_at` for every pooled key; the normal recordKeyCall
// flow repopulates them as real calls happen. Fails open.
export async function resetKeyPool(env: Env): Promise<{ reset: number }> {
  try {
    const res = await env.DB.prepare(
      `UPDATE brightdata_keys SET used = 0, exhausted_at = NULL, updated_at = datetime('now')`,
    ).run();
    return { reset: Number((res.meta?.changes as number | undefined) ?? 0) };
  } catch (e) {
    console.warn('[brightdata-keys] resetKeyPool failed:', (e as Error).message);
    return { reset: 0 };
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

// Admin diagnostics: per-key budget snapshot for the current month.
export async function getKeyPoolStatus(env: Env): Promise<KeyPoolStatus> {
  const keys = configuredKeys(env);
  const month = monthKey();
  const hashes = await Promise.all(keys.map(hashKey));

  let rows: (KeyRow & { last_used_at: string | null })[] = [];
  if (hashes.length) {
    try {
      const placeholders = hashes.map((_, i) => `?${i + 1}`).join(',');
      const res = await env.DB.prepare(
        `SELECT key_hash, used, cap, period_month, exhausted_at, last_used_at FROM brightdata_keys WHERE key_hash IN (${placeholders})`,
      ).bind(...hashes).all<KeyRow & { last_used_at: string | null }>();
      rows = res.results ?? [];
    } catch (e) {
      console.warn('[brightdata-keys] status read failed:', (e as Error).message);
    }
  }
  const rowByHash = new Map(rows.map((r) => [r.key_hash, r]));

  const entries: KeyPoolEntry[] = hashes.map((hash) => {
    const row = rowByHash.get(hash);
    const sameMonth = row?.period_month === month;
    const used = sameMonth ? Number(row?.used ?? 0) : 0;
    const cap = DEFAULT_KEY_CAP; // authoritative: the code constant, not the stored row cap
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
