/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getFeatureFlags,
  saveFeatureFlags,
  applyFeatureFlags,
  clearFeatureFlagsCache,
  flagOverride,
  FEATURE_FLAGS,
} from './lib/feature-flags';
import {
  ebaySoldCompsEnabled,
  brickInsightsEnabled,
  firecrawlEnabled,
} from './lib/pricing-flags';

const db = (env as any).DB as D1Database;

async function freshSchema() {
  await db.prepare('DROP TABLE IF EXISTS app_settings').run();
  await db.prepare(`CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`).run();
  clearFeatureFlagsCache();
}

// A env with all flag vars + secrets neutralised, so tests control the inputs.
function baseEnv(extra: Record<string, unknown> = {}): any {
  return {
    ...env,
    EBAY_SOLD_COMPS_ENABLED: undefined,
    BRICKOWL_ENABLED: undefined,
    BRICKINSIGHTS_ENABLED: undefined,
    FIRECRAWL_ENABLED: undefined,
    FIRECRAWL_API_KEY: undefined,
    FIRECRAWL_API_KEYS: undefined,
    PRICESAPI_ENABLED: undefined,
    PRICESAPI_API_KEY: undefined,
    PRICESAPI_API_KEYS: undefined,
    ...extra,
  };
}

describe('feature-flags', () => {
  beforeEach(freshSchema);

  it('falls back to env defaults when no override is stored', async () => {
    await applyFeatureFlags(baseEnv());
    expect(ebaySoldCompsEnabled(baseEnv())).toBe(false); // off by default
    expect(brickInsightsEnabled(baseEnv())).toBe(true); // on by default
  });

  it('a runtime override wins over the env default', async () => {
    await saveFeatureFlags(baseEnv(), { ebay_sold_comps: true, brickinsights: false });
    await applyFeatureFlags(baseEnv());
    expect(flagOverride('ebay_sold_comps')).toBe(true);
    expect(ebaySoldCompsEnabled(baseEnv())).toBe(true); // override turns it on
    expect(brickInsightsEnabled(baseEnv())).toBe(false); // override turns a default-on flag off
  });

  it('an override cannot bypass a missing-secret prerequisite', async () => {
    await saveFeatureFlags(baseEnv(), { firecrawl: true });
    await applyFeatureFlags(baseEnv());
    // No token -> still disabled despite the override.
    expect(firecrawlEnabled(baseEnv())).toBe(false);
    // With the prerequisite present, the override takes effect.
    expect(firecrawlEnabled(baseEnv({ FIRECRAWL_API_KEY: 'k' }))).toBe(true);
  });

  it('ignores non-boolean / unknown values and round-trips through the DB', async () => {
    await saveFeatureFlags(baseEnv(), { firecrawl: 'yes', brickowl: true, bogus: true });
    clearFeatureFlagsCache();
    const stored = await getFeatureFlags(baseEnv());
    expect(stored.brickowl).toBe(true);
    expect('firecrawl' in stored).toBe(false); // string 'yes' rejected
    expect('bogus' in stored).toBe(false); // unknown flag rejected
    expect(FEATURE_FLAGS).toContain('firecrawl');
  });
});
