import type { Env } from '../types';

const DEFAULT_KEY_CAP = 4900;

export interface PickedBrightDataToken {
  key: string;
  hash: string;
  index: number;
}

function keyCap(env: Env): number {
  const raw = env.BRIGHTDATA_KEY_CAP?.trim();
  if (!raw) return DEFAULT_KEY_CAP;
  const configured = Number(raw);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(Math.floor(configured), 4900)
    : DEFAULT_KEY_CAP;
}

function monthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function configuredBrightDataTokens(env: Env): string[] {
  const keys = [
    env.BRIGHTDATA_API_TOKEN ?? '',
    ...(env.BRIGHTDATA_API_TOKENS?.split(',') ?? []),
  ].map((key) => key.trim()).filter(Boolean);
  return [...new Set(keys)];
}

export function brightDataEnabled(env: Env): boolean {
  return configuredBrightDataTokens(env).length > 0;
}

export async function hashBrightDataToken(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isBrightDataExhaustion(status: number, body: string): boolean {
  if (status === 401 || status === 402 || status === 403) return true;
  if (status !== 400) return false;
  return /customer is not active|not enough (credits|balance)|insufficient (credits|funds|balance)|quota exceeded|no active plan/i.test(body || '');
}

interface KeyRow {
  key_hash: string;
  used: number;
  period_month: string | null;
  exhausted_at: string | null;
  last_used_at?: string | null;
}

export async function pickBrightDataToken(env: Env): Promise<PickedBrightDataToken | null> {
  const keys = configuredBrightDataTokens(env);
  if (!keys.length) return null;
  const hashes = await Promise.all(keys.map(hashBrightDataToken));
  const cap = keyCap(env);
  let rows: KeyRow[];
  try {
    const placeholders = hashes.map((_, index) => `?${index + 1}`).join(',');
    const result = await env.DB.prepare(
      `SELECT key_hash, used, period_month, exhausted_at FROM brightdata_keys WHERE key_hash IN (${placeholders})`,
    ).bind(...hashes).all<KeyRow>();
    rows = result.results ?? [];
  } catch {
    // Ledger/schema failures must not make the external integration unavailable.
    return { key: keys[0], hash: hashes[0], index: 0 };
  }

  const month = monthKey();
  const byHash = new Map(rows.map((row) => [row.key_hash, row]));
  let bestIndex = -1;
  let bestUsed = Number.POSITIVE_INFINITY;
  for (let index = 0; index < hashes.length; index++) {
    const row = byHash.get(hashes[index]);
    const current = row?.period_month === month;
    const used = current ? Number(row?.used ?? 0) : 0;
    if (current && (row?.exhausted_at || used >= cap)) continue;
    if (used < bestUsed) {
      bestIndex = index;
      bestUsed = used;
    }
  }
  if (bestIndex < 0) return null;
  return { key: keys[bestIndex], hash: hashes[bestIndex], index: bestIndex };
}

/**
 * Atomically claim ONE request unit on a token, BEFORE the outbound call, and
 * fail CLOSED: when the ledger is unreachable or the token is at its monthly
 * cap we do not spend. D1/SQLite's single-statement UPDATE is atomic, so
 * concurrent isolates can never double-spend the last unit.
 *
 * Returns true when the unit was claimed (the caller may proceed), false when
 * the token is at cap / exhausted (caller must try the next token). Throws on
 * ledger failure — the caller treats that as "no token available" and returns
 * null rather than spend unaccounted credits.
 */
export async function reserveBrightDataUnit(
  env: Env,
  picked: PickedBrightDataToken,
): Promise<boolean> {
  const cap = keyCap(env);
  const month = monthKey();
  // Single atomic upsert. The claim lands ONLY when the WHERE guard passes:
  //   - fresh row (first use this month)            → INSERT → claimed
  //   - same month, under cap, not exhausted        → used+1 → claimed
  //     (the increment that REACHES the cap is still a valid last claim)
  //   - same month at cap or exhausted              → no-op → NOT claimed
  //   - previous-month row                          → reset used=1, clear
  //     exhausted (fresh monthly budget) → claimed
  // SQLite upserts are atomic, so concurrent isolates can never double-spend
  // the last unit; a no-op returns no row, which is how a failed claim is
  // detected without a sentinel.
  const result = await env.DB.prepare(
    `INSERT INTO brightdata_keys (key_hash, used, cap, period_month, last_used_at, updated_at)
     VALUES (?1, 1, ?2, ?3, datetime('now'), datetime('now'))
     ON CONFLICT(key_hash) DO UPDATE SET
       used = CASE WHEN brightdata_keys.period_month = ?3 THEN brightdata_keys.used + 1 ELSE 1 END,
       period_month = ?3,
       cap = ?2,
       exhausted_at = CASE WHEN brightdata_keys.period_month = ?3 THEN brightdata_keys.exhausted_at ELSE NULL END,
       last_used_at = datetime('now'), updated_at = datetime('now')
     WHERE brightdata_keys.period_month != ?3
        OR (brightdata_keys.used < ?2 AND brightdata_keys.exhausted_at IS NULL)
     RETURNING used`,
  ).bind(picked.hash, cap, month).first<{ used: number }>();
  return result != null;
}

/** Latch a token as exhausted for the current month (401/402/403/400-credit). */
export async function markBrightDataExhausted(
  env: Env,
  picked: PickedBrightDataToken,
): Promise<void> {
  const month = monthKey();
  try {
    await env.DB.prepare(
      `UPDATE brightdata_keys SET exhausted_at = datetime('now'), updated_at = datetime('now')
       WHERE key_hash = ?1 AND period_month = ?2`,
    ).bind(picked.hash, month).run();
  } catch (error) {
    // A failed latch only delays the drain by one request; never blocks the pool.
    console.warn('[brightdata-keys] exhaust latch failed:', (error as Error).message);
  }
}

/** @deprecated use reserveBrightDataUnit + markBrightDataExhausted */
export async function recordBrightDataCall(
  env: Env,
  picked: PickedBrightDataToken,
  options: { exhausted?: boolean } = {},
): Promise<void> {
  const cap = keyCap(env);
  const month = monthKey();
  try {
    await env.DB.prepare(
      `INSERT INTO brightdata_keys (key_hash, used, cap, period_month, exhausted_at, last_used_at, updated_at)
       VALUES (?1, 1, ?2, ?3, CASE WHEN ?4=1 THEN datetime('now') END, datetime('now'), datetime('now'))
       ON CONFLICT(key_hash) DO UPDATE SET
         used=CASE WHEN brightdata_keys.period_month=?3 THEN brightdata_keys.used+1 ELSE 1 END,
         cap=?2,
         period_month=?3,
         exhausted_at=CASE
           WHEN ?4=1 THEN datetime('now')
           WHEN brightdata_keys.period_month=?3 THEN brightdata_keys.exhausted_at
           ELSE NULL END,
         last_used_at=datetime('now'), updated_at=datetime('now')`,
    ).bind(picked.hash, cap, month, options.exhausted ? 1 : 0).run();
  } catch (error) {
    console.warn('[brightdata-keys] spend ledger failed open:', (error as Error).message);
  }
}

export interface BrightDataKeyPoolStatus {
  keys_configured: number;
  keys_live: number;
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

export async function getBrightDataKeyPoolStatus(env: Env): Promise<BrightDataKeyPoolStatus> {
  const keys = configuredBrightDataTokens(env);
  const hashes = await Promise.all(keys.map(hashBrightDataToken));
  const month = monthKey();
  const cap = keyCap(env);
  let rows: KeyRow[] = [];
  let ledgerOk = true;
  try {
    if (hashes.length) {
      const placeholders = hashes.map((_, index) => `?${index + 1}`).join(',');
      rows = (await env.DB.prepare(
        `SELECT key_hash, used, period_month, exhausted_at, last_used_at FROM brightdata_keys WHERE key_hash IN (${placeholders})`,
      ).bind(...hashes).all<KeyRow>()).results ?? [];
    }
  } catch {
    // Ledger/schema outage: report DEGRADED, never fabricated capacity. The
    // runtime path fails closed on the same outage (brightDataUnlock returns
    // null), so the admin panel must not claim the pool is live and full —
    // that would conceal a missing migration or a D1 outage.
    ledgerOk = false;
  }
  const byHash = new Map(rows.map((row) => [row.key_hash, row]));
  const entries = hashes.map((hash, index) => {
    const row = byHash.get(hash);
    const current = row?.period_month === month;
    const used = current ? Math.max(0, Number(row?.used ?? 0)) : 0;
    const exhausted = !!(current && (row?.exhausted_at || used >= cap));
    return {
      key_hash: hash.slice(0, 12), index,
      used: ledgerOk ? used : 0,
      cap,
      remaining: ledgerOk ? (exhausted ? 0 : Math.max(0, cap - used)) : 0,
      exhausted: ledgerOk && exhausted,
      period_month: month,
      last_used_at: ledgerOk ? (row?.last_used_at ?? null) : null,
      usage_unknown: !ledgerOk,
    };
  });
  return {
    keys_configured: keys.length,
    keys_live: ledgerOk ? entries.filter((entry) => !entry.exhausted).length : 0,
    pooled_remaining: ledgerOk ? entries.reduce((sum, entry) => sum + entry.remaining, 0) : 0,
    period_month: month,
    ledger_available: ledgerOk,
    status: ledgerOk ? 'ok' : 'degraded',
    entries,
  };
}

export async function resetBrightDataKeyPool(env: Env): Promise<{ reset: number }> {
  try {
    // Administrative recovery un-latches a false-positive exhaustion (a 401/402
    // that turned out transient) but MUST NOT reset current-month usage: `used`
    // is the spend against the monthly unit cap, and the picker's WHERE guard
    // treats a zeroed counter as a fresh budget — which would silently reopen
    // paid capacity past the advertised ceiling. Usage resets solely when
    // period_month rolls over.
    const result = await env.DB.prepare(
      `UPDATE brightdata_keys SET exhausted_at=NULL, updated_at=datetime('now')
       WHERE period_month = strftime('%Y-%m','now') AND exhausted_at IS NOT NULL`,
    ).run();
    return { reset: Number(result.meta?.changes ?? 0) };
  } catch (error) {
    console.warn('[brightdata-keys] reset failed:', (error as Error).message);
    return { reset: 0 };
  }
}
