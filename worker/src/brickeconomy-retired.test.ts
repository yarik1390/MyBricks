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
    setSourceWeightMultipliers({ brickeconomy: 1 });
    const on = enrichSetRecord({ ...row }) as any;
    expect(on.valuation.forecast.status).toBe('external');

    setSourceWeightMultipliers({ brickeconomy: 0 });
    const off = enrichSetRecord({ ...row }) as any;
    expect(off.valuation.forecast.status).not.toBe('external');
  });

  it('is off when no source config was loaded (fail-closed)', () => {
    resetSourceWeightMultipliers();
    const out = enrichSetRecord({ ...row }) as any;
    expect(out.valuation.forecast.status).not.toBe('external');
    expect(out.forecast_2y).toBeNull();
  });

  it('never ships a BrickEconomy headline or the legacy growth-rule forecast', () => {
    resetSourceWeightMultipliers();
    // Scraped value, no blend of our own: the set reads "No market price".
    const lone = enrichSetRecord({ set_num: 'BE-ONLY', valuation_method: 'brickeconomy',
      current_value: 750, be_value_new: 750, forecast_2y: 820, forecast_5y: 990 }) as any;
    expect(lone.value_withheld).toBe(true);
    expect(lone.current_value).toBeNull();
    expect(lone.forecast_2y).toBeNull();
    // With our own sold evidence the headline is that, and current_value follows it.
    const now = new Date().toISOString();
    const sold = enrichSetRecord({ set_num: 'BE-SOLD', valuation_method: 'brickeconomy',
      current_value: 750, be_value_new: 750, blended_value: 220,
      ebay_new_value: 220, ebay_new_qty: 9, ebay_new_cached_at: now, forecast_2y: 820 }) as any;
    expect(sold.value_withheld).toBeFalsy();
    expect(sold.market_value).toBe(220);
    expect(sold.current_value).toBe(220);
    expect(sold.forecast_2y).toBeNull();
    expect(sold.primary_value_source).toBe('derived_market');
    expect(sold.market_sources.some((s: any) => s.id === 'brickeconomy')).toBe(false);
  });

  it('does not read the legacy forecast_2y as an external scenario', () => {
    resetSourceWeightMultipliers();
    const now = new Date().toISOString();
    const out = enrichSetRecord({ set_num: 'MKT-1', valuation_method: 'market', current_value: 200,
      ebay_new_value: 200, ebay_new_qty: 9, ebay_new_cached_at: now, forecast_2y: 264.5 }) as any;
    expect(out.valuation.forecast.status).toBe('insufficient_history');
    expect(out.forecast_2y).toBeNull();
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
