import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Server-key AI usage + cost ledger (Phase 3 #3/#4).
//
// Tracks ONLY the AI calls WE pay for: the valuation cron's server-key Gemini/
// OpenRouter/OpenAI calls and the shared-key photo-scan fallback. BYOK calls
// (user-supplied Gemini/OpenAI keys) bill to the user, go DIRECT to the provider
// (not through our gateway), and are intentionally excluded.
//
// The daily ledger feeds (a) the admin AI-usage panel and (b) an anomaly status
// (ok/warn/over) the panel + the weekly Pricing Sentinel read to alert before the
// Cloudflare AI Gateway $1/day spend cap (the real ceiling) is reached.
//
// Every helper FAILS OPEN: usage bookkeeping must never break a valuation run.
// ---------------------------------------------------------------------------

// $/1M tokens. SERVER-key models only. Unknown/free models resolve to $0 (calls
// are still counted). Keep in sync with MODELS in llm.ts.
export const AI_PRICES: Record<string, { in: number; out: number }> = {
  'gemini-2.5-flash': { in: 0.30, out: 2.50 },
  'gemini-2.5-flash-lite': { in: 0.10, out: 0.40 },
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'deepseek/deepseek-chat': { in: 0.14, out: 0.28 },
};

// Mirrors the Cloudflare AI Gateway $1/day spend cap (the real ceiling).
export const AI_DAILY_BUDGET_USD = 1;
// Anomaly status flips to "warn" at this fraction of the daily budget.
const WARN_FRACTION = 0.5;

export function isFreeModel(model: string): boolean {
  return /:free$/.test(model) || model === 'openrouter/free';
}

export function estimateCostUsd(model: string, inTokens: number, outTokens: number): number {
  if (isFreeModel(model)) return 0;
  const p = AI_PRICES[model];
  if (!p) return 0;
  return (Math.max(0, inTokens) / 1e6) * p.in + (Math.max(0, outTokens) / 1e6) * p.out;
}

// UTC day key, matching api_quota's quotaDay().
export function aiUsageDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

interface OpenAIUsageLike { prompt_tokens?: number; completion_tokens?: number }

export interface AiUsageEntry {
  provider: string;
  model: string;
  calls: number;
  inTokens: number;
  outTokens: number;
  costUsd: number;
}

// In-run accumulator: tally per (provider, model) during a batch and flush ONCE at
// the end (keeps the cron subrequest-lean — a single D1 batch write, not per-call).
export function createAiUsageAccumulator() {
  const map = new Map<string, AiUsageEntry>();
  return {
    record(provider: string, model: string, usage?: OpenAIUsageLike | null): void {
      const inTokens = Math.max(0, Math.round(usage?.prompt_tokens ?? 0));
      const outTokens = Math.max(0, Math.round(usage?.completion_tokens ?? 0));
      const key = `${provider}::${model}`;
      const cur = map.get(key) ?? { provider, model, calls: 0, inTokens: 0, outTokens: 0, costUsd: 0 };
      cur.calls += 1;
      cur.inTokens += inTokens;
      cur.outTokens += outTokens;
      cur.costUsd += estimateCostUsd(model, inTokens, outTokens);
      map.set(key, cur);
    },
    entries(): AiUsageEntry[] { return [...map.values()]; },
    totalCostUsd(): number { return [...map.values()].reduce((sum, e) => sum + e.costUsd, 0); },
  };
}
export type AiUsageAccumulator = ReturnType<typeof createAiUsageAccumulator>;

// The ai_usage table isn't in the load-bearing deploy migration array (the
// workflow file is not editable here), so create it lazily and idempotently.
async function ensureAiUsageTable(env: Env): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage (
    day TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0,
    in_tokens INTEGER NOT NULL DEFAULT 0,
    out_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (day, provider, model)
  )`).run();
}

// Flush accumulated AI usage into the daily ledger. Fails open.
export async function flushAiUsage(env: Env, entries: AiUsageEntry[]): Promise<void> {
  const rows = entries.filter(e => e.calls > 0);
  if (!rows.length) return;
  const day = aiUsageDay();
  try {
    await ensureAiUsageTable(env);
    await env.DB.batch(rows.map(e => env.DB.prepare(`
      INSERT INTO ai_usage (day, provider, model, calls, in_tokens, out_tokens, cost_usd, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
      ON CONFLICT(day, provider, model) DO UPDATE SET
        calls = calls + ?4,
        in_tokens = in_tokens + ?5,
        out_tokens = out_tokens + ?6,
        cost_usd = cost_usd + ?7,
        updated_at = datetime('now')
    `).bind(day, e.provider, e.model, e.calls, e.inTokens, e.outTokens, Math.round(e.costUsd * 1e6) / 1e6)));
  } catch (e) {
    console.warn('[ai-usage] flush failed open:', (e as Error).message);
  }
}

// One-shot record+flush for single-request callers (e.g. the shared-key scan
// fallback), where the batch-accumulator pattern doesn't apply.
export async function recordAiUsage(
  env: Env,
  provider: string,
  model: string,
  usage?: OpenAIUsageLike | null,
): Promise<void> {
  const acc = createAiUsageAccumulator();
  acc.record(provider, model, usage);
  await flushAiUsage(env, acc.entries());
}

export interface AiSpendStatus {
  day: string;
  total_usd: number;
  budget_usd: number;
  pct: number;
  status: 'ok' | 'warn' | 'over';
  free_calls: number;
  paid_calls: number;
}

export interface AiUsageModelRow {
  provider: string;
  model: string;
  calls: number;
  in_tokens: number;
  out_tokens: number;
  cost_usd: number;
  free: boolean;
}

export interface AiUsageReport {
  spend: AiSpendStatus;
  by_model: AiUsageModelRow[];
  recent: Array<{ day: string; calls: number; cost_usd: number }>;
}

function buildSpendStatus(totalUsd: number, freeCalls: number, paidCalls: number, day: string): AiSpendStatus {
  const pct = AI_DAILY_BUDGET_USD > 0 ? Math.round((totalUsd / AI_DAILY_BUDGET_USD) * 1000) / 10 : 0;
  const status: AiSpendStatus['status'] = totalUsd >= AI_DAILY_BUDGET_USD
    ? 'over'
    : totalUsd >= AI_DAILY_BUDGET_USD * WARN_FRACTION
      ? 'warn'
      : 'ok';
  return {
    day,
    total_usd: Math.round(totalUsd * 1e6) / 1e6,
    budget_usd: AI_DAILY_BUDGET_USD,
    pct,
    status,
    free_calls: freeCalls,
    paid_calls: paidCalls,
  };
}

// Lightweight single-query today's-spend status — used by the cron for a post-run
// anomaly log and by the weekly Pricing Sentinel. Fails open to a zeroed status.
export async function getAiSpendStatus(env: Env): Promise<AiSpendStatus> {
  const day = aiUsageDay();
  try {
    const row = await env.DB.prepare(`
      SELECT
        COALESCE(SUM(cost_usd), 0) AS total_usd,
        COALESCE(SUM(CASE WHEN model LIKE '%:free' THEN calls ELSE 0 END), 0) AS free_calls,
        COALESCE(SUM(CASE WHEN model LIKE '%:free' THEN 0 ELSE calls END), 0) AS paid_calls
      FROM ai_usage WHERE day = ?1
    `).bind(day).first<{ total_usd: number; free_calls: number; paid_calls: number }>();
    return buildSpendStatus(Number(row?.total_usd || 0), Number(row?.free_calls || 0), Number(row?.paid_calls || 0), day);
  } catch (e) {
    console.warn('[ai-usage] spend read failed:', (e as Error).message);
    return buildSpendStatus(0, 0, 0, day);
  }
}

// Full report for the admin AI-usage panel: today's per-model rows + a 7-day
// daily-total trend + the anomaly status. Fails open to an empty report.
export async function getAiUsageReport(env: Env, days = 7): Promise<AiUsageReport> {
  const day = aiUsageDay();
  const empty: AiUsageReport = { spend: buildSpendStatus(0, 0, 0, day), by_model: [], recent: [] };
  try {
    const since = `-${Math.max(1, days) - 1} days`;
    const { results } = await env.DB.prepare(`
      SELECT day, provider, model, calls, in_tokens, out_tokens, cost_usd
      FROM ai_usage WHERE day >= date('now', ?1)
      ORDER BY day DESC, cost_usd DESC
    `).bind(since).all<{ day: string; provider: string; model: string; calls: number; in_tokens: number; out_tokens: number; cost_usd: number }>();
    const all = results ?? [];
    const byModel: AiUsageModelRow[] = all
      .filter(r => r.day === day)
      .map(r => ({
        provider: r.provider,
        model: r.model,
        calls: Number(r.calls || 0),
        in_tokens: Number(r.in_tokens || 0),
        out_tokens: Number(r.out_tokens || 0),
        cost_usd: Number(r.cost_usd || 0),
        free: isFreeModel(r.model),
      }));
    const recentMap = new Map<string, { day: string; calls: number; cost_usd: number }>();
    for (const r of all) {
      const cur = recentMap.get(r.day) ?? { day: r.day, calls: 0, cost_usd: 0 };
      cur.calls += Number(r.calls || 0);
      cur.cost_usd += Number(r.cost_usd || 0);
      recentMap.set(r.day, cur);
    }
    const recent = [...recentMap.values()].sort((a, b) => b.day.localeCompare(a.day));
    const todayTotal = byModel.reduce((sum, r) => sum + r.cost_usd, 0);
    const freeCalls = byModel.filter(r => r.free).reduce((sum, r) => sum + r.calls, 0);
    const paidCalls = byModel.filter(r => !r.free).reduce((sum, r) => sum + r.calls, 0);
    return { spend: buildSpendStatus(todayTotal, freeCalls, paidCalls, day), by_model: byModel, recent };
  } catch (e) {
    console.warn('[ai-usage] report read failed:', (e as Error).message);
    return empty;
  }
}
