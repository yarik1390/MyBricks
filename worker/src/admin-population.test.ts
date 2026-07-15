import { describe, expect, it } from 'vitest';
import { populationDone, populationRemainingNote } from './routes/admin-helpers';

function completeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    catalog_ready: true,
    minifigs_ready: true,
    pricing_v3_missing: 0,
    formula_bulk_count: 0,
    needs_market_refresh: 0,
    ebay_attempts_complete: true,
    barcode_pass_complete: true,
    total_sets: 27_000,
    total_minifigs: 17_000,
    ebay_new_attempted: 0,
    ebay_used_attempted: 0,
    quality: { missing_upc: 0 },
    ...overrides,
  } as any;
}

describe('production population completion', () => {
  it('keeps the campaign open while pricing v3 shadow rows are missing', () => {
    const snapshot = completeSnapshot({ pricing_v3_missing: 400 });
    expect(populationDone(snapshot)).toBe(false);
    expect(populationRemainingNote(snapshot)).toContain('pricing_v3_missing:400');
  });

  it('allows completion after the v3 shadow catalog is filled', () => {
    expect(populationDone(completeSnapshot())).toBe(true);
  });
});
