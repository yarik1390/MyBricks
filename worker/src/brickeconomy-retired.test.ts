import { afterEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import { app } from './index';
import { clearSourceConfigCache } from './lib/source-config';
import { enrichSetRecord, resetSourceWeightMultipliers, setSourceWeightMultipliers } from './lib/market-sources';
import { applyTestTables } from './test-schema';

// BrickEconomy is switched off in Admin > Source tuning (no licence). With the
// source at weight 0 its forecast must not seed the set page's growth scenario.
describe('BrickEconomy switched off', () => {
  afterEach(() => resetSourceWeightMultipliers());

  const row = {
    set_num: 'BE-OFF-1',
    valuation_method: 'market',
    current_value: 100,
    be_value_new: 100,
    be_forecast_2y: 200,
    be_cached_at: new Date().toISOString(),
  };

  it('uses the BrickEconomy forecast only while the source is on', () => {
    const on = enrichSetRecord({ ...row }) as any;
    expect(on.valuation.forecast.status).toBe('external');

    setSourceWeightMultipliers({ brickeconomy: 0 });
    const off = enrichSetRecord({ ...row }) as any;
    expect(off.valuation.forecast.status).not.toBe('external');
  });
});

// Request-path writers (populate-everything, set refresh) must blend with the
// admin source tuning too, not the code defaults, or a switched-off source
// comes back into stored valuations.
describe('source tuning on API requests', () => {
  afterEach(() => { resetSourceWeightMultipliers(); clearSourceConfigCache(); });

  it('loads the stored source config before any /api route runs', async () => {
    const db = (env as any).DB as D1Database;
    await applyTestTables(db, ['app_settings']);
    await db.prepare(`INSERT INTO app_settings (key, value) VALUES ('source_config', ?)`)
      .bind(JSON.stringify({ brickeconomy: { enabled: false } })).run();
    clearSourceConfigCache();

    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;
    await app.fetch(new Request('https://api.test/api/me'), env as any, ctx);

    const row = { set_num: 'BE-OFF-2', valuation_method: 'market', current_value: 100,
      be_value_new: 100, be_forecast_2y: 200, be_cached_at: new Date().toISOString() };
    expect((enrichSetRecord(row) as any).valuation.forecast.status).not.toBe('external');
  });
});
