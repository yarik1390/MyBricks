import { describe, expect, it } from 'vitest';
import { parseStockAsk } from './lib/bricklink';
import { legacySignalsFor, valueSignalsV3 } from './lib/valuation-v3';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const fresh = '2026-10-13 10:00:00';

describe('parseStockAsk', () => {
  it('uses the median listing so one overpriced lot cannot drag the ask', () => {
    const ask = parseStockAsk({ unit_quantity: 3, qty_avg_price: '1000.00', price_detail: [
      { unit_price: '90.00' }, { unit_price: '2800.00' }, { unit_price: '110.00' }] });
    expect(ask).toEqual({ ask_value: 110, lot_count: 3, min_price: 90, max_price: 2800 });
  });

  it('falls back to the average without per-lot detail, and returns null with no listings', () => {
    expect(parseStockAsk({ unit_quantity: 2, qty_avg_price: '75.50', min_price: '70', max_price: '81' }))
      .toEqual({ ask_value: 75.5, lot_count: 2, min_price: 70, max_price: 81 });
    expect(parseStockAsk({ unit_quantity: 0, qty_avg_price: '0' })).toBeNull();
    expect(parseStockAsk(undefined)).toBeNull();
  });
});

describe('BrickLink fallback signals in the v3 blend', () => {
  it('a thin sold guide alone gives a low-confidence value', () => {
    const state = valueSignalsV3('new_sealed', legacySignalsFor({ bl_thin_value: 120, bl_thin_qty: 3, bl_fallback_cached_at: fresh }), {}, NOW);
    expect(state.fair_value).toBe(120);
    expect(state.confidence).toBe('low');
  });

  it('a lone listing price gives a discounted estimate, flagged asking-only', () => {
    const state = valueSignalsV3('new_sealed', legacySignalsFor({ bl_ask_value: 150, bl_ask_qty: 4, bl_fallback_cached_at: fresh }), {}, NOW);
    expect(state.fair_value).toBe(135);
    expect(state.confidence).toBe('estimated');
    expect(state.flags).toContain('asking_only');
  });

  it('the value model outranks a lone listing price', () => {
    const state = valueSignalsV3('new_sealed', legacySignalsFor({
      bl_ask_value: 150, bl_ask_qty: 4, bl_fallback_cached_at: fresh, model_value: 90, model_cached_at: fresh,
    }), {}, NOW);
    expect(state.fair_value).toBe(90);
  });

  it('a real BrickLink sold guide outranks both fallbacks', () => {
    const state = valueSignalsV3('new_sealed', legacySignalsFor({
      bl_new_value: 200, bl_new_qty: 12, bl_cached_at: fresh,
      bl_thin_value: 120, bl_thin_qty: 3, bl_ask_value: 400, bl_ask_qty: 2, bl_fallback_cached_at: fresh,
    }), {}, NOW);
    expect(state.fair_value).toBe(200);
    expect(state.basis.filter(f => f.provider_family === 'bricklink')).toHaveLength(1);
  });

  it('StockX asks no longer enter the blend', () => {
    const signals = legacySignalsFor({ stockx_ask: 300, stockx_cached_at: fresh });
    expect(signals.some(s => s.source.startsWith('stockx'))).toBe(false);
  });
});
