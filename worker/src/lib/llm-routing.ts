import type { Env } from '../types';
import { MODELS } from './llm';

// ---------------------------------------------------------------------------
// Admin-tunable LLM routing. One DB-backed row (app_settings['llm_routing'])
// holds, per workload, the ORDERED cascade of provider+model steps to try.
//
// This replaces four hardcoded cascades scattered across routes/scan.ts,
// routes/advisor.ts and the valuation cron. The point is that provider pricing
// and free-tier availability churn weekly: a model that was the cheapest
// working option in March is gone by June. Editing an ordered list in the admin
// console beats shipping a deploy to reorder an if-chain.
//
// Reads ALWAYS fall back to DEFAULT_LLM_ROUTES (= the behaviour that was
// hardcoded before), so a missing or corrupt row can never take AI offline. A
// short per-isolate memo keeps hot paths from re-reading the row per call —
// same lifecycle as source-config.ts.
// ---------------------------------------------------------------------------

/** Providers a route step can name. */
export type LlmProvider = 'gemini' | 'merge' | 'openrouter' | 'openai';
export const LLM_PROVIDERS: LlmProvider[] = ['gemini', 'merge', 'openrouter', 'openai'];

/** Workloads that resolve their cascade through this config. */
export type LlmWorkload = 'scan' | 'advisor' | 'valuation' | 'listing';
export const LLM_WORKLOADS: LlmWorkload[] = ['scan', 'advisor', 'valuation', 'listing'];

export interface RouteStep {
  provider: LlmProvider;
  /**
   * Model id. The empty string is meaningful and provider-specific:
   * for `openrouter` it means "expand the live free pool from KV here"
   * (the daily model-refresh cron keeps it current), so a pool step stays
   * correct without anyone editing it. For every other provider an empty
   * model is invalid and the step is dropped.
   */
  model: string;
  enabled: boolean;
}

/**
 * Defaults reproduce the previously-hardcoded cascades, with Merge inserted
 * ahead of the paid tiers — it bills against a fixed monthly allowance, so
 * spending it is strictly better than reaching the metered OpenAI backstop,
 * while still sitting behind anything free.
 *
 * Ordering principle, free -> allowance -> metered:
 *   gemini free tier  ->  openrouter free pool  ->  merge  ->  paid fallbacks
 *
 * The Merge steps name gpt-5.6-luna rather than gpt-4o-mini. Luna is dearer per
 * token ($0.20/$1.20 vs $0.15/$0.60) but multimodal and far more capable, and
 * these workloads are output-light — a 512-token advisor reply is a $0.0003
 * difference. Better identification also costs less overall by escalating the
 * cascade less often.
 */
export const DEFAULT_LLM_ROUTES: Record<LlmWorkload, RouteStep[]> = {
  // Vision. Merge step must name a multimodal model.
  scan: [
    { provider: 'gemini', model: MODELS.scan, enabled: true },
    { provider: 'openrouter', model: '', enabled: true },
    { provider: 'merge', model: 'openai/gpt-5.6-luna', enabled: true },
    { provider: 'openrouter', model: MODELS.scanOpenrouterPaid, enabled: true },
    { provider: 'openai', model: MODELS.openaiFallback, enabled: true },
  ],
  // Streaming chat. Server Gemini leads: the SSE path already exists for BYOK,
  // and the advisor previously went straight to paid gpt-4o-mini for every
  // signed-in user without their own key.
  advisor: [
    { provider: 'gemini', model: MODELS.advisor, enabled: true },
    { provider: 'merge', model: 'openai/gpt-5.6-luna', enabled: true },
    { provider: 'openai', model: MODELS.openaiFallback, enabled: true },
  ],
  valuation: [
    { provider: 'gemini', model: MODELS.valuation, enabled: true },
    { provider: 'openrouter', model: '', enabled: true },
    { provider: 'merge', model: 'openai/gpt-5.6-luna', enabled: true },
    { provider: 'openrouter', model: MODELS.openrouterPaid, enabled: true },
    { provider: 'openai', model: MODELS.openaiFallback, enabled: true },
  ],
  listing: [
    { provider: 'gemini', model: MODELS.listing, enabled: true },
    { provider: 'merge', model: 'openai/gpt-5.6-luna', enabled: true },
    { provider: 'openai', model: MODELS.openaiFallback, enabled: true },
  ],
};

const SETTINGS_KEY = 'llm_routing';
const MEMO_TTL_MS = 60_000;
const MAX_STEPS = 8;

let memo: Record<LlmWorkload, RouteStep[]> | null = null;
let memoAt = 0;

function isProvider(v: unknown): v is LlmProvider {
  return typeof v === 'string' && (LLM_PROVIDERS as string[]).includes(v);
}

/**
 * Coerce one stored workload entry into a valid step list. Anything
 * unrecognised is dropped rather than repaired: a step naming a provider we
 * cannot call is a silent dead stop in the cascade, which is worse than a
 * shorter list. An entry that validates to nothing falls back to the default.
 */
function mergeSteps(name: LlmWorkload, stored: unknown): RouteStep[] {
  if (!Array.isArray(stored)) return DEFAULT_LLM_ROUTES[name].map((s) => ({ ...s }));
  const out: RouteStep[] = [];
  for (const raw of stored.slice(0, MAX_STEPS)) {
    if (!raw || typeof raw !== 'object') continue;
    const { provider, model, enabled } = raw as Record<string, unknown>;
    if (!isProvider(provider)) continue;
    const id = typeof model === 'string' ? model.trim() : '';
    // Empty model is only meaningful as an OpenRouter live-pool marker.
    if (!id && provider !== 'openrouter') continue;
    out.push({ provider, model: id, enabled: enabled !== false });
  }
  return out.length ? out : DEFAULT_LLM_ROUTES[name].map((s) => ({ ...s }));
}

function mergeAll(stored: Record<string, unknown> | null): Record<LlmWorkload, RouteStep[]> {
  const out = {} as Record<LlmWorkload, RouteStep[]>;
  for (const name of LLM_WORKLOADS) out[name] = mergeSteps(name, stored?.[name]);
  return out;
}

/** Effective routing table (defaults deep-merged with stored overrides). Fail-open. */
export async function getLlmRoutes(env: Env): Promise<Record<LlmWorkload, RouteStep[]>> {
  if (memo && Date.now() - memoAt < MEMO_TTL_MS) return memo;
  let stored: Record<string, unknown> | null = null;
  try {
    const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key=?`)
      .bind(SETTINGS_KEY).first<{ value: string }>();
    if (row?.value) stored = JSON.parse(row.value);
  } catch { /* defaults */ }
  memo = mergeAll(stored);
  memoAt = Date.now();
  return memo;
}

/**
 * The ordered steps to actually attempt for a workload: disabled steps removed,
 * and steps whose provider has no key configured removed too — an unconfigured
 * provider is not a fallback, it is a no-op that wastes a cascade position.
 */
export async function resolveRoute(env: Env, workload: LlmWorkload): Promise<RouteStep[]> {
  const routes = await getLlmRoutes(env);
  return (routes[workload] ?? []).filter((step) => step.enabled && providerConfigured(env, step.provider));
}

export function providerConfigured(env: Env, provider: LlmProvider): boolean {
  switch (provider) {
    case 'gemini': return !!env.GEMINI_API_KEY;
    case 'merge': return !!(env.MERGE_GATEWAY_API_KEY ?? '').trim();
    case 'openrouter': return !!env.OPENROUTER_API_KEY;
    case 'openai': return !!env.OPENAI_API_KEY;
  }
}

/** Admin write: validate, persist, clear the memo. Returns the effective table. */
export async function saveLlmRoutes(env: Env, incoming: unknown): Promise<Record<LlmWorkload, RouteStep[]>> {
  const merged = mergeAll(
    incoming && typeof incoming === 'object' ? (incoming as Record<string, unknown>) : {},
  );
  await env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=datetime('now')`,
  ).bind(SETTINGS_KEY, JSON.stringify(merged)).run();
  memo = merged;
  memoAt = Date.now();
  return merged;
}

/** Clear the per-isolate memo (tests / after an out-of-band write). */
export function clearLlmRoutesCache(): void {
  memo = null;
  memoAt = 0;
}
