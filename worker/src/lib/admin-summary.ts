import type { Env } from '../types';

// Admin start-page summary (GET /api/admin/summary). Every query fails open to
// zeros/empty: a missing table on a fresh database must not blank the page.

export interface AdminSummary {
  generated_at: string;
  users: { total: number; new_7d: number; new_30d: number; with_sets: number; sets_logged: number; wishlist_items: number };
  events_7d: Record<string, number>;
  /** Finished server-side scans by outcome, e.g. "image:hit:brickognize" (last 7 days). */
  scan_outcomes_7d: Array<{ detail: string; n: number }>;
  quota_yesterday: Array<{ service: string; used: number; cap: number }>;
  held_sets: { total: number; market_priced: number };
  catalog: { total: number; market_priced: number };
  feedback_open: number;
  contributions_pending: number;
}

async function first<T>(env: Env, sql: string): Promise<T | null> {
  try { return await env.DB.prepare(sql).first<T>(); } catch { return null; }
}

async function all<T>(env: Env, sql: string): Promise<T[]> {
  try { return (await env.DB.prepare(sql).all<T>()).results ?? []; } catch { return []; }
}

const n = (v: unknown) => Number(v || 0);

// Valuation methods that come from real sales/listings rather than a formula,
// an AI guess or BrickEconomy (no longer shown to users).
const MARKET_METHODS = `('market','ebay_sold')`;

export async function getAdminSummary(env: Env): Promise<AdminSummary> {
  const [users, coll, wish, events, outcomes, quota, held, catalog, feedback, contribs] = await Promise.all([
    first<{ total: number; new7: number; new30: number }>(env, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN created_at > datetime('now','-7 days') THEN 1 ELSE 0 END) AS new7,
             SUM(CASE WHEN created_at > datetime('now','-30 days') THEN 1 ELSE 0 END) AS new30
        FROM user_prefs`),
    first<{ users: number; items: number }>(env, `
      SELECT COUNT(DISTINCT user_id) AS users, COUNT(*) AS items FROM user_collection WHERE deleted_at IS NULL`),
    first<{ items: number }>(env, `SELECT COUNT(*) AS items FROM user_wishlist`),
    all<{ event: string; n: number }>(env, `
      SELECT event, SUM(count) AS n FROM client_metrics_daily WHERE day >= date('now','-6 days') GROUP BY event`),
    all<{ detail: string; n: number }>(env, `
      SELECT detail, SUM(count) AS n FROM client_metrics_daily
       WHERE day >= date('now','-6 days') AND event = 'scan_outcome' GROUP BY detail ORDER BY n DESC LIMIT 40`),
    all<{ service: string; used: number; cap: number }>(env, `
      SELECT service, used, cap FROM api_quota WHERE day = date('now','-1 day') ORDER BY service`),
    first<{ total: number; priced: number }>(env, `
      WITH held AS (
        SELECT set_num FROM user_collection WHERE deleted_at IS NULL
        UNION SELECT set_num FROM user_wishlist
      )
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN s.valuation_method IN ${MARKET_METHODS} THEN 1 ELSE 0 END) AS priced
        FROM held JOIN lego_sets s ON s.set_num = held.set_num`),
    first<{ total: number; priced: number }>(env, `
      SELECT COUNT(*) AS total,
             SUM(CASE WHEN valuation_method IN ${MARKET_METHODS} THEN 1 ELSE 0 END) AS priced
        FROM lego_sets`),
    first<{ open: number }>(env, `SELECT COUNT(*) AS open FROM app_feedback WHERE status = 'open'`),
    first<{ pending: number }>(env, `SELECT COUNT(*) AS pending FROM set_contributions WHERE status = 'pending'`),
  ]);
  const events_7d: Record<string, number> = {};
  for (const row of events) events_7d[row.event] = n(row.n);
  return {
    generated_at: new Date().toISOString(),
    users: {
      total: n(users?.total), new_7d: n(users?.new7), new_30d: n(users?.new30),
      with_sets: n(coll?.users), sets_logged: n(coll?.items), wishlist_items: n(wish?.items),
    },
    events_7d,
    scan_outcomes_7d: outcomes.map((o) => ({ detail: String(o.detail || ''), n: n(o.n) })),
    quota_yesterday: quota.map((q) => ({ service: q.service, used: n(q.used), cap: n(q.cap) })),
    held_sets: { total: n(held?.total), market_priced: n(held?.priced) },
    catalog: { total: n(catalog?.total), market_priced: n(catalog?.priced) },
    feedback_open: n(feedback?.open),
    contributions_pending: n(contribs?.pending),
  };
}
