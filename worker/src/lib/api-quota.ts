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
  bricklink: 4000,
  ebay: 4000,
  brickeconomy: 80,
  brickset: 90,
  brickowl: 1500,
  brightdata: 150,
  upcitemdb: 96,
  // Firecrawl is metered in CREDITS, not scrape-count (1 = basic/markdown/product,
  // 5 = json LLM extract). Plan is a one-time ~300k allotment then ~1,000/month,
  // so this is a per-DAY credit ceiling that guards against a runaway day. Raise
  // it for the one-time bootstrap via the FIRECRAWL_DAILY_CREDITS env var.
  firecrawl: 2000,
};

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
  let cap = QUOTA_CAPS[service];
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
  for (const [service, n] of entries) grants[service] = QUOTA_CAPS[service] ? 0 : n;
  const budgeted = entries.filter(([service]) => QUOTA_CAPS[service]);
  if (!budgeted.length) return grants;
  const day = quotaDay();
  try {
    await env.DB.batch(budgeted.map(([service]) => upsertRow(env, service, day, QUOTA_CAPS[service])));
    const placeholders = budgeted.map((_, i) => `?${i + 2}`).join(',');
    const { results } = await env.DB.prepare(
      `SELECT service, used, cap FROM api_quota WHERE day=?1 AND service IN (${placeholders})`
    ).bind(day, ...budgeted.map(([s]) => s)).all<{ service: string; used: number; cap: number }>();
    const rows = new Map(results.map(r => [r.service, r]));
    const updates: D1PreparedStatement[] = [];
    for (const [service, want] of budgeted) {
      const row = rows.get(service);
      const remaining = Math.max(0, (row?.cap ?? QUOTA_CAPS[service]) - (row?.used ?? 0));
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
  let cap = QUOTA_CAPS[service];
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
