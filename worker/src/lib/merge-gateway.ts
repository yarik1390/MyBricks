import type { Env } from '../types';

/**
 * Merge Gateway — a second multi-provider LLM gateway alongside OpenRouter.
 *
 * Why it slots in cheaply: Merge exposes an OPENAI-COMPATIBLE surface at
 * `/v1/openai`, so it works with the same `new OpenAI({ apiKey, baseURL })`
 * client the OpenRouter path already uses. No new SDK, no new request shape.
 *
 * Two things it does that OpenRouter does not, and that the routing layer
 * relies on:
 *
 *  1. **Real billed cost per call.** Responses carry
 *     `usage.cost` in USD. Everywhere else we have to guess from a
 *     hand-maintained price table (`AI_PRICES` in ai-usage.ts), which drifts
 *     the moment a provider re-prices. Merge tells us what it actually
 *     charged, so Merge spend in the ledger is measured, not modelled.
 *
 *  2. **HTTP 402 on a hard budget.** A project budget set to "Hard Limit"
 *     blocks with 402 rather than silently draining. `isMergeBudgetExhausted`
 *     turns that into a definitive "skip this provider" signal for the cascade
 *     — distinct from a transient 5xx, which is worth retrying.
 *
 * NOTE ON BALANCE: Merge publishes spend in its dashboard, not over the API
 * (no documented /usage or /credits endpoint — and its /v1/* returns 401 for
 * every path, auth before routing, so absence can't be probed either). We
 * therefore meter locally: sum the reported `usage.cost` in `ai_usage` and
 * compare against the operator-set monthly cap. See `monthlyAiSpend`.
 */

const MERGE_BASE = 'https://api-gateway.merge.dev/v1';

/** OpenAI-compatible base URL — feed straight to `new OpenAI({ baseURL })`. */
export function mergeBaseURL(): string {
  return `${MERGE_BASE}/openai`;
}

/** Model-catalog endpoint. Undocumented in the quickstart; treated as optional. */
export function mergeModelsURL(): string {
  return `${MERGE_BASE}/models`;
}

export function configuredMergeKey(env: Env): string | null {
  const key = (env.MERGE_GATEWAY_API_KEY ?? '').trim();
  return key ? key : null;
}

export function mergeEnabled(env: Env): boolean {
  return configuredMergeKey(env) !== null;
}

/** Monthly USD ceiling the console meters against. Default matches the $10 plan. */
export function mergeMonthlyBudgetUsd(env: Env): number {
  const raw = Number((env.MERGE_MONTHLY_BUDGET_USD ?? '').trim());
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

/**
 * A hard-budget rejection (402) or a dead/rejected key (401/403). Both mean
 * "this provider is out for now" — the cascade should fall through rather than
 * retry. A 429 or 5xx is deliberately NOT included: those are transient.
 */
export function isMergeBudgetExhausted(status: number): boolean {
  return status === 401 || status === 402 || status === 403;
}

/**
 * Pull the REAL cost off a Merge response. The OpenAI SDK types don't know
 * about `usage.cost`, so it arrives as an untyped extra field.
 *
 * Returns null when absent so callers can fall back to `estimateCostUsd`
 * rather than silently record a spend of zero — a missing cost must never look
 * like a free call, or the budget meter reads low exactly when it matters.
 */
export function mergeReportedCostUsd(usage: unknown): number | null {
  if (!usage || typeof usage !== 'object') return null;
  const cost = (usage as { cost?: unknown }).cost;
  const n = Number(cost);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface MergeModel {
  id: string;
  provider?: string;
}

/**
 * Fetch Merge's model catalog. Best-effort: the endpoint is not in the
 * published quickstart, so a 404 here is an expected outcome, not a fault —
 * callers keep their last known-good list.
 */
export async function fetchMergeModels(env: Env, timeoutMs = 10_000): Promise<MergeModel[] | null> {
  const key = configuredMergeKey(env);
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(mergeModelsURL(), {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = await res.json<{ data?: unknown }>();
    const list = Array.isArray(body?.data) ? body.data : [];
    const models: MergeModel[] = [];
    for (const m of list) {
      const id = String((m as { id?: unknown })?.id ?? '').trim();
      if (!id) continue;
      // Merge ids are "provider/model"; keep the prefix as its own field so the
      // console can group the picker by provider.
      const entry: MergeModel = { id };
      if (id.includes('/')) entry.provider = id.slice(0, id.indexOf('/'));
      models.push(entry);
    }
    return models.length ? models : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
