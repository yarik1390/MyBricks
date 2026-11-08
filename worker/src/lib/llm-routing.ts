import type { Env } from '../types';
import { MODELS } from './llm';
import { openCodexConfigured } from './opencodex';
import { blockedIntegrations } from './integration-health';
import { WORKERS_AI_SCAN_MODEL, workersAiConfigured } from './workers-ai';

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
// Merge Gateway was removed entirely on 2026-11-08 (allowance gone, key
// revoked). A stored step that still names 'merge' is not a known provider any
// more, so mergeSteps() drops it on read and the console never shows it.
export type LlmProvider = 'gemini' | 'opencodex' | 'openrouter' | 'openai' | 'workersai' | 'groq';
export const LLM_PROVIDERS: LlmProvider[] = ['gemini', 'opencodex', 'openrouter', 'openai', 'workersai', 'groq'];

/** Groq free-tier vision model for scans (OpenAI-compatible API, no training on API data). */
export const GROQ_SCAN_MODEL = 'qwen/qwen3.8-27b';
/** Paid Gemini key (AI Studio paid tier: not used for training). Same id the advisor already runs on. */
export const GEMINI_SCAN_MODEL = 'gemini-3.5-flash-lite';

/** Workloads that resolve their cascade through this config. */
export type LlmWorkload = 'scan' | 'shelf' | 'advisor' | 'valuation' | 'listing';
export const LLM_WORKLOADS: LlmWorkload[] = ['scan', 'shelf', 'advisor', 'valuation', 'listing'];

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
 * Default scan ordering is based on live image benchmarks, not paper pricing.
 * The free-first cascade was unreliable in production: Gemini could consume 7s
 * with an empty response and OpenRouter free models then 429, starving every
 * useful fallback. Volatile free pools remain after the bounded, measured
 * OpenCodex step.
 *
 * Merge was removed from both scan workloads on 2026-11-06: its free monthly
 * allowance is gone, so every Merge step was a paid or failing call.
 *
 * 2026-11-07 (legal review): scans no longer go through OpenCodex, which ran
 * on consumer subscription logins (against those providers' terms), or the
 * OpenRouter free pool (some free models log or train on requests, which is
 * wrong for user photos). Order: Workers AI Gemma 4 (free, daily-capped inside
 * Cloudflare's Neuron allocation) -> Groq free tier -> paid Gemini Flash-Lite
 * (about $0.001 a scan). None of these train on the photos.
 *
 * gpt-5.6-luna remains retired for scanning: repeated calls returned no usable
 * structured identification. Re-benchmark before changing these ids or order.
 */
export const DEFAULT_LLM_ROUTES: Record<LlmWorkload, RouteStep[]> = {
  // Vision. Fast measured primary -> accurate measured fallback -> best effort.
  scan: [
    { provider: 'workersai', model: WORKERS_AI_SCAN_MODEL, enabled: true },
    { provider: 'groq', model: GROQ_SCAN_MODEL, enabled: true },
    { provider: 'gemini', model: GEMINI_SCAN_MODEL, enabled: true },
  ],
  // Shelf Snap. Thorough multi-set vision -> accurate fallback -> best effort.
  shelf: [
    { provider: 'workersai', model: WORKERS_AI_SCAN_MODEL, enabled: true },
    { provider: 'groq', model: GROQ_SCAN_MODEL, enabled: true },
    { provider: 'gemini', model: GEMINI_SCAN_MODEL, enabled: true },
  ],
  // Free models back up the paid key; past the AI trial only they answer.
  advisor: [
    { provider: 'gemini', model: MODELS.advisor, enabled: true },
    { provider: 'groq', model: GROQ_SCAN_MODEL, enabled: true },
    { provider: 'workersai', model: WORKERS_AI_SCAN_MODEL, enabled: true },
    { provider: 'openai', model: MODELS.openaiFallback, enabled: true },
  ],
  valuation: [
    { provider: 'gemini', model: MODELS.valuation, enabled: true },
    { provider: 'openrouter', model: '', enabled: true },
    { provider: 'openrouter', model: MODELS.openrouterPaid, enabled: true },
    { provider: 'openai', model: MODELS.openaiFallback, enabled: true },
  ],
  listing: [
    { provider: 'gemini', model: MODELS.listing, enabled: true },
    { provider: 'groq', model: GROQ_SCAN_MODEL, enabled: true },
    { provider: 'workersai', model: WORKERS_AI_SCAN_MODEL, enabled: true },
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

const RETIRED_SCAN_MODELS = new Set([
  // Production scan-diagnose runs showed these consume the full per-step budget
  // without returning a usable identification. Stored admin routing outlives
  // code-default changes, so active occurrences are filtered at read time.
  'gemini:gemini-3.6-flash',
  // The pinned Antigravity model was deprecated upstream ("Gemini 3.5 Flash is
  // no longer available"); superseded by the brickvault-scan-vision combo.
  'omniroute:antigravity/gemini-3.5-flash-low',
  'omniroute:brickvault-scan-vision',
]);

/**
 * Providers never allowed in the scan / shelf cascades, whatever the stored
 * admin routing says. Merge's free allowance ran out (2026-11-06) and OpenAI is
 * paid per photo. OpenCodex (consumer subscription logins) and OpenRouter (free
 * models may log or train on photos) were removed on 2026-11-07 for legal and
 * privacy reasons. Stored routing outlives code defaults, so these providers
 * are stripped at read time.
 */
const SCAN_EXCLUDED_PROVIDERS = new Set<string>(['openai', 'opencodex', 'openrouter']);

function stripExcludedScanProviders(stored: unknown): unknown {
  if (!Array.isArray(stored)) return stored;
  return stored.filter((raw) => {
    if (!raw || typeof raw !== 'object') return true;
    const { provider } = raw as Record<string, unknown>;
    return !(typeof provider === 'string' && SCAN_EXCLUDED_PROVIDERS.has(provider));
  });
}

function staleProductionScanGeneration(stored: unknown): number {
  if (!Array.isArray(stored)) return 0;
  // Compared on the RAW stored steps: these generations name 'merge', which
  // mergeSteps() would already have dropped as an unknown provider.
  const normalized = stored.filter((raw) => raw && typeof raw === 'object').map((raw) => {
    const { provider, model, enabled } = raw as Record<string, unknown>;
    return { provider: String(provider), model: typeof model === 'string' ? model.trim() : '', enabled: enabled !== false };
  });
  const generations = [
    [
      'merge:google/gemini-3.5-flash-lite:true',
      'merge:openai/gpt-4o:true',
      'openrouter::true',
      'openai:gpt-4o-mini:true',
    ],
    [
      'merge:openai/gpt-5.6-luna:true',
      'gemini:gemini-3.6-flash:true',
      'openrouter::true',
      'openrouter:mistralai/mistral-small-3.2-24b-instruct:true',
      'openai:gpt-4o-mini:true',
    ],
    [
      'gemini:gemini-2.5-flash:true',
      'openrouter::true',
      'merge:openai/gpt-4o-mini:true',
      'openrouter:mistralai/mistral-small-3.2-24b-instruct:true',
      'openai:gpt-4o-mini:true',
    ],
  ];
  return generations.findIndex((stale) =>
    normalized.length === stale.length && normalized.every((step, index) =>
      `${step.provider}:${step.model}:${step.enabled}` === stale[index])) + 1;
}

function removeActiveRetiredScanModels(stored: unknown): unknown {
  if (!Array.isArray(stored)) return stored;
  if (staleProductionScanGeneration(stored) > 0) {
    return DEFAULT_LLM_ROUTES.scan.map((step) => ({ ...step }));
  }
  return stored.filter((raw) => {
    if (!raw || typeof raw !== 'object') return true;
    const { provider, model, enabled } = raw as Record<string, unknown>;
    if (enabled === false || typeof provider !== 'string' || typeof model !== 'string') return true;
    return !RETIRED_SCAN_MODELS.has(`${provider}:${model.trim()}`);
  });
}

function mergeAll(stored: Record<string, unknown> | null): Record<LlmWorkload, RouteStep[]> {
  const out = {} as Record<LlmWorkload, RouteStep[]>;
  for (const name of LLM_WORKLOADS) {
    const saved = (name === 'scan' || name === 'shelf')
      ? stripExcludedScanProviders(removeActiveRetiredScanModels(stored?.[name]))
      : stored?.[name];
    out[name] = mergeSteps(name, saved);
  }
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
  const steps = (routes[workload] ?? []).filter((step) => step.enabled && providerConfigured(env, step.provider));
  // Skip providers whose server key was just rejected (integration-health
  // pauses them). If that would leave nothing, keep the full route: a paused
  // provider is still a better answer than none.
  const blocked = await blockedIntegrations(env);
  if (!blocked.size) return steps;
  const live = steps.filter((step) => !blocked.has(step.provider));
  return live.length ? live : steps;
}

export function providerConfigured(env: Env, provider: LlmProvider): boolean {
  switch (provider) {
    case 'gemini': return !!env.GEMINI_API_KEY;
    case 'opencodex': return openCodexConfigured(env);
    case 'openrouter': return !!env.OPENROUTER_API_KEY;
    case 'openai': return !!env.OPENAI_API_KEY;
    case 'workersai': return workersAiConfigured(env);
    case 'groq': return !!(env.GROQ_API_KEY ?? '').trim();
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
