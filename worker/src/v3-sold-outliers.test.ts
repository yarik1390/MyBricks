import { describe, it, expect } from 'vitest';
import { valueSignalsV3, type PricingSignal } from './lib/valuation-v3';

const now = Date.now();
const checked = new Date(now - 24 * 3600 * 1000).toISOString();

function sig(overrides: Partial<PricingSignal> & Pick<PricingSignal, 'source' | 'provider_family' | 'signal_type' | 'value'>): PricingSignal {
  return {
    condition: 'new_sealed',
    currency: 'USD',
    match_status: 'verified',
    checked_at: checked,
    source_observed_at: checked,
    ...overrides,
  } as PricingSignal;
}

const ebaySold = (value: number, n: number) => sig({ source: 'ebay_sold_new', provider_family: 'ebay_market', signal_type: 'sold', value, sample_count: n });
const priceCharting = (value: number, n: number) => sig({ source: 'pricecharting_new', provider_family: 'ebay_market', signal_type: 'sold', value, sample_count: n });
const brickEconomy = (value: number) => sig({ source: 'brickeconomy_new', provider_family: 'brickeconomy', signal_type: 'modeled', value });

describe('v3 sold-comp outlier screen', () => {
  it('drops a mismatched PriceCharting comp that eBay sold and the model both contradict', () => {
    // 910046-1 Merchant Boat, live 2026-09-29: headline was $23.83.
    const state = valueSignalsV3('new_sealed', [ebaySold(232.5, 10), priceCharting(23.83, 79), brickEconomy(258.91)], {}, now);
    expect(state.fair_value).toBe(232.5);
    expect(state.flags).toContain('sold_outlier_rejected');
  });

  it('drops contaminated eBay "new" sales that everything else contradicts', () => {
    // 10212-1 Imperial Shuttle: 3 eBay sales at $375 vs ~$1,800-$2,000 elsewhere.
    const state = valueSignalsV3('new_sealed', [ebaySold(375, 3), priceCharting(1800, 30), brickEconomy(1999)], {}, now);
    expect(state.fair_value).toBe(1800);
    expect(state.flags).toContain('sold_outlier_rejected');
  });

  it('keeps both comps but reads low confidence when nothing can break the tie', () => {
    const state = valueSignalsV3('new_sealed', [ebaySold(200, 5), priceCharting(4122.61, 76)], {}, now);
    expect(state.flags).not.toContain('sold_outlier_rejected');
    expect(state.flags).toContain('source_conflict');
    expect(state.confidence).toBe('low');
  });

  it('does not treat a formula estimate as a witness', () => {
    const formula = sig({ source: 'formula', provider_family: 'formula', signal_type: 'estimate', value: 180 });
    const state = valueSignalsV3('new_sealed', [ebaySold(200, 5), priceCharting(4122.61, 76), formula], {}, now);
    expect(state.flags).not.toContain('sold_outlier_rejected');
  });

  it('leaves agreeing comps alone', () => {
    const state = valueSignalsV3('new_sealed', [ebaySold(700, 12), priceCharting(720, 40), brickEconomy(760)], {}, now);
    expect(state.flags).not.toContain('sold_outlier_rejected');
    expect(state.flags).not.toContain('source_conflict');
    expect(state.fair_value).toBeGreaterThanOrEqual(700);
    expect(state.fair_value).toBeLessThanOrEqual(720);
  });
});
