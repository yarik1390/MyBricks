import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Per-source daily external-API budget ledger (Pricing Engine v2.1, Phase 1c).
//
// Budgets are ~80% of each provider's hard cap so organic on-demand traffic
// and clock skew can never push us over a provider limit:
//   BrickLink 5,000/day · eBay 5,000/day · Brickset has a bounded daily budget.
// The ledger lives in the api_quota D1 table keyed by (service, UTC day).
// Quota consumption policy depends on the helper: spendQuota fails open for
// best-effort pricing, spendQuotaFailClosed and capped reserveQuota accounting
// fail closed, and unknown/unbudgeted providers remain unlimited.
// ---------------------------------------------------------------------------

export const QUOTA_CAPS: Record<string, number> = {
  // BrickLink's hard cap is 5,000/day. Held at 90% rather than the ~80% used
  // elsewhere: BrickLink freshness is the binding constraint on high-confidence
  // valuations (of the sets with two independent sold families, only ~19% had
  // BOTH sources fresh), so the refresh lane needs the room. 500/day is still
  // reserved for organic on-demand revaluations and clock skew.
  // 2026-11-26: BrickLink blocked the Store API for exceeding this limit even
  // though this daily ledger never passed 3,324. The ledger only saw calls the
  // jobs reserved: retries, the set-page refresh and the revalue button were
  // never booked, and BrickLink's day does not start at 00:00 UTC. Every real
  // BrickLink HTTP attempt is now booked at the source (spendBrickLinkCall,
  // called from lib/bricklink.ts) against a ROLLING 24-hour window, so no
  // 24-hour span can pass BRICKLINK_ROLLING_CAP whatever clock BrickLink uses.
  bricklink: 4000,
  ebay: 4000,
  brickset: 90,
  // PriceCharting per-set /api/product calls (the daily enrich cron). Free/cheap
  // tier but metered so admin usage is honest + a runaway is capped; the weekly
  // bulk CSV is a single download and is not counted here. Enrich runs ~40/day,
  // so this is generous headroom, not a throttle.
  pricecharting: 500,
  // Firecrawl is metered in CREDITS, not scrape-count (1 = basic/markdown/product,
  // 5 = json LLM extract). Plan is a one-time ~300k allotment then ~1,000/month,
  // so this is a per-DAY credit ceiling that guards against a runaway day. Raise
  // it for the one-time bootstrap via the FIRECRAWL_DAILY_CREDITS env var.
  firecrawl: 4000,
  // Bright Data Web Unlocker daily request ceiling. Monthly per-key safety is
  // the real meter (brightdata_keys); this bounds a runaway day on top of it.
  // 6 keys × 5k/mo ≈ 1,000/day sustainable, so 300 is conservative headroom.
  brightdata: 300,
  // Decodo Web Scraping API requests (free plan ~$5/month): ~9k/month.
  decodo: 300,
  // ZenRows requests (free plan 5,000 credits/month, 1 per plain request).
  zenrows: 150,
  // Exa searches (lib/exa.ts): 10 news searches + 3 per-set lookups a day,
  // about $0.01 each, so a month stays inside the free $10 of credits.
  exa: 30,
  // Amazon Creators API searchItems calls (plus ~1 token mint/hour). The API is
  // free but eligibility-gated; this cap bounds a runaway day, not the plan.
  amazon: 300,
  // Walmart/Target price lookups (jobs/store-offers.ts): one Firecrawl json
  // extraction (5 credits) per store per set, so 40/day = 200 credits/day.
  stores: 80,
  // Local LEGO.com product pages (lib/lego-local-price.ts), one per set and
  // non-US market a day, read when a member opens the set page.
  lego_local: 60,
  // Set description translations on the public /api/sets/:set/description
  // route with the shared Gemini key. Each result is cached per set+language,
  // so real traffic needs few; the cap stops a crawler walking the catalog.
  describe_translate: 600,
  // Workers AI scan calls (lib/workers-ai.ts). The account's free allocation is
  // 10,000 Neurons/day; a Gemma 4 photo scan is ~15-35, a shelf scan more. 250
  // calls keeps the worst case under the free line, so this step never bills.
  workersai: 250,
  // Shared PAID Gemini key (scans, advisor, listing drafts, past the free
  // providers). About $0.001 a call, so 1,500 a day caps the bill near $1.50 a
  // day across ALL users, whatever the per-account limits. Google-side quota
  // on the key is the hard stop behind this. BYOK calls never count here.
  gemini_paid: 1500,
};

// Admin-tunable daily-cap overrides (lib/source-config.ts), keyed by service.
// Empty by default → QUOTA_CAPS stands. A null override means "no cap".
const capOverrides: Record<string, number | null> = {};
export function setQuotaCapOverrides(m: Record<string, number | null>): void {
  for (const k of Object.keys(capOverrides)) delete capOverrides[k];
  Object.assign(capOverrides, m);
}
function effectiveCap(service: string): number | undefined {
  if (service in capOverrides) {
    const v = capOverrides[service];
    return v == null ? undefined : v; // null override = uncapped
  }
  return QUOTA_CAPS[service];
}

export function quotaDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const upsertRow = (env: Env, service: string, day: string, cap: number) =>
  env.DB.prepare(
    'INSERT INTO api_quota (service, day, used, cap) VALUES (?1, ?2, 0, ?3) ON CONFLICT(service, day) DO UPDATE SET cap=?3'
  ).bind(service, day, cap);

// Spend `n` units of a service's daily budget in one D1 batch
// (insert-if-missing + guarded increment). Returns false when exhausted.
// Services without a configured cap are never gated.
async function spendQuotaInternal(
  env: Env,
  service: string,
  n: number,
  failClosed: boolean,
): Promise<boolean> {
  // BrickLink blocks the account (manual restore) when the limit is passed, so
  // it is never metered fail-open and always uses the rolling window.
  if (service === 'bricklink') return n <= 0 ? true : bookBrickLinkCalls(env, n);
  let cap = effectiveCap(service);
  // Firecrawl's daily credit ceiling is env-tunable (lift it for the one-time
  // bootstrap, keep it low for normal ops) without a code change.
  if (service === 'firecrawl') {
    const override = Number(env.FIRECRAWL_DAILY_CREDITS);
    if (Number.isFinite(override) && override > 0) cap = override;
  }
  if (!cap || n <= 0) return true;
  const day = quotaDay();
  try {
    const results = await env.DB.batch([
      upsertRow(env, service, day, cap),
      env.DB.prepare(
        "UPDATE api_quota SET used = used + ?3, updated_at = datetime('now') WHERE service=?1 AND day=?2 AND used + ?3 <= cap"
      ).bind(service, day, n),
    ]);
    return ((results[1]?.meta.changes as number | undefined) ?? 0) > 0;
  } catch (e) {
    console.warn(`[quota] spend(${service}) failed ${failClosed ? 'closed' : 'open'}:`, (e as Error).message);
    return !failClosed;
  }
}

export async function spendQuota(env: Env, service: string, n = 1): Promise<boolean> {
  return spendQuotaInternal(env, service, n, false);
}

/** Claim metered provider budget, refusing the outbound call if D1 accounting
 * is unavailable. Use for providers whose free-plan ceiling must never be
 * bypassed by a bookkeeping outage. */
export async function spendQuotaFailClosed(env: Env, service: string, n = 1): Promise<boolean> {
  return spendQuotaInternal(env, service, n, true);
}

// Reserve budget for a whole batch run. Capped services use an optimistic
// compare-and-swap so each returned grant is exactly the amount atomically
// added to the ledger. Accounting failures fail closed for capped providers;
// services without a configured cap remain unlimited and never touch D1.
export async function reserveQuota(
  env: Env,
  wants: Record<string, number>,
): Promise<Record<string, number>> {
  const grants: Record<string, number> = {};
  const capped: Array<{ service: string; want: number; cap: number }> = [];
  const day = quotaDay();
  let brickLinkWant = 0;

  for (const [service, rawWant] of Object.entries(wants)) {
    if (!Number.isFinite(rawWant)) continue;
    const want = Math.max(0, Math.floor(rawWant));
    if (want <= 0) continue;

    let cap = effectiveCap(service);
    if (service === 'firecrawl') {
      const override = Number(env.FIRECRAWL_DAILY_CREDITS);
      if (Number.isFinite(override) && override > 0) cap = override;
    }

    if (!cap && service !== 'bricklink') {
      grants[service] = want;
      continue;
    }

    grants[service] = 0;
    if (service === 'bricklink') {
      brickLinkWant = want;
      continue;
    }
    capped.push({ service, want, cap: cap as number });
  }

  if (brickLinkWant > 0) {
    grants.bricklink = await reserveBrickLinkCalls(env, brickLinkWant);
  }

  if (!capped.length) return grants;

  try {
    await env.DB.batch(capped.map(({ service, cap }) => upsertRow(env, service, day, cap)));

    await Promise.all(capped.map(async ({ service, want }) => {
      // SQLite serializes writers. The used-value predicate turns the read plus
      // update into a CAS: a competing reservation can only make this attempt
      // affect zero rows, in which case we re-read rather than overgrant.
      for (let attempt = 0; attempt < 8; attempt++) {
        const row = await env.DB.prepare(
          'SELECT used, cap FROM api_quota WHERE service=?1 AND day=?2'
        ).bind(service, day).first<{ used: number; cap: number }>();
        if (!row) return;

        const grant = Math.min(want, Math.max(0, row.cap - row.used));
        if (grant <= 0) return;

        const result = await env.DB.prepare(
          "UPDATE api_quota SET used = used + ?4, updated_at = datetime('now') WHERE service=?1 AND day=?2 AND used=?3 AND used + ?4 <= cap"
        ).bind(service, day, row.used, grant).run();
        if (((result.meta.changes as number | undefined) ?? 0) > 0) {
          grants[service] = grant;
          return;
        }
      }
    }));
  } catch (e) {
    console.warn('[quota] reserve failed closed for capped services:', (e as Error).message);
  }

  return grants;
}

export interface QuotaUsageRow { service: string; used: number; cap: number; remaining: number }

// Today's ledger for the admin panel; budgeted services appear even at zero.
export async function getQuotaUsage(env: Env): Promise<QuotaUsageRow[]> {
  let rows: Array<{ service: string; used: number; cap: number }> = [];
  try {
    const { results } = await env.DB.prepare(
      'SELECT service, used, cap FROM api_quota WHERE day=?1'
    ).bind(quotaDay()).all<{ service: string; used: number; cap: number }>();
    rows = results;
  } catch (e) {
    console.warn('[quota] usage read failed:', (e as Error).message);
  }
  const seen = new Set(rows.map(r => r.service));
  for (const [service, cap] of Object.entries(QUOTA_CAPS)) {
    if (!seen.has(service)) rows.push({ service, used: 0, cap });
  }
  // BrickLink's real limit is per 24 hours, not per UTC day: show the window
  // the guard actually enforces next to the calendar-day row.
  try {
    rows.push({ service: BRICKLINK_ROLLING_LABEL, used: await brickLinkRollingUsed(env), cap: brickLinkRollingCap() });
  } catch { /* the day row above still shows */ }
  return rows
    .map(r => ({ ...r, remaining: Math.max(0, r.cap - r.used) }))
    .sort((a, b) => a.service.localeCompare(b.service));
}

// Read-only remaining daily budget (cap - used today). Unlike reserveQuota it
// does NOT book anything — the Firecrawl crons use it only to skip a run when the
// ceiling is reached, leaving the per-scrape guard (spendQuota, inside
// firecrawlScrape) as the SOLE authoritative credit meter so the ledger reflects
// real spend (no reservation double-count). Fails open — a bookkeeping hiccup
// must never starve a run.
export async function quotaRemaining(env: Env, service: string): Promise<number> {
  if (service === 'bricklink') {
    try {
      const dayRow = await env.DB.prepare('SELECT used FROM api_quota WHERE service=?1 AND day=?2')
        .bind('bricklink', quotaDay()).first<{ used: number }>();
      const dayCap = effectiveCap('bricklink') ?? brickLinkRollingCap();
      return Math.max(0, Math.min(
        brickLinkRollingCap() - await brickLinkRollingUsed(env),
        dayCap - Number(dayRow?.used ?? 0),
      ));
    } catch {
      return 0; // fail closed: never size a BrickLink batch blind
    }
  }
  let cap = effectiveCap(service);
  if (service === 'firecrawl') {
    const override = Number(env.FIRECRAWL_DAILY_CREDITS);
    if (Number.isFinite(override) && override > 0) cap = override;
  }
  if (!cap) return Number.POSITIVE_INFINITY;
  try {
    const row = await env.DB.prepare('SELECT used FROM api_quota WHERE service=?1 AND day=?2')
      .bind(service, quotaDay()).first<{ used: number }>();
    return Math.max(0, cap - Number(row?.used ?? 0));
  } catch {
    return cap;
  }
}

// ---------------------------------------------------------------------------
// Invocation packing — free-plan Workers allow 50 subrequests per invocation
// and EVERY binding call counts (fetch, D1 query/batch, KV get/put). The
// packer turns a requested batch size into what actually fits the budget,
// replacing hand-tuned magic limits. Estimates are deliberately conservative;
// they reflect the live job profiles (integration_health has recorded real
// "Too many subrequests" failures from the previous hand-tuned limits).
// ---------------------------------------------------------------------------

export interface PackProfile {
  supplemental: boolean;   // forced BrickLink used pricing
  ebay: boolean;           // eBay ask refresh when stale
  progressWrites: boolean; // per-set import_runs progress UPDATE
}

// Conservative per-set subrequest cost (external fetches + KV + D1 writes).
export function perSetCost(p: PackProfile): number {
  let cost = 2;                          // supplement batch + valuation UPDATE (D1)
  if (p.progressWrites) cost += 1;       // import_runs progress UPDATE
  cost += 5;                             // BrickLink primary (2 fetches + KV)
  if (p.supplemental) cost += 2;         // extra BrickLink used guide and cache operations
  if (p.ebay) cost += 3;                 // OAuth amortized + ask search
  return cost;
}

export const RUN_OVERHEAD_SUBREQUESTS = 20; // due query, quota reservation, retirement batch, health writes, blended-value recompute pass
// Workers PAID allows 1,000 subrequests/invocation (free was 50). Budget set well
// under that so a packed batch never trips "Too many subrequests"; the real daily
// ceiling is now the per-provider quota ledger (api_quota), not the subrequest cap.
export const DEFAULT_CRON_BUDGET = 800;

// How many sets fit the invocation budget (always at least 1 so a run can
// never fully starve; callers gate the run itself when truly out of budget).
export function packBatch(requestedLimit: number, budget: number, profile: PackProfile): number {
  const usable = Math.max(0, budget - RUN_OVERHEAD_SUBREQUESTS);
  const fit = Math.floor(usable / perSetCost(profile));
  return Math.max(1, Math.min(Math.max(1, requestedLimit), Math.max(1, fit)));
}

// ---------------------------------------------------------------------------
// BrickLink: every real HTTP attempt is booked, in a rolling 24-hour window.
//
// BrickLink's Store API allows 5,000 calls a day and BLOCKS the account when
// that is passed; access only comes back when their support restores it. So:
//   * the meter sits at the source (lib/bricklink.ts calls spendBrickLinkCall
//     before EVERY attempt, retries included), not in each job;
//   * the window is the last 24 hourly buckets, so whatever hour BrickLink's
//     day starts at, no 24-hour span can exceed the cap (plus at most one
//     partial hour, which the 1,000-call margin covers);
//   * it fails closed: if D1 cannot confirm budget, the call is not made.
// Jobs that reserve a batch up front (reserveQuota) book the same window; the
// units they reserve are held in a short-lived prepaid pool that the source
// meter draws from first, so a reserved call is not booked twice while a
// retry or an unreserved call still books its own unit.
// ---------------------------------------------------------------------------

export const BRICKLINK_HARD_DAILY_LIMIT = 5000;
export const BRICKLINK_ROLLING_CAP = 4000;
const BL_HOUR_SERVICE = 'bricklink@hour';
export const BRICKLINK_ROLLING_LABEL = 'bricklink (last 24h)';

export function quotaHour(now = new Date()): string {
  return now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function brickLinkWindowStart(now: Date): string {
  return quotaHour(new Date(now.getTime() - 23 * 3600_000));
}

/** Rolling cap: the admin day cap may lower it, never raise or remove it. */
export function brickLinkRollingCap(): number {
  const c = effectiveCap('bricklink');
  return c && c > 0 ? Math.min(c, BRICKLINK_ROLLING_CAP) : BRICKLINK_ROLLING_CAP;
}

/** Calls booked in the last 24 hourly buckets. Throws if D1 is unavailable. */
export async function brickLinkRollingUsed(env: Env, now = new Date()): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COALESCE(SUM(used), 0) AS n FROM api_quota WHERE service=?1 AND day >= ?2'
  ).bind(BL_HOUR_SERVICE, brickLinkWindowStart(now)).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

/** Atomically book `n` BrickLink calls if the rolling window has room. */
async function bookBrickLinkCalls(env: Env, n: number, now = new Date()): Promise<boolean> {
  if (n <= 0) return true;
  const cap = brickLinkRollingCap();
  const dayCap = effectiveCap('bricklink') ?? cap;
  const hour = quotaHour(now);
  const from = brickLinkWindowStart(now);
  const prune = quotaHour(new Date(now.getTime() - 72 * 3600_000));
  // Room = the rolling 24-hour window AND the calendar-day row (the admin's
  // day cap still applies as a second, never looser, ceiling).
  const room = `(SELECT COALESCE(SUM(used), 0) FROM api_quota WHERE service='${BL_HOUR_SERVICE}' AND day >= ?3) + ?4 <= ?5`
    + ` AND (SELECT COALESCE(MAX(used), 0) FROM api_quota WHERE service='bricklink' AND day=?6) + ?4 <= ?7`;
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO api_quota (service, day, used, cap) VALUES (?1, ?2, 0, ?3) ON CONFLICT(service, day) DO NOTHING'
      ).bind(BL_HOUR_SERVICE, hour, cap),
      upsertRow(env, 'bricklink', quotaDay(now), dayCap),
      // The hourly row is the one the window sums; it is only incremented
      // when both ceilings have room.
      env.DB.prepare(
        `UPDATE api_quota SET used = used + ?4, updated_at = datetime('now') WHERE service=?1 AND day=?2 AND ${room}`
      ).bind(BL_HOUR_SERVICE, hour, from, n, cap, quotaDay(now), dayCap),
      // The calendar-day row (Admin's view) follows the same decision:
      // changes() is the row count of the UPDATE just above (same batch).
      env.DB.prepare(
        "UPDATE api_quota SET used = used + ?3, updated_at = datetime('now') WHERE service=?1 AND day=?2 AND changes() > 0"
      ).bind('bricklink', quotaDay(now), n),
      env.DB.prepare('DELETE FROM api_quota WHERE service=?1 AND day < ?2').bind(BL_HOUR_SERVICE, prune),
    ]);
    return ((results[2]?.meta.changes as number | undefined) ?? 0) > 0;
  } catch (e) {
    console.warn('[quota] bricklink booking failed closed:', (e as Error).message);
    return false;
  }
}

// Units booked by reserveQuota and not yet used, per isolate. They expire
// quickly (a job finishes in minutes), so a leftover never covers calls made
// much later; unused units simply stay booked, which only over-counts.
const PREPAID_TTL_MS = 10 * 60_000;
let prepaid: Array<{ until: number; n: number }> = [];

function takePrepaid(nowMs: number): boolean {
  prepaid = prepaid.filter((p) => p.until > nowMs && p.n > 0);
  const slot = prepaid[0];
  if (!slot) return false;
  slot.n--;
  return true;
}

async function reserveBrickLinkCalls(env: Env, want: number): Promise<number> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let room: number;
    try {
      const dayCap = effectiveCap('bricklink') ?? brickLinkRollingCap();
      const dayRow = await env.DB.prepare('SELECT used FROM api_quota WHERE service=?1 AND day=?2')
        .bind('bricklink', quotaDay()).first<{ used: number }>();
      room = Math.min(
        brickLinkRollingCap() - await brickLinkRollingUsed(env),
        dayCap - Number(dayRow?.used ?? 0),
      );
    } catch (e) {
      console.warn('[quota] bricklink reserve failed closed:', (e as Error).message);
      return 0;
    }
    const grant = Math.min(want, Math.max(0, room));
    if (grant <= 0) return 0;
    if (await bookBrickLinkCalls(env, grant)) {
      prepaid.push({ until: Date.now() + PREPAID_TTL_MS, n: grant });
      return grant;
    }
  }
  return 0;
}

// Once the window is full, skip D1 for a minute instead of asking per call.
let exhaustedUntil = 0;

/**
 * Called by lib/bricklink.ts before EVERY BrickLink HTTP attempt (first try
 * and each retry). Uses a reserved unit when one is held, otherwise books one.
 * Returns false when the call must not be made.
 */
export async function spendBrickLinkCall(env: Env): Promise<boolean> {
  const nowMs = Date.now();
  if (takePrepaid(nowMs)) return true;
  if (nowMs < exhaustedUntil) return false;
  const ok = await bookBrickLinkCalls(env, 1);
  if (!ok) exhaustedUntil = nowMs + 60_000;
  return ok;
}

/** Tests only. */
export function __resetBrickLinkMeter(): void {
  prepaid = [];
  exhaustedUntil = 0;
}
