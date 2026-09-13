import { describe, expect, it } from 'vitest';
import {
  assessSoldObservation,
  boundedEvidence,
  selectEbaySoldReference,
} from './lib/ebay-sold-observations';

describe('eBay sold observation policy', () => {
  const now = Date.parse('2026-09-13T12:00:00Z');

  it('uses condition-matched fresh references with explicit provenance', () => {
    expect(selectEbaySoldReference({
      bl_new_value: 120,
      bl_used_qty: 8,
      used_value: 80,
      bl_cached_at: '2026-09-01T00:00:00Z',
    }, 'new_sealed', now)).toMatchObject({ value: 120, provenance: 'bricklink_new', freshness: 'fresh', strength: 'trusted' });
    expect(selectEbaySoldReference({
      bl_new_value: 120,
      bl_used_qty: 8,
      used_value: 80,
      bl_cached_at: '2026-09-01T00:00:00Z',
    }, 'used_complete', now)).toMatchObject({ value: 80, provenance: 'bricklink_used', freshness: 'fresh', strength: 'trusted' });
  });

  it('does not trust future, invalid, or missing reference timestamps', () => {
    const future = selectEbaySoldReference({ bl_new_value: 100, bl_cached_at: '2026-09-14T00:00:00Z' }, 'new_sealed', now);
    expect(future).toMatchObject({ freshness: 'stale', strength: 'weak' });

    const invalid = selectEbaySoldReference({ bl_new_value: 100, bl_cached_at: 'not-a-date' }, 'new_sealed', now);
    expect(invalid).toMatchObject({ freshness: 'stale', strength: 'weak' });

    const missing = selectEbaySoldReference({ bl_new_value: 100 }, 'new_sealed', now);
    expect(missing).toMatchObject({ freshness: 'missing', strength: 'weak' });
  });

  it('classifies stale, formula, and cross-condition anchors as review-needed', () => {
    const stale = selectEbaySoldReference({ bl_new_value: 100, bl_cached_at: '2026-01-01T00:00:00Z' }, 'new_sealed', now);
    expect(assessSoldObservation(110, stale)).toMatchObject({ decision: 'review_needed', rejectionReason: 'stale_reference' });

    const formula = selectEbaySoldReference({ current_value: 100, valuation_method: 'formula_bulk' }, 'new_sealed', now);
    expect(assessSoldObservation(110, formula)).toMatchObject({ decision: 'review_needed', rejectionReason: 'formula_reference' });

    const crossCondition = selectEbaySoldReference({ bl_new_value: 100, bl_cached_at: '2026-09-01T00:00:00Z' }, 'used_complete', now);
    expect(assessSoldObservation(80, crossCondition)).toMatchObject({ decision: 'review_needed', rejectionReason: 'cross_condition_reference' });
  });

  it('keeps the trusted 3x band inclusive and rejects values just outside it', () => {
    const reference = selectEbaySoldReference({ bl_new_value: 90, bl_cached_at: '2026-09-01T00:00:00Z' }, 'new_sealed', now);
    expect(assessSoldObservation(30, reference).decision).toBe('accepted');
    expect(assessSoldObservation(270, reference).decision).toBe('accepted');
    expect(assessSoldObservation(29.99, reference)).toMatchObject({ decision: 'rejected', rejectionReason: 'outside_trusted_3x_band' });
    expect(assessSoldObservation(270.01, reference)).toMatchObject({ decision: 'rejected', rejectionReason: 'outside_trusted_3x_band' });
  });

  it('caps evidence and text without fabricating missing listing fields', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      source_url: i === 0 ? 'https://www.ebay.com/itm/123' : null,
      item_id: i === 0 ? '123' : null,
      title: i === 0 ? 'x'.repeat(800) : null,
      price_usd: i === 0 ? 100 : null,
      condition: 'unknown' as const,
      sold_date: null,
      rejection_reason: i === 0 ? null : 'missing_title_or_price',
    }));
    const kept = boundedEvidence(rows);
    expect(kept).toHaveLength(12);
    expect(kept[0].title).toHaveLength(300);
    expect(kept[1]).toMatchObject({ source_url: null, item_id: null, title: null, price_usd: null, sold_date: null });
  });
});
