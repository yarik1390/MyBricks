import { afterEach, describe, expect, it } from 'vitest';
import { enrichSetRecord, resetSourceWeightMultipliers, setSourceWeightMultipliers } from './lib/market-sources';

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
