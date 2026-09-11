/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTestTables } from './test-schema';
import { quotaDay, setQuotaCapOverrides } from './lib/api-quota';
import { clearFeatureFlagsCache } from './lib/feature-flags';
import { clearSourceConfigCache } from './lib/source-config';

const mocks = vi.hoisted(() => ({
  fetchSetPricing: vi.fn(),
  fetchUsedPricing: vi.fn(),
  fetchBrickOwlPricing: vi.fn(),
  fetchEbaySoldPrices: vi.fn(),
  fetchEbayActiveListings: vi.fn(),
  callGeminiValuation: vi.fn(),
  completionCreate: vi.fn(),
}));

vi.mock('./lib/bricklink', () => ({
  fetchSetPricing: mocks.fetchSetPricing,
  fetchUsedPricing: mocks.fetchUsedPricing,
}));

vi.mock('./lib/brickowl-pricing', () => ({
  fetchBrickOwlPricing: mocks.fetchBrickOwlPricing,
}));

vi.mock('./lib/gemini', () => ({
  callGeminiValuation: mocks.callGeminiValuation,
}));

vi.mock('./lib/ebay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/ebay')>();
  return {
    ...actual,
    fetchEbaySoldPrices: mocks.fetchEbaySoldPrices,
    fetchEbayActiveListings: mocks.fetchEbayActiveListings,
  };
});

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mocks.completionCreate } };
  },
}));

import { runValuateSets } from './jobs/valuate-sets';

const db = (env as any).DB as D1Database;
const APPLIED_CAPS = ['bricklink', 'brickowl', 'ebay', 'gemini', 'openrouter', 'openai'] as const;
const BASE_OPTIONS = {
  scope: 'all' as const,
  includeMinifigs: false,
  limit: 10,
  sourceRetries: 0,
  sourceTimeoutMs: 100,
};
const BL_CREDS = {
  BRICKLINK_CONSUMER_KEY: 'ck',
  BRICKLINK_CONSUMER_SECRET: 'cs',
  BRICKLINK_TOKEN: 'tok',
  BRICKLINK_TOKEN_SECRET: 'ts',
};

async function seedSet(setNum: string, over: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    set_num: setNum,
    name: `Quota ${setNum}`,
    theme: 'Town',
    year: 2015,
    pieces: 500,
    minifigs: 0,
    retired: 0,
    retail_price: 100,
    current_value: 75,
    valuation_method: 'formula_bulk',
    valuation_expires_at: null,
    cached_at: null,
    ...over,
  };
  const keys = Object.keys(values);
  await db.prepare(
    `INSERT INTO lego_sets (${keys.join(',')}) VALUES (${keys.map((_, i) => `?${i + 1}`).join(',')})`,
  ).bind(...keys.map((key) => values[key])).run();
}

async function exhaust(service: string, cap = 1) {
  await db.prepare(
    'INSERT INTO api_quota (service, day, used, cap) VALUES (?1, ?2, ?3, ?3)',
  ).bind(service, quotaDay(), cap).run();
}

beforeEach(async () => {
  vi.clearAllMocks();
  clearFeatureFlagsCache();
  clearSourceConfigCache();
  setQuotaCapOverrides(Object.fromEntries(APPLIED_CAPS.map((service) => [service, null])));
  await applyTestTables(db, [
    'lego_sets',
    'set_market_ext',
    'user_collection',
    'user_wishlist',
    'api_quota',
    'integration_health',
    'app_settings',
  ]);
  mocks.fetchSetPricing.mockResolvedValue(null);
  mocks.fetchUsedPricing.mockResolvedValue(null);
  mocks.fetchBrickOwlPricing.mockResolvedValue(null);
  mocks.fetchEbaySoldPrices.mockResolvedValue({
    source: 'marketplace_insights',
    status: 'no_data',
    new_value: null,
    used_value: null,
    new_sample_count: 0,
    used_sample_count: 0,
  });
  mocks.fetchEbayActiveListings.mockResolvedValue(null);
  mocks.callGeminiValuation.mockResolvedValue(null);
  mocks.completionCreate.mockResolvedValue({
    choices: [{ message: { content: '' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
});

afterEach(() => {
  setQuotaCapOverrides(Object.fromEntries(APPLIED_CAPS.map((service) => [service, null])));
  vi.unstubAllGlobals();
});

describe('runValuateSets quota grant enforcement', () => {
  it('does no provider work at zero grant while still applying stored and local pricing', async () => {
    setQuotaCapOverrides({ bricklink: 1, brickowl: 1, ebay: 1, gemini: 1, openrouter: 1, openai: 1 });
    await Promise.all(['bricklink', 'brickowl', 'ebay', 'gemini', 'openrouter', 'openai'].map((service) => exhaust(service)));
    await seedSet('QZERO-BE', { be_value_new: 180 });
    await seedSet('QZERO-LOCAL', { pieces: 100, retail_price: 6, be_value_new: 10_000 });

    const result = await runValuateSets({
      ...env,
      CACHE_KV: undefined,
      ...BL_CREDS,
      BRICKOWL_ENABLED: '1',
      BRICKOWL_API_KEY: 'bo',
      ENVIRONMENT: 'test',
      EBAY_SOURCE_AUTHORIZED_FOR_TESTS: '1',
      EBAY_SOLD_COMPS_ENABLED: '1',
      EBAY_APP_ID: 'ebay',
      EBAY_CLIENT_SECRET: 'secret',
      GEMINI_API_KEY: 'gemini',
      OPENROUTER_API_KEY: 'or',
      OPENAI_API_KEY: 'openai',
    } as any, {
      ...BASE_OPTIONS,
      includeSupplemental: true,
      includeEbay: true,
      includeEbaySold: true,
      includeAiFallback: true,
    });

    const quotaRows = await db.prepare(
      `SELECT service, used FROM api_quota WHERE service IN ('bricklink','brickowl','ebay','gemini','openrouter','openai')`,
    ).all<{ service: string; used: number }>();
    expect(Object.fromEntries(quotaRows.results.map((row) => [row.service, row.used]))).toEqual({
      bricklink: 1,
      brickowl: 1,
      ebay: 1,
      gemini: 1,
      openrouter: 1,
      openai: 1,
    });
    expect(result.processed).toBe(2);
    expect(mocks.fetchSetPricing).not.toHaveBeenCalled();
    expect(mocks.fetchUsedPricing).not.toHaveBeenCalled();
    expect(mocks.fetchBrickOwlPricing).not.toHaveBeenCalled();
    expect(mocks.fetchEbaySoldPrices).not.toHaveBeenCalled();
    expect(mocks.fetchEbayActiveListings).not.toHaveBeenCalled();
    expect(mocks.callGeminiValuation).not.toHaveBeenCalled();
    expect(mocks.completionCreate).not.toHaveBeenCalled();

    const stored = await db.prepare("SELECT valuation_method, current_value FROM lego_sets WHERE set_num='QZERO-BE'")
      .first<{ valuation_method: string; current_value: number }>();
    expect(stored).toMatchObject({ valuation_method: 'brickeconomy', current_value: 180 });
    const local = await db.prepare("SELECT valuation_method, current_value FROM lego_sets WHERE set_num='QZERO-LOCAL'")
      .first<{ valuation_method: string; current_value: number }>();
    expect(local?.valuation_method).toBe('formula_bulk');
    expect(local?.current_value).toBeGreaterThan(0);
    expect(local?.current_value).toBeLessThan(1_000);
  });

  it('spends a one-unit BrickLink grant on NEW only and never retries the same path', async () => {
    setQuotaCapOverrides({ bricklink: 1 });
    await seedSet('QBL-1', { retired: 1, be_value_new: null });

    await runValuateSets({ ...env, CACHE_KV: undefined, ...BL_CREDS, GEMINI_API_KEY: '', OPENAI_API_KEY: '', OPENROUTER_API_KEY: '' } as any, {
      ...BASE_OPTIONS,
      includeSupplemental: true,
      includeEbay: false,
      includeEbaySold: false,
      includeAiFallback: false,
    });

    expect(mocks.fetchSetPricing).toHaveBeenCalledTimes(1);
    expect(mocks.fetchUsedPricing).not.toHaveBeenCalled();
    const quota = await db.prepare("SELECT used FROM api_quota WHERE service='bricklink' AND day=?")
      .bind(quotaDay()).first<{ used: number }>();
    expect(quota?.used).toBe(1);
  });

  it('does not start BrickOwl unless its two-call lookup/price grant is complete', async () => {
    setQuotaCapOverrides({ bricklink: 1, brickowl: 1 });
    await exhaust('bricklink');
    await seedSet('QBO-1', { be_value_new: 180 });

    await runValuateSets({
      ...env,
      CACHE_KV: undefined,
      ...BL_CREDS,
      BRICKOWL_ENABLED: '1',
      BRICKOWL_API_KEY: 'bo',
      GEMINI_API_KEY: '',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
    } as any, {
      ...BASE_OPTIONS,
      includeSupplemental: true,
      includeEbay: false,
      includeEbaySold: false,
      includeAiFallback: false,
    });

    expect(mocks.fetchBrickOwlPricing).not.toHaveBeenCalled();
    const quota = await db.prepare("SELECT used FROM api_quota WHERE service='brickowl' AND day=?")
      .bind(quotaDay()).first<{ used: number }>();
    expect(quota?.used).toBe(1);
  });

  it('uses a two-unit partial eBay grant for sold NEW/USED and skips ask', async () => {
    setQuotaCapOverrides({ bricklink: 1, ebay: 2, gemini: 1 });
    await Promise.all(['bricklink', 'gemini'].map((service) => exhaust(service)));
    await seedSet('QEBAY-1', { be_value_new: 180, ebay_ask_cached_at: null });

    await runValuateSets({
      ...env,
      CACHE_KV: undefined,
      ...BL_CREDS,
      ENVIRONMENT: 'test',
      EBAY_SOURCE_AUTHORIZED_FOR_TESTS: '1',
      EBAY_SOLD_COMPS_ENABLED: '1',
      EBAY_APP_ID: 'ebay',
      EBAY_CLIENT_SECRET: 'secret',
      GEMINI_API_KEY: 'gemini',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
    } as any, {
      ...BASE_OPTIONS,
      includeSupplemental: false,
      includeEbay: true,
      includeEbaySold: true,
      includeAiFallback: true,
    });

    expect(mocks.fetchEbaySoldPrices).toHaveBeenCalledTimes(1);
    expect(mocks.fetchEbayActiveListings).not.toHaveBeenCalled();
    expect(mocks.callGeminiValuation).not.toHaveBeenCalled();
    const quota = await db.prepare("SELECT used FROM api_quota WHERE service='ebay' AND day=?")
      .bind(quotaDay()).first<{ used: number }>();
    expect(quota?.used).toBe(2);
  });

  it('caps the OpenRouter model cascade at its partial grant', async () => {
    setQuotaCapOverrides({ bricklink: 1, gemini: 1, openrouter: 2 });
    await Promise.all(['bricklink', 'gemini'].map((service) => exhaust(service)));
    await seedSet('QAI-1', { be_value_new: null });

    await runValuateSets({
      ...env,
      CACHE_KV: undefined,
      ...BL_CREDS,
      GEMINI_API_KEY: 'gemini',
      OPENROUTER_API_KEY: 'or',
      OPENAI_API_KEY: '',
    } as any, {
      ...BASE_OPTIONS,
      includeSupplemental: false,
      includeEbay: false,
      includeEbaySold: false,
      includeAiFallback: true,
    });

    expect(mocks.callGeminiValuation).not.toHaveBeenCalled();
    expect(mocks.completionCreate).toHaveBeenCalledTimes(2);
    const quota = await db.prepare("SELECT used FROM api_quota WHERE service='openrouter' AND day=?")
      .bind(quotaDay()).first<{ used: number }>();
    expect(quota?.used).toBe(2);
  });

  it('uses the direct OpenAI fallback only while its grant remains', async () => {
    setQuotaCapOverrides({ bricklink: 1, gemini: 1, openai: 1 });
    await Promise.all(['bricklink', 'gemini'].map((service) => exhaust(service)));
    await seedSet('QOPENAI-1', { be_value_new: null });
    await seedSet('QOPENAI-2', { be_value_new: null });

    await runValuateSets({
      ...env,
      CACHE_KV: undefined,
      ...BL_CREDS,
      GEMINI_API_KEY: 'gemini',
      OPENROUTER_API_KEY: '',
      OPENAI_API_KEY: 'openai',
    } as any, {
      ...BASE_OPTIONS,
      includeSupplemental: false,
      includeEbay: false,
      includeEbaySold: false,
      includeAiFallback: true,
    });

    expect(mocks.callGeminiValuation).not.toHaveBeenCalled();
    expect(mocks.completionCreate).toHaveBeenCalledTimes(1);
    const quota = await db.prepare("SELECT used FROM api_quota WHERE service='openai' AND day=?")
      .bind(quotaDay()).first<{ used: number }>();
    expect(quota?.used).toBe(1);
  });
});
