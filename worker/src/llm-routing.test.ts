/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLlmRoutes, saveLlmRoutes, resolveRoute, providerConfigured,
  clearLlmRoutesCache, DEFAULT_LLM_ROUTES, LLM_WORKLOADS,
} from './lib/llm-routing';
import {
  isMergeBudgetExhausted, mergeReportedCostUsd, mergeMonthlyBudgetUsd,
  mergeBaseURL, mergeEnabled,
} from './lib/merge-gateway';
import { createAiUsageAccumulator, monthlyAiSpend } from './lib/ai-usage';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS app_settings').run();
  await db.prepare(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`).run();
  await db.prepare('DROP TABLE IF EXISTS ai_usage').run();
  await db.prepare(`CREATE TABLE ai_usage (
    day TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0, in_tokens INTEGER NOT NULL DEFAULT 0,
    out_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
    updated_at TEXT, PRIMARY KEY (day, provider, model))`).run();
  clearLlmRoutesCache();
}

const withKeys = (extra: Record<string, string> = {}) => ({
  ...(env as any),
  GEMINI_API_KEY: 'g', OPENROUTER_API_KEY: 'or', OPENAI_API_KEY: 'oa',
  MERGE_GATEWAY_API_KEY: 'mg_test', ...extra,
});

describe('llm-routing', () => {
  beforeEach(freshSchema);

  it('returns the default cascade for every workload when nothing is stored', async () => {
    const routes = await getLlmRoutes(env as any);
    expect(routes).toEqual(DEFAULT_LLM_ROUTES);
    for (const w of LLM_WORKLOADS) expect(routes[w].length).toBeGreaterThan(0);
  });

  it('places Merge behind every free tier but ahead of the metered backstop', async () => {
    const scan = DEFAULT_LLM_ROUTES.scan.map((s) => s.provider);
    const merge = scan.indexOf('merge');
    // free Gemini and the OpenRouter free pool come first...
    expect(scan.indexOf('gemini')).toBeLessThan(merge);
    expect(scan.indexOf('openrouter')).toBeLessThan(merge);
    // ...and the metered OpenAI backstop is last.
    expect(merge).toBeLessThan(scan.indexOf('openai'));
    expect(scan[scan.length - 1]).toBe('openai');
  });

  it('gives the advisor a free Gemini step ahead of any paid provider', async () => {
    // Regression guard: the advisor used to go straight to paid gpt-4o-mini for
    // every signed-in user without their own key.
    expect(DEFAULT_LLM_ROUTES.advisor[0].provider).toBe('gemini');
  });

  it('round-trips an admin edit and clears the memo', async () => {
    await saveLlmRoutes(env as any, {
      advisor: [
        { provider: 'merge', model: 'anthropic/claude-sonnet-4', enabled: true },
        { provider: 'openai', model: 'gpt-4o-mini', enabled: false },
      ],
    });
    const routes = await getLlmRoutes(env as any);
    expect(routes.advisor).toEqual([
      { provider: 'merge', model: 'anthropic/claude-sonnet-4', enabled: true },
      { provider: 'openai', model: 'gpt-4o-mini', enabled: false },
    ]);
    // Untouched workloads keep their defaults.
    expect(routes.scan).toEqual(DEFAULT_LLM_ROUTES.scan);
  });

  it('replaces a stored scan cascade containing production-proven dead models', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', ?)`)
      .bind(JSON.stringify({
        scan: [
          { provider: 'merge', model: 'openai/gpt-5.6-luna', enabled: true },
          { provider: 'gemini', model: 'gemini-3.6-flash', enabled: true },
          { provider: 'openrouter', model: '', enabled: true },
          { provider: 'openrouter', model: 'mistralai/mistral-small-3.2-24b-instruct', enabled: true },
          { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
        ],
      })).run();

    const routes = await getLlmRoutes(env as any);
    expect(routes.scan).toEqual(DEFAULT_LLM_ROUTES.scan);
  });

  it('drops steps naming an unknown provider rather than keeping a dead stop', async () => {
    await saveLlmRoutes(env as any, {
      listing: [
        { provider: 'not-a-provider', model: 'x', enabled: true },
        { provider: 'merge', model: 'openai/gpt-4o-mini', enabled: true },
      ],
    });
    const routes = await getLlmRoutes(env as any);
    expect(routes.listing).toEqual([{ provider: 'merge', model: 'openai/gpt-4o-mini', enabled: true }]);
  });

  it('treats an empty model as a live-pool marker for OpenRouter only', async () => {
    await saveLlmRoutes(env as any, {
      valuation: [
        { provider: 'openrouter', model: '', enabled: true },  // live free pool
        { provider: 'merge', model: '', enabled: true },       // meaningless -> dropped
      ],
    });
    const routes = await getLlmRoutes(env as any);
    expect(routes.valuation).toEqual([{ provider: 'openrouter', model: '', enabled: true }]);
  });

  it('falls back to the default when an edit validates to nothing', async () => {
    await saveLlmRoutes(env as any, { scan: [{ provider: 'nope', model: '' }] });
    const routes = await getLlmRoutes(env as any);
    expect(routes.scan).toEqual(DEFAULT_LLM_ROUTES.scan);
  });

  it('survives a corrupt stored row by serving defaults', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', '{{{not json')`).run();
    clearLlmRoutesCache();
    expect(await getLlmRoutes(env as any)).toEqual(DEFAULT_LLM_ROUTES);
  });

  it('resolveRoute drops disabled steps and providers with no key', async () => {
    await saveLlmRoutes(env as any, {
      scan: [
        { provider: 'gemini', model: 'gemini-2.5-flash', enabled: true },
        { provider: 'merge', model: 'openai/gpt-4o-mini', enabled: false },
        { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
      ],
    });
    // Only Gemini has a key here, so the OpenAI step is not a real fallback.
    const onlyGemini = { ...(env as any), GEMINI_API_KEY: 'g', OPENAI_API_KEY: '', MERGE_GATEWAY_API_KEY: '' };
    const steps = await resolveRoute(onlyGemini, 'scan');
    expect(steps.map((s) => s.provider)).toEqual(['gemini']);
  });

  it('providerConfigured treats a whitespace-only Merge key as absent', () => {
    expect(providerConfigured({ ...(env as any), MERGE_GATEWAY_API_KEY: '   ' }, 'merge')).toBe(false);
    expect(providerConfigured(withKeys(), 'merge')).toBe(true);
  });
});

describe('merge-gateway', () => {
  it('is OpenAI-compatible at the /v1/openai base', () => {
    expect(mergeBaseURL()).toBe('https://api-gateway.merge.dev/v1/openai');
  });

  it('is enabled only when a key is actually set', () => {
    expect(mergeEnabled({ ...(env as any), MERGE_GATEWAY_API_KEY: '' })).toBe(false);
    expect(mergeEnabled(withKeys())).toBe(true);
  });

  it('treats a hard-budget 402 and key rejections as exhaustion, not transients', () => {
    for (const s of [401, 402, 403]) expect(isMergeBudgetExhausted(s)).toBe(true);
    // 429/5xx are worth retrying and must NOT take the provider out.
    for (const s of [429, 500, 502, 503]) expect(isMergeBudgetExhausted(s)).toBe(false);
  });

  it('reads the real per-call cost, and returns null (not 0) when absent', () => {
    expect(mergeReportedCostUsd({ cost: 0.00219 })).toBe(0.00219);
    expect(mergeReportedCostUsd({ cost: 0 })).toBe(0);
    // A missing cost must not look like a free call — that would under-report
    // spend exactly when the budget meter matters.
    expect(mergeReportedCostUsd({ prompt_tokens: 10 })).toBeNull();
    expect(mergeReportedCostUsd(null)).toBeNull();
    expect(mergeReportedCostUsd({ cost: 'free' })).toBeNull();
    expect(mergeReportedCostUsd({ cost: -1 })).toBeNull();
  });

  it('defaults the monthly allowance to $10 and honours an override', () => {
    expect(mergeMonthlyBudgetUsd(env as any)).toBe(10);
    expect(mergeMonthlyBudgetUsd({ ...(env as any), MERGE_MONTHLY_BUDGET_USD: '25' })).toBe(25);
    expect(mergeMonthlyBudgetUsd({ ...(env as any), MERGE_MONTHLY_BUDGET_USD: 'abc' })).toBe(10);
    expect(mergeMonthlyBudgetUsd({ ...(env as any), MERGE_MONTHLY_BUDGET_USD: '-5' })).toBe(10);
  });
});

describe('ai-usage — measured vs estimated cost', () => {
  beforeEach(freshSchema);

  it('prefers a provider-reported cost over the price-table estimate', () => {
    const acc = createAiUsageAccumulator();
    // gpt-4o-mini estimate for these tokens would be ~0.00075; the reported
    // figure must win outright.
    acc.record('merge', 'openai/gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 1000 }, 0.0042);
    expect(acc.totalCostUsd()).toBe(0.0042);
  });

  it('falls back to the estimate when no cost is reported', () => {
    const acc = createAiUsageAccumulator();
    acc.record('openai', 'gpt-4o-mini', { prompt_tokens: 1_000_000, completion_tokens: 0 }, null);
    expect(acc.totalCostUsd()).toBeCloseTo(0.15, 6);
  });

  it('sums month-to-date spend for one provider only', async () => {
    const month = new Date().toISOString().slice(0, 7);
    await db.prepare(`INSERT INTO ai_usage (day, provider, model, calls, cost_usd) VALUES
      (?1, 'merge', 'a', 2, 1.50), (?1, 'merge', 'b', 1, 0.25), (?1, 'openai', 'c', 5, 9.00),
      ('2020-01-01', 'merge', 'a', 7, 99.00)`).bind(`${month}-05`).run();
    const spend = await monthlyAiSpend(env as any, 'merge');
    expect(spend.month).toBe(month);
    expect(spend.spent_usd).toBeCloseTo(1.75, 6);
    expect(spend.calls).toBe(3);
  });

  it('reads zero rather than "exhausted" when the ledger is unavailable', async () => {
    await db.prepare('DROP TABLE IF EXISTS ai_usage').run();
    const spend = await monthlyAiSpend(env as any, 'merge');
    expect(spend.spent_usd).toBe(0);
  });
});
