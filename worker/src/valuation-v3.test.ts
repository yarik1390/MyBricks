import { describe, expect, it } from 'vitest';
import { buildEbaySoldUpdate } from './lib/ebay';
import { isExactPriceChartingMatch } from './lib/pricecharting';
import {
  buildForecastV3,
  legacySignalsFor,
  valueSignalsV3,
  type PricingSignal,
} from './lib/valuation-v3';
import { GOLDEN_PRICING_CASES } from './fixtures/pricing-golden';
import { PRICING_WRITE_LIMITS, PRICING_WRITE_REFERENCE_PLAN, projectPricingWrites30d } from './lib/pricing-budget';
import { holdingValueForRollout, pricingV3ReadEnabled } from './lib/market-sources';

const now = new Date().toISOString();
const sold = (
  source: string,
  family: string,
  value: number,
  sampleCount: number,
  condition: PricingSignal['condition'] = 'new_sealed',
): PricingSignal => ({
  source,
  provider_family: family,
  condition,
  signal_type: 'sold',
  currency: 'USD',
  value,
  sample_count: sampleCount,
  source_observed_at: now,
  checked_at: now,
  match_status: 'verified',
});

describe('investment-grade valuation v3', () => {
  it('earns high confidence only from two independent fresh sold families', () => {
    const result = valueSignalsV3('new_sealed', [
      sold('bricklink_new', 'bricklink', 100, 5),
      sold('ebay_sold_new', 'ebay_market', 108, 3),
    ]);
    expect(result.fair_value).toBe(100);
    expect(result.confidence).toBe('high');
    expect(result.independent_family_count).toBe(2);
    expect(result.sample_count).toBe(8);
  });

  it('collapses eBay and PriceCharting into one family and never yields high', () => {
    const result = valueSignalsV3('new_sealed', [
      sold('ebay_sold_new', 'ebay_market', 100, 7),
      sold('pricecharting', 'ebay_market', 104, 12),
    ]);
    expect(result.confidence).toBe('medium');
    expect(result.independent_family_count).toBe(1);
    expect(result.sample_count).toBe(12);
  });

  it('keeps asking-only data out of fair and liquidation values', () => {
    const result = valueSignalsV3('new_sealed', [{
      ...sold('ebay_asking', 'ebay_market', 180, 12),
      signal_type: 'asking',
    }]);
    expect(result.fair_value).toBeNull();
    expect(result.liquidation_value).toBeNull();
    expect(result.flags).toContain('asking_only');
  });

  it('uses a robust family median and flags extreme disagreement', () => {
    const result = valueSignalsV3('new_sealed', [
      sold('bricklink_new', 'bricklink', 100, 8),
      sold('ebay_sold_new', 'ebay_market', 110, 8),
      sold('other_sold', 'other_market', 1000, 8),
    ]);
    expect(result.fair_value).toBe(110);
    expect(result.confidence).toBe('low');
    expect(result.flags).toContain('source_conflict');
  });

  it('never reads legacy PriceCharting complete as sealed or used evidence', () => {
    const signals = legacySignalsFor({
      pc_new_value: 200,
      pc_complete_value: 150,
      pc_cached_at: now,
      valuation_method: 'market',
    });
    expect(signals).toHaveLength(0);
  });

  it('rebases an external forecast to the current fair value', () => {
    const state = valueSignalsV3('new_sealed', [sold('bricklink_new', 'bricklink', 100, 8)]);
    const forecast = buildForecastV3(state, {}, { twoYear: 300, sourceBaseline: 200, asOf: now });
    expect(forecast.status).toBe('external');
    expect(forecast.base_value).toBe(100);
    expect(forecast.base).toBe(150);
  });

  it('does not make a stale eBay value fresh when refresh returns no data', () => {
    expect(buildEbaySoldUpdate({} as D1Database, '75192-1', {
      source: 'marketplace_insights', status: 'no_data',
      new_value: null, used_value: null, new_sample_count: 0, used_sample_count: 0,
    })).toBeNull();
  });
});

describe('PriceCharting identity regressions', () => {
  it('never maps Finch Dallow #75188 to the standard 75188-1 set', () => {
    expect(isExactPriceChartingMatch(
      '75188-1',
      'Resistance Bomber',
      'LEGO Star Wars Finch Dallow Resistance Bomber #75188',
    )).toBe(false);
  });

  it('accepts an exact set-number and normalized-title match', () => {
    expect(isExactPriceChartingMatch(
      '10300-1',
      'Back to the Future Time Machine',
      'LEGO Back to the Future Time Machine #10300',
    )).toBe(true);
  });
});

describe('100-case pricing golden dataset', () => {
  it('covers the required risk categories with deterministic outcomes', () => {
    expect(GOLDEN_PRICING_CASES).toHaveLength(110);
    expect(new Set(GOLDEN_PRICING_CASES.map(c => c.set_num)).size).toBe(110);

    for (const [index, golden] of GOLDEN_PRICING_CASES.entries()) {
      const price = 80 + index;
      if (golden.scenario === 'identity_collision') {
        const result = valueSignalsV3('new_sealed', [{ ...sold('bricklink_new', 'bricklink', price, 8), match_status: 'quarantined' }]);
        expect(result.fair_value, golden.set_num).toBeNull();
        expect(result.flags, golden.set_num).toContain('identity_unverified');
      } else if (golden.scenario === 'asking_only') {
        const result = valueSignalsV3('new_sealed', [{ ...sold('retail_offer', 'retail', price, 10), signal_type: 'asking' }]);
        expect(result.fair_value, golden.set_num).toBeNull();
        expect(result.flags, golden.set_num).toContain('asking_only');
      } else if (golden.scenario === 'healthy_market') {
        const result = valueSignalsV3('new_sealed', [
          sold('bricklink_new', 'bricklink', price, 5),
          sold('ebay_sold_new', 'ebay_market', price * 1.05, 3),
        ]);
        expect(result.confidence, golden.set_num).toBe('high');
      } else if (golden.scenario === 'single_market' || golden.scenario === 'low_liquidity') {
        const result = valueSignalsV3('new_sealed', [sold('bricklink_new', 'bricklink', price, 5)]);
        expect(result.confidence, golden.set_num).toBe('medium');
        expect(result.liquidation_value, golden.set_num).toBeLessThan(result.fair_value!);
      } else if (golden.scenario === 'thin_market') {
        const result = valueSignalsV3('new_sealed', [sold('ebay_sold_new', 'ebay_market', price, 2)]);
        expect(result.fair_value, golden.set_num).toBeNull();
        expect(result.flags, golden.set_num).toContain('insufficient_sample');
      } else if (golden.scenario === 'history_spike') {
        const result = valueSignalsV3('new_sealed', [sold('bricklink_new', 'bricklink', price * 3, 5)], { recentMedian: price, points: 12 });
        expect(result.confidence, golden.set_num).toBe('low');
        expect(result.flags, golden.set_num).toContain('history_anomaly');
      } else if (golden.scenario === 'condition_divergence') {
        const signals = [
          sold('bricklink_new', 'bricklink', price * 2, 5, 'new_sealed'),
          sold('bricklink_used', 'bricklink', price, 5, 'used_complete'),
        ];
        expect(valueSignalsV3('new_sealed', signals).fair_value, golden.set_num).toBe(price * 2);
        expect(valueSignalsV3('used_complete', signals).fair_value, golden.set_num).toBe(price);
      }
    }
  });
});

describe('D1 pricing write plan', () => {
  it('stays under both the pricing pipeline and operational monthly targets', () => {
    const projected = projectPricingWrites30d(PRICING_WRITE_REFERENCE_PLAN);
    expect(projected).toBeLessThan(PRICING_WRITE_LIMITS.pricing_pipeline_monthly);
    expect(projected).toBeLessThan(PRICING_WRITE_LIMITS.operational_30d);
  });
});

describe('pricing v3 rollout consistency', () => {
  const holding = {
    set_num: '75192-1', condition: 'used_good', quantity: 1,
    blended_value: 800, ebay_used_value: 600,
    v3_new_fair: 900, v3_used_fair: 650,
  };

  it('uses one condition-aware chain at 0% and 100%', () => {
    expect(holdingValueForRollout(holding, 0)).toBe(600);
    expect(holdingValueForRollout(holding, 100)).toBe(650);
  });

  it('assigns partial rollout deterministically by set number', () => {
    const first = pricingV3ReadEnabled(holding.set_num, 10);
    expect(pricingV3ReadEnabled(holding.set_num, 10)).toBe(first);
    expect(pricingV3ReadEnabled(holding.set_num, 0)).toBe(false);
    expect(pricingV3ReadEnabled(holding.set_num, 100)).toBe(true);
  });
});
