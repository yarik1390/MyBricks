/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getLlmRoutes, saveLlmRoutes, resolveRoute, providerConfigured,
  clearLlmRoutesCache, DEFAULT_LLM_ROUTES, LLM_PROVIDERS, LLM_WORKLOADS,
} from './lib/llm-routing';
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
  OPENCODEX_API_KEY: 'oc_test', GROQ_API_KEY: 'gq_test', ...extra,
});

describe('llm-routing', () => {
  beforeEach(freshSchema);

  it('returns the default cascade for every workload when nothing is stored', async () => {
    const routes = await getLlmRoutes(env as any);
    expect(routes).toEqual(DEFAULT_LLM_ROUTES);
    for (const w of LLM_WORKLOADS) expect(routes[w].length).toBeGreaterThan(0);
  });

  it('defaults scan to free Workers AI, then free Groq, then paid Gemini Flash-Lite', () => {
    expect(DEFAULT_LLM_ROUTES.scan).toEqual([
      { provider: 'workersai', model: '@cf/google/gemma-4-26b-a4b-it', enabled: true },
      { provider: 'groq', model: 'qwen/qwen3.8-27b', enabled: true },
      { provider: 'gemini', model: 'gemini-3.5-flash-lite', enabled: true },
    ]);
    expect(DEFAULT_LLM_ROUTES.shelf).toEqual(DEFAULT_LLM_ROUTES.scan);
  });

  it('keeps scan and shelf off Merge, OpenAI, OpenCodex and OpenRouter', async () => {
    for (const w of ['scan', 'shelf'] as const) {
      const steps = DEFAULT_LLM_ROUTES[w].map((s) => s.provider);
      expect(steps[0]).toBe('workersai');
      for (const p of ['merge', 'openai', 'opencodex', 'openrouter']) expect(steps).not.toContain(p);
    }
  });

  it('strips stored OpenAI, OpenCodex and OpenRouter steps from scan and shelf', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', ?)`)
      .bind(JSON.stringify({
        scan: [
          { provider: 'opencodex', model: 'brickvault-scan-vision', enabled: true },
          { provider: 'openrouter', model: 'mistralai/mistral-small-3.2-24b-instruct', enabled: true },
          { provider: 'openrouter', model: 'google/gemma-4-31b-it:free', enabled: true },
          { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
        ],
        shelf: [
          { provider: 'openai', model: 'gpt-4o', enabled: true },
          { provider: 'workersai', model: '@cf/google/gemma-4-26b-a4b-it', enabled: true },
        ],
        advisor: [{ provider: 'openai', model: 'gpt-4o-mini', enabled: true }],
      })).run();
    clearLlmRoutesCache();
    const routes = await getLlmRoutes(env as any);
    // Every stored scan step is excluded, so scan falls back to the defaults.
    expect(routes.scan).toEqual(DEFAULT_LLM_ROUTES.scan);
    expect(routes.shelf.map((s) => s.provider)).toEqual(['workersai']);
    expect(routes.advisor.map((s) => s.provider)).toEqual(['openai']);
  });

  it('drops stored Merge steps from every workload (provider removed)', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', ?)`)
      .bind(JSON.stringify({
        scan: [
          { provider: 'merge', model: 'google/gemini-3.5-flash-lite', enabled: true },
          { provider: 'openrouter', model: '', enabled: true },
          { provider: 'merge', model: 'openai/gpt-4o', enabled: false },
        ],
        shelf: [
          { provider: 'merge', model: 'openai/gpt-4o', enabled: true },
        ],
        advisor: [
          { provider: 'merge', model: 'openai/gpt-4o-mini', enabled: true },
        ],
      })).run();

    const routes = await getLlmRoutes(env as any);
    expect(routes.scan).toEqual(DEFAULT_LLM_ROUTES.scan);
    expect(routes.shelf).toEqual(DEFAULT_LLM_ROUTES.shelf);
    expect(routes.advisor).toEqual(DEFAULT_LLM_ROUTES.advisor);
    for (const w of LLM_WORKLOADS) expect(routes[w].map((s) => s.provider)).not.toContain('merge');
  });

  it('never offers Merge as a provider', () => {
    expect(LLM_PROVIDERS as string[]).not.toContain('merge');
    for (const w of LLM_WORKLOADS) {
      expect(DEFAULT_LLM_ROUTES[w].map((s) => s.provider as string)).not.toContain('merge');
    }
  });

  it('gives the advisor a free Gemini step ahead of any paid provider', async () => {
    // Regression guard: the advisor used to go straight to paid gpt-4o-mini for
    // every signed-in user without their own key.
    expect(DEFAULT_LLM_ROUTES.advisor[0].provider).toBe('gemini');
  });

  it('round-trips an admin edit and clears the memo', async () => {
    await saveLlmRoutes(env as any, {
      advisor: [
        { provider: 'groq', model: 'llama-3.3-70b-versatile', enabled: true },
        { provider: 'openai', model: 'gpt-4o-mini', enabled: false },
      ],
    });
    const routes = await getLlmRoutes(env as any);
    expect(routes.advisor).toEqual([
      { provider: 'groq', model: 'llama-3.3-70b-versatile', enabled: true },
      { provider: 'openai', model: 'gpt-4o-mini', enabled: false },
    ]);
    // Untouched workloads keep their defaults.
    expect(routes.scan).toEqual(DEFAULT_LLM_ROUTES.scan);
  });

  it('replaces the exact stale production scan cascade with current defaults', async () => {
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

  it('migrates the previous default scan cascade to measured defaults', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', ?)`)
      .bind(JSON.stringify({
        scan: [
          { provider: 'gemini', model: 'gemini-2.5-flash', enabled: true },
          { provider: 'openrouter', model: '', enabled: true },
          { provider: 'merge', model: 'openai/gpt-4o-mini', enabled: true },
          { provider: 'openrouter', model: 'mistralai/mistral-small-3.2-24b-instruct', enabled: true },
          { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
        ],
      })).run();

    const routes = await getLlmRoutes(env as any);
    expect(routes.scan).toEqual(DEFAULT_LLM_ROUTES.scan);
  });

  it('removes active retired scan models while preserving valid admin policy', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', ?)`)
      .bind(JSON.stringify({
        scan: [
          { provider: 'workersai', model: '@cf/google/gemma-4-26b-a4b-it', enabled: false },
          { provider: 'merge', model: 'openai/gpt-5.6-luna', enabled: true },
          { provider: 'groq', model: 'qwen/qwen3.8-27b', enabled: true },
          { provider: 'gemini', model: 'gemini-3.6-flash', enabled: true },
          { provider: 'merge', model: 'openai/gpt-4o-mini', enabled: true },
        ],
      })).run();

    const routes = await getLlmRoutes(env as any);
    expect(routes.scan).toEqual([
      { provider: 'workersai', model: '@cf/google/gemma-4-26b-a4b-it', enabled: false },
      { provider: 'groq', model: 'qwen/qwen3.8-27b', enabled: true },
    ]);
  });

  it('retires the dead pinned OmniRoute scan model while preserving the rest of admin policy', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', ?)`)
      .bind(JSON.stringify({
        scan: [
          { provider: 'omniroute', model: 'antigravity/gemini-3.5-flash-low', enabled: true },
          { provider: 'merge', model: 'google/gemini-3.5-flash-lite', enabled: true },
          { provider: 'gemini', model: 'gemini-3.5-flash-lite', enabled: true },
        ],
      })).run();

    const routes = await getLlmRoutes(env as any);
    expect(routes.scan).toEqual([
      { provider: 'gemini', model: 'gemini-3.5-flash-lite', enabled: true },
    ]);
  });

  it('preserves disabled retired scan entries as explicit admin policy', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', ?)`)
      .bind(JSON.stringify({
        scan: [
          { provider: 'gemini', model: 'gemini-3.6-flash', enabled: false },
          { provider: 'groq', model: 'qwen/qwen3.8-27b', enabled: true },
          { provider: 'workersai', model: '@cf/google/gemma-4-26b-a4b-it', enabled: false },
        ],
      })).run();

    const routes = await getLlmRoutes(env as any);
    expect(routes.scan).toEqual([
      { provider: 'gemini', model: 'gemini-3.6-flash', enabled: false },
      { provider: 'groq', model: 'qwen/qwen3.8-27b', enabled: true },
      { provider: 'workersai', model: '@cf/google/gemma-4-26b-a4b-it', enabled: false },
    ]);
  });

  it('uses scan defaults only when removing retired active models leaves no route', async () => {
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('llm_routing', ?)`)
      .bind(JSON.stringify({
        scan: [
          { provider: 'merge', model: 'openai/gpt-5.6-luna', enabled: true },
          { provider: 'gemini', model: 'gemini-3.6-flash', enabled: true },
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
        { provider: 'groq', model: 'llama-3.3-70b-versatile', enabled: true },
      ],
    });
    const routes = await getLlmRoutes(env as any);
    expect(routes.listing).toEqual([{ provider: 'groq', model: 'llama-3.3-70b-versatile', enabled: true }]);
  });

  it('treats an empty model as a live-pool marker for OpenRouter only', async () => {
    await saveLlmRoutes(env as any, {
      valuation: [
        { provider: 'openrouter', model: '', enabled: true },  // live free pool
        { provider: 'groq', model: '', enabled: true },        // meaningless -> dropped
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
      advisor: [
        { provider: 'gemini', model: 'gemini-2.5-flash', enabled: true },
        { provider: 'groq', model: 'llama-3.3-70b-versatile', enabled: false },
        { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
      ],
    });
    // Only Gemini has a key here, so the OpenAI step is not a real fallback.
    const onlyGemini = { ...(env as any), GEMINI_API_KEY: 'g', OPENAI_API_KEY: '', GROQ_API_KEY: '' };
    const steps = await resolveRoute(onlyGemini, 'advisor');
    expect(steps.map((s) => s.provider)).toEqual(['gemini']);
  });

  it('resolveRoute skips a provider whose key was just rejected, but never empties the route', async () => {
    await db.prepare('DROP TABLE IF EXISTS integration_health').run();
    await db.prepare(`CREATE TABLE integration_health (service TEXT PRIMARY KEY, last_ok_at TEXT, last_fail_at TEXT,
      last_error TEXT, ok_count INTEGER DEFAULT 0, fail_count INTEGER DEFAULT 0, updated_at TEXT, blocked_until TEXT)`).run();
    await saveLlmRoutes(env as any, {
      advisor: [
        { provider: 'gemini', model: 'gemini-2.5-flash', enabled: true },
        { provider: 'openai', model: 'gpt-4o-mini', enabled: true },
      ],
    });
    const { recordIntegrationAttempt } = await import('./lib/integration-health');
    await recordIntegrationAttempt(withKeys() as any, 'gemini', false, 'HTTP 401');
    expect((await resolveRoute(withKeys() as any, 'advisor')).map((s) => s.provider)).toEqual(['openai']);
    // Only the paused provider left: keep it rather than return no route.
    expect((await resolveRoute(withKeys({ OPENAI_API_KEY: '' }) as any, 'advisor')).map((s) => s.provider)).toEqual(['gemini']);
    await db.prepare('DROP TABLE integration_health').run();
  });

  it('providerConfigured treats a whitespace-only Groq key as absent', () => {
    expect(providerConfigured({ ...(env as any), GROQ_API_KEY: '   ' }, 'groq')).toBe(false);
    expect(providerConfigured(withKeys(), 'groq')).toBe(true);
  });
});

describe('ai-usage — measured vs estimated cost', () => {
  beforeEach(freshSchema);

  it('prefers a provider-reported cost over the price-table estimate', () => {
    const acc = createAiUsageAccumulator();
    // gpt-4o-mini estimate for these tokens would be ~0.00075; the reported
    // figure must win outright.
    acc.record('openrouter', 'openai/gpt-4o-mini', { prompt_tokens: 1000, completion_tokens: 1000 }, 0.0042);
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
      (?1, 'gemini', 'a', 2, 1.50), (?1, 'gemini', 'b', 1, 0.25), (?1, 'openai', 'c', 5, 9.00),
      ('2020-01-01', 'gemini', 'a', 7, 99.00)`).bind(`${month}-05`).run();
    const spend = await monthlyAiSpend(env as any, 'gemini');
    expect(spend.month).toBe(month);
    expect(spend.spent_usd).toBeCloseTo(1.75, 6);
    expect(spend.calls).toBe(3);
  });

  it('reads zero rather than "exhausted" when the ledger is unavailable', async () => {
    await db.prepare('DROP TABLE IF EXISTS ai_usage').run();
    const spend = await monthlyAiSpend(env as any, 'gemini');
    expect(spend.spent_usd).toBe(0);
  });
});
