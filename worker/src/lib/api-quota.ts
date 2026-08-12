import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Per-source daily external-API budget ledger (Pricing Engine v2.1, Phase 1c).
//
// Budgets are ~80% of each provider's hard cap so organic on-demand traffic
// and clock skew can never push us over a provider limit:
//   BrickLink 5,000/day · eBay 5,000/day · BrickEconomy 100/day (hard) ·
//   Brickset 100/day · BrickOwl 600/min (we self-impose a daily budget).
// The ledger lives in the api_quota D1 table keyed by (service, UTC day).
// Every helper FAILS OPEN: pricing must never stop because bookkeeping broke.
// ---------------------------------------------------------------------------

export const QUOTA_CAPS: Record<string, number> = {
  // BrickLink's hard cap is 5,000/day. Held at 90% rather than the ~80% used
  // elsewhere: BrickLink freshness is the binding constraint on high-confidence
  // valuations (of the sets with two independent sold families, only ~19% had
  // BOTH sources fresh), so the refresh lane needs the room. 500/day is still
  // reserved for organic on-demand revaluations and clock skew.
  bricklink: 4500,
  ebay: 4000,
  // Apify eBay actor search chains. The weekly lane reserves one unit per set;
  // keeping this modest also bounds paid actor/item spend if a cron is replayed.
  apify: 30,
  brickeconomy: 80,
  brickset: 90,
  brickowl: 1500,
  // PriceCharting per-set /api/product calls (the daily enrich cron). Free/cheap
  // tier but metered so admin usage is honest + a runaway is capped; the weekly
  // bulk CSV is a single download and is not counted here. Enrich runs ~40/day,
  // so this is generous headroom, not a throttle.
  pricecharting: 500,
  upcitemdb: 96,
  // Firecrawl is metered in CREDITS, not scrape-count (1 = basic/markdown/product,
  // 5 = json LLM extract). Plan is a one-time ~300k allotment then ~1,000/month,
  // so this is a per-DAY credit ceiling that guards against a runaway day. Raise
  // it for the one-time bootstrap via the FIRECRAWL_DAILY_CREDITS env var.
  //
  // Raised 2000 -> 4000: Firecrawl is now the fallback ENGINE for eBay-sold when
  // the Bright Data breaker opens (~40 sets x 5cr x 8 runs = 1,600/day) on top of
  // ~1,400/day of steady enrich + minifig traffic. At 2,000 the two would have
  // contended and the loser would silently skip its run.
  firecrawl: 4000,
  // pricesAPI.io daily ceiling. Each cold call is a precious unit against a
  // ~1000/month-per-key pooled budget, so keep the daily spend modest; the
  // per-key pool (pricesapi_keys) is the authoritative monthly meter.
  pricesapi: 60,
  // Amazon Creators API searchItems calls (plus ~1 token mint/hour). The API is
  // free but eligibility-gated; this cap bounds a runaway day, not the plan.
  amazon: 300,
  // StockX lowest-ask scrape (Firecrawl). Low daily cap: slow
  // rendered calls, corroborating-only, OFF by default.
  stockx: 100,
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
export async function spendQuota(env: Env, service: string, n = 1): Promise<boolean> {
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
    console.warn(`[quota] spend(${service}) failed open:`, (e as Error).message);
    return true;
  }
}

// Reserve budget for a whole batch run in at most three D1 round-trips no
// matter how many services are involved (cron runs must stay subrequest-lean).
// Each service is granted min(requested, remaining-today); unknown services
// are granted in full. Reservations are deliberately pessimistic — a set that
// resolves cheaper than reserved simply leaves a little budget unused.
export async function reserveQuota(
  env: Env,
  wants: Record<string, number>,
): Promise<Record<string, number>> {
  const entries = Object.entries(wants).filter(([, n]) => Number.isFinite(n) && n > 0);
  const grants: Record<string, number> = {};
  for (const [service, n] of entries) grants[service] = effectiveCap(service) ? 0 : n;
  const budgeted = entries.flatMap(([service, n]) => {
    const cap = effectiveCap(service);
    return cap ? [[service, n, cap] as const] : [];
  });
  if (!budgeted.length) return grants;
  const day = quotaDay();
  try {
    await env.DB.batch(budgeted.map(([service, , cap]) => upsertRow(env, service, day, cap)));
    const placeholders = budgeted.map((_, i) => `?${i + 2}`).join(',');
    const { results } = await env.DB.prepare(
      `SELECT service, used, cap FROM api_quota WHERE day=?1 AND service IN (${placeholders})`
    ).bind(day, ...budgeted.map(([s]) => s)).all<{ service: string; used: number; cap: number }>();
    const rows = new Map(results.map(r => [r.service, r]));
    const updates: D1PreparedStatement[] = [];
    for (const [service, want, configuredCap] of budgeted) {
      const row = rows.get(service);
      const remaining = Math.max(0, (row?.cap ?? configuredCap) - (row?.used ?? 0));
      const grant = Math.min(want, remaining);
      grants[service] = grant;
      if (grant > 0) {
        updates.push(env.DB.prepare(
          // Clamp at cap so a concurrent reserver can never push the ledger past
          // the provider cap (grant was computed from a prior read — see note above).
          "UPDATE api_quota SET used = MIN(cap, used + ?3), updated_at = datetime('now') WHERE service=?1 AND day=?2"
        ).bind(service, day, grant));
      }
    }
    if (updates.length) await env.DB.batch(updates);
    return grants;
  } catch (e) {
    console.warn('[quota] reserve failed open:', (e as Error).message);
    for (const [service, n] of budgeted) grants[service] = n;
    return grants;
  }
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
  brickEconomy: boolean;   // BE primary fetch + KV get/put
  supplemental: boolean;   // forced BrickLink used pricing + BrickOwl corroboration
  ebay: boolean;           // eBay sold comps (+ask refresh when stale)
  aiFallback: boolean;     // Gemini/OpenAI estimate when market sources miss
  progressWrites: boolean; // per-set import_runs progress UPDATE
}

// Conservative per-set subrequest cost (external fetches + KV + D1 writes).
export function perSetCost(p: PackProfile): number {
  let cost = 2;                          // supplement batch + valuation UPDATE (D1)
  if (p.progressWrites) cost += 1;       // import_runs progress UPDATE
  if (p.brickEconomy) cost += 2;         // BE fetch + KV (amortized hit/miss)
  cost += p.brickEconomy ? 2 : 5;        // BrickLink: fallback risk vs primary (2 fetches + KV)
  if (p.supplemental) cost += 4;         // BrickOwl lookup + price, extra BL used KV
  if (p.ebay) cost += 3;                 // OAuth amortized + sold search (+ask sometimes)
  if (p.aiFallback) cost += 1;           // one model call on market miss
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
