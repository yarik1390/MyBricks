import { enrichSetRecord } from './lib/market-sources';
import { describe, it, expect } from 'vitest';

// Partner attribution payload (additive, read-side): the enricher must expose
// pricecharting_contributes / pricecharting_item_id without changing any
// pricing math, and the verified id must survive to the public payload.
describe('PriceCharting partner attribution payload', () => {
  const now = new Date().toISOString();
  const baseRow = {
    set_num: 'PC-1',
    valuation_method: 'market',
    bl_new_value: 100,
    bl_new_qty: 10,
    bl_cached_at: now,
  };

  it('marks contribution when a persisted v3 basis lists a pricecharting source', () => {
    const row = {
      ...baseRow,
      __valuation_new: {
        model_version: 'v3',
        fair_value: 102, low: 90, high: 120, confidence: 'medium',
        confidence_score: 50, sample_count: 12, independent_family_count: 2,
        basis: [
          { provider_family: 'ebay_market', sources: ['ebay_sold_new', 'pricecharting'], signal_type: 'sold', value: 105, sample_count: 8, fresh: true, identity_verified: true, trust_multiplier: 1 },
          { provider_family: 'bricklink', sources: ['bricklink_new'], signal_type: 'sold', value: 100, sample_count: 10, fresh: true, identity_verified: true },
        ],
        flags: [], as_of: now,
      },
      __pricecharting_item_id: '12809679',
    };
    const out = enrichSetRecord(row) as Record<string, unknown>;
    expect(out.pricecharting_contributes).toBe(true);
    expect(out.pricecharting_item_id).toBe('12809679');
  });

  it('does NOT mark contribution when no pricecharting source is in the basis', () => {
    const row = {
      ...baseRow,
      __valuation_new: {
        model_version: 'v3',
        fair_value: 100, low: 90, high: 115, confidence: 'high',
        confidence_score: 70, sample_count: 12, independent_family_count: 2,
        basis: [
          { provider_family: 'bricklink', sources: ['bricklink_new'], signal_type: 'sold', value: 100, sample_count: 10, fresh: true, identity_verified: true },
          { provider_family: 'ebay_market', sources: ['ebay_sold_new'], signal_type: 'sold', value: 100, sample_count: 10, fresh: true, identity_verified: true },
        ],
        flags: [], as_of: now,
      },
      __pricecharting_item_id: '12809679',
    };
    const out = enrichSetRecord(row) as Record<string, unknown>;
    expect(out.pricecharting_contributes).toBe(false);
    // The verified id is still additive metadata; the UI decides whether to show it.
    expect(out.pricecharting_item_id).toBe('12809679');
  });

  it('never leaks the private __pricecharting_item_id field into the payload', () => {
    const row = { ...baseRow, __pricecharting_item_id: '12809679' };
    const out = enrichSetRecord(row) as Record<string, unknown>;
    expect(out.__pricecharting_item_id).toBeUndefined();
    expect(out.pricecharting_item_id).toBe('12809679');
  });

  it('is null-safe without a mapping (guest/offline detail)', () => {
    const out = enrichSetRecord({ ...baseRow }) as Record<string, unknown>;
    expect(out.pricecharting_item_id).toBeNull();
    // legacy columns alone never imply contribution (quarantine preserved)
    expect(out.pricecharting_contributes).toBe(false);
  });
});