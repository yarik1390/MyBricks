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
  bricklink: 4500,
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
  // Amazon Creators API searchItems calls (plus ~1 token mint/hour). The API is
  // free but eligibility-gated; this cap bounds a runaway day, not the plan.
  amazon: 300,
  // Walmart/Target price lookups (jobs/store-offers.ts): one Firecrawl json
  // extraction (5 credits) per store per set, so 40/day = 200 credits/day.
  stores: 80,
  // Set description translations on the public /api/sets/:set/description
  // route with the shared Gemini key. Each result is cached per set+language,
  // so real traffic needs few; the cap stops a crawler walking the catalog.
  describe_translate: 600,
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

  for (const [service, rawWant] of Object.entries(wants)) {
    if (!Number.isFinite(rawWant)) continue;
    const want = Math.max(0, Math.floor(rawWant));
    if (want <= 0) continue;

    let cap = effectiveCap(service);
    if (service === 'firecrawl') {
      const override = Number(env.FIRECRAWL_DAILY_CREDITS);
      if (Number.isFinite(override) && override > 0) cap = override;
    }

    if (!cap) {
      grants[service] = want;
      continue;
    }

    grants[service] = 0;
    capped.push({ service, want, cap });
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
