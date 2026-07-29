import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Sequential key pool for Firecrawl.
//
// Firecrawl keys here are one-time CREDIT allotments of very different sizes
// (e.g. 19k left on the original key, 650k on a newly-added one), so the two
// existing pool modules don't fit:
//
//   * lib/brightdata-keys.ts picks the LEAST-used key to spread load and resets
//     every calendar month. Both are wrong here — spreading would strand a
//     nearly-empty key forever, and a monthly reset would resurrect a key whose
//     one-time balance is genuinely gone.
//   * The shared api_quota ledger is keyed by (service, day) and cannot see
//     individual keys at all; it stays as the daily runaway guard.
//
// So: DRAIN IN ORDER. Always use the first key that is neither latched nor over
// its configured balance, so a small key is spent to the end before the next one
// is touched. Firecrawl's own 402 is the authoritative signal and latches the key
// permanently; the configured balance is a proactive hint that just moves the
// switchover a little earlier. `used` counts CREDITS (json/enhanced = 5, else 1),
// not calls. EVERY helper FAILS OPEN — bookkeeping must never stop a scrape.
//
//   firecrawl_keys(key_hash PK, used, cap, exhausted_at, last_used_at, updated_at)
//
// Keys are stored only as a SHA-256 hash, so the table is safe to surface in
// admin diagnostics.
// ---------------------------------------------------------------------------

export interface PickedFirecrawlKey {
  key: string;
  hash: string;
  /** Position in the configured order — 0 is FIRECRAWL_API_KEY. */
  index: number;
}

/** Configured keys in DECLARED ORDER (FIRECRAWL_API_KEY first, then
 *  FIRECRAWL_API_KEYS left to right), de-duplicated. Order is the drain order,
 *  so put the key you want spent first in FIRECRAWL_API_KEY. */
export function configuredFirecrawlKeys(env: Env): string[] {
  const all = [
    env.FIRECRAWL_API_KEY ?? '',
    ...(env.FIRECRAWL_API_KEYS?.split(',') ?? []),
  ].map((k) => k.trim()).filter(Boolean);
  return [...new Set(all)];
}

/** Per-key credit balances from FIRECRAWL_KEY_CREDITS, positionally aligned with
 *  the key list (e.g. "19000,650000"). A missing/zero/unparseable entry means
 *  "unknown balance" — that key is then only ever retired by Firecrawl's own 402,
 *  which is the safe direction: we under-claim knowledge, never over-claim it. */
export function configuredFirecrawlCaps(env: Env): Array<number | null> {
  return (env.FIRECRAWL_KEY_CREDITS?.split(',') ?? []).map((raw) => {
    const n = Number(raw.trim());
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  });
}

export async function hashFirecrawlKey(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface KeyRow {
  key_hash: string;
  used: number;
  exhausted_at: string | null;
}

async function readRows(env: Env, hashes: string[]): Promise<Map<string, KeyRow>> {
  if (!hashes.length) return new Map();
  const placeholders = hashes.map((_, i) => `?${i + 1}`).join(',');
  const res = await env.DB.prepare(
    `SELECT key_hash, used, exhausted_at FROM firecrawl_keys WHERE key_hash IN (${placeholders})`,
  ).bind(...hashes).all<KeyRow>();
  return new Map((res.results ?? []).map((r) => [r.key_hash, r]));
}

/**
 * First key with budget left, in configured order. Returns null only when every
 * configured key is spent — callers should treat that as "Firecrawl is out",
 * not as a transient error. Fails open to the first configured key.
 */
export async function pickFirecrawlKey(env: Env): Promise<PickedFirecrawlKey | null> {
  const keys = configuredFirecrawlKeys(env);
  if (!keys.length) return null;
  const caps = configuredFirecrawlCaps(env);
  const hashes = await Promise.all(keys.map(hashFirecrawlKey));

  let rowByHash: Map<string, KeyRow>;
  try {
    rowByHash = await readRows(env, hashes);
  } catch {
    return { key: keys[0], hash: hashes[0], index: 0 };
  }

  for (let i = 0; i < keys.length; i++) {
    const row = rowByHash.get(hashes[i]);
    if (row?.exhausted_at) continue;                       // Firecrawl said 402
    const cap = caps[i] ?? null;
    if (cap != null && Number(row?.used ?? 0) >= cap) continue;
    return { key: keys[i], hash: hashes[i], index: i };
  }
  return null;
}

/**
 * Book `credits` against a key. `exhausted: true` latches it permanently — pass
 * it when Firecrawl reports the key is out of credits, which is authoritative
 * and outranks whatever our own counter says. Fails open.
 */
export async function recordFirecrawlSpend(
  env: Env,
  picked: PickedFirecrawlKey,
  credits: number,
  opts: { exhausted?: boolean } = {},
): Promise<void> {
  const spend = Number.isFinite(credits) && credits > 0 ? Math.floor(credits) : 0;
  const exhausted = opts.exhausted ? 1 : 0;
  const caps = configuredFirecrawlCaps(env);
  const cap = caps[picked.index] ?? 0;
  try {
    await env.DB.prepare(
      `INSERT INTO firecrawl_keys (key_hash, used, cap, exhausted_at, last_used_at, updated_at)
       VALUES (?1, ?2, ?3, CASE WHEN ?4 = 1 THEN datetime('now') END, datetime('now'), datetime('now'))
       ON CONFLICT(key_hash) DO UPDATE SET
         used = firecrawl_keys.used + ?2,
         cap = ?3,
         -- Once latched, stay latched: a one-time allotment does not come back.
         exhausted_at = CASE WHEN ?4 = 1 THEN datetime('now') ELSE firecrawl_keys.exhausted_at END,
         last_used_at = datetime('now'),
         updated_at = datetime('now')`,
    ).bind(picked.hash, spend, cap, exhausted).run();
  } catch (e) {
    console.warn('[firecrawl-keys] recordFirecrawlSpend failed open:', (e as Error).message);
  }
}

/** Does this Firecrawl response mean "this key has no credits left"? Firecrawl
 *  answers 402 for a drained balance; the body check catches the same condition
 *  arriving as a 400/403 with an explanatory message. Deliberately narrow — a
 *  rate limit (429) is NOT exhaustion and must not retire a good key. */
export function isCreditExhaustion(status: number, body: string): boolean {
  if (status === 402) return true;
  if (status !== 400 && status !== 401 && status !== 403) return false;
  return /insufficient credits|out of credits|no credits|payment required|credit limit/i.test(body);
}

/** Is this the per-minute request ceiling rather than a drained balance?
 *  Firecrawl's limits are PER KEY, so a 429 on the active key says nothing about
 *  the others — the call can be retried immediately on the next key. Costs no
 *  credits on the throttled key (Firecrawl does not charge for a rejected
 *  request), so this borrows throughput without disturbing the drain order. */
export function isRateLimited(status: number): boolean {
  return status === 429;
}

/** The next usable key AFTER `afterIndex`, ignoring balances already spent.
 *  Used only for the rate-limit detour: unlike pickFirecrawlKey this deliberately
 *  skips forward rather than restarting at the head, so a throttled key is not
 *  handed straight back. */
export async function pickNextFirecrawlKey(
  env: Env,
  afterIndex: number,
): Promise<PickedFirecrawlKey | null> {
  const keys = configuredFirecrawlKeys(env);
  const caps = configuredFirecrawlCaps(env);
  if (afterIndex + 1 >= keys.length) return null;
  const hashes = await Promise.all(keys.map(hashFirecrawlKey));

  let rowByHash: Map<string, KeyRow>;
  try {
    rowByHash = await readRows(env, hashes);
  } catch {
    return null;
  }
  for (let i = afterIndex + 1; i < keys.length; i++) {
    const row = rowByHash.get(hashes[i]);
    if (row?.exhausted_at) continue;
    const cap = caps[i] ?? null;
    if (cap != null && Number(row?.used ?? 0) >= cap) continue;
    return { key: keys[i], hash: hashes[i], index: i };
  }
  return null;
}

/** Admin: un-latch every key (e.g. after topping a plan up) and zero the counters. */
export async function resetFirecrawlKeyPool(env: Env): Promise<{ reset: number }> {
  try {
    const res = await env.DB.prepare(
      `UPDATE firecrawl_keys SET used = 0, exhausted_at = NULL, updated_at = datetime('now')`,
    ).run();
    return { reset: Number((res.meta?.changes as number | undefined) ?? 0) };
  } catch (e) {
    console.warn('[firecrawl-keys] resetFirecrawlKeyPool failed:', (e as Error).message);
    return { reset: 0 };
  }
}

export interface FirecrawlKeyEntry {
  key_hash: string;
  index: number;
  used: number;
  /** Configured balance, or null when unknown (only a 402 will retire it). */
  cap: number | null;
  remaining: number | null;
  exhausted: boolean;
  active: boolean;
  last_used_at: string | null;
}

export interface FirecrawlKeyPoolStatus {
  keys_configured: number;
  keys_live: number;
  /** Sum of remaining credits across live keys with a known balance. */
  pooled_remaining: number | null;
  active_key_index: number | null;
  /** How many balances FIRECRAWL_KEY_CREDITS declares. When this exceeds
   *  keys_configured, a key was declared but never reached the Worker — the
   *  likely cause is adding it as a GitHub Actions secret, which is NOT in the
   *  deploy workflow's upload list, instead of as a Worker secret. Surfaced so
   *  the mismatch is visible now rather than when the active key runs dry. */
  caps_declared: number;
  entries: FirecrawlKeyEntry[];
}

/** Admin diagnostics: which key is being spent, and how much is left where. */
export async function getFirecrawlKeyPoolStatus(env: Env): Promise<FirecrawlKeyPoolStatus> {
  const keys = configuredFirecrawlKeys(env);
  const caps = configuredFirecrawlCaps(env);
  const hashes = await Promise.all(keys.map(hashFirecrawlKey));

  let rowByHash = new Map<string, KeyRow & { last_used_at?: string | null }>();
  try {
    if (hashes.length) {
      const placeholders = hashes.map((_, i) => `?${i + 1}`).join(',');
      const res = await env.DB.prepare(
        `SELECT key_hash, used, exhausted_at, last_used_at FROM firecrawl_keys WHERE key_hash IN (${placeholders})`,
      ).bind(...hashes).all<KeyRow & { last_used_at: string | null }>();
      rowByHash = new Map((res.results ?? []).map((r) => [r.key_hash, r]));
    }
  } catch (e) {
    console.warn('[firecrawl-keys] status read failed:', (e as Error).message);
  }

  let activeIndex: number | null = null;
  const entries: FirecrawlKeyEntry[] = hashes.map((hash, i) => {
    const row = rowByHash.get(hash);
    const used = Number(row?.used ?? 0);
    const cap = caps[i] ?? null;
    const exhausted = !!row?.exhausted_at || (cap != null && used >= cap);
    if (!exhausted && activeIndex === null) activeIndex = i;
    return {
      key_hash: hash.slice(0, 12),
      index: i,
      used,
      cap,
      remaining: cap == null ? null : Math.max(0, cap - used),
      exhausted,
      active: false,
      last_used_at: row?.last_used_at ?? null,
    };
  });
  if (activeIndex !== null) entries[activeIndex].active = true;

  const known = entries.filter((e) => !e.exhausted && e.remaining != null);
  return {
    keys_configured: keys.length,
    keys_live: entries.filter((e) => !e.exhausted).length,
    pooled_remaining: known.length ? known.reduce((s, e) => s + (e.remaining ?? 0), 0) : null,
    active_key_index: activeIndex,
    caps_declared: (env.FIRECRAWL_KEY_CREDITS?.split(',').filter((s) => s.trim()) ?? []).length,
    entries,
  };
}
