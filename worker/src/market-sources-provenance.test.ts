/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deduplicatePricingSignals, persistBlendedValue, resetSourceWeightMultipliers,
  valueMarketSignals, type MarketPricingSignal,
} from './lib/market-sources';
import { applyTestTables } from './test-schema';

const db = (env as any).DB as D1Database;
const now = new Date().toISOString();
const sold = (overrides: Partial<MarketPricingSignal> = {}): MarketPricingSignal => ({
  source: 'ebay_sold', provider_family: 'ebay_market', condition: 'new_sealed',
  signal_type: 'sold', currency: 'USD', value: 100, sample_count: 10,
  source_observed_at: now, checked_at: now, match_status: 'verified', ...overrides,
});

beforeEach(async () => {
  resetSourceWeightMultipliers();
  await applyTestTables(db, [
    'lego_sets', 'set_market_ext', 'set_valuation_state', 'pricing_signals',
    'pricing_write_ledger',
  ]);
});

describe('market observation provenance', () => {
  it('deduplicates an exact repeated aggregate without an observation ID', () => {
    const signal = sold();
    expect(deduplicatePricingSignals([
      signal, { ...signal, source: 'pricecharting', checked_at: new Date(Date.now() + 1000).toISOString() },
    ])).toHaveLength(1);
  });

  it('does not collapse aggregates with different dates or eligibility flags', () => {
    const signal = sold();
    expect(deduplicatePricingSignals([
      signal, { ...signal, source_observed_at: new Date(Date.now() - 86400000).toISOString() },
      { ...signal, flags: ['incomplete'] },
    ])).toHaveLength(3);
    expect(valueMarketSignals('new_sealed', [signal, { ...signal, flags: ['incomplete'] }])
      .basis.every(b => b.completeness !== 'incomplete' || b.value === 100)).toBe(true);
  });

  it('uses the production loader/blend path and keeps exact duplicate evidence from inflating samples', async () => {
    await db.prepare(`INSERT INTO lego_sets (set_num, name, valuation_method) VALUES ('P-1','P','market')`).run();
    const insert = db.prepare(`INSERT INTO pricing_signals
      (set_num, source, provider_family, condition, signal_type, currency, value, sample_count,
       source_observed_at, checked_at, match_status, flags_json)
      VALUES ('P-1', ?, 'ebay_market', 'new_sealed', 'sold', 'USD', 100, 10, ?, ?, 'verified', '[]')`);
    await db.batch([
      insert.bind('ebay_sold', now, now),
      insert.bind('pricecharting', now, now),
    ]);
    await persistBlendedValue(db, 'P-1');
    const state = await db.prepare(`SELECT sample_count, completeness, evidence_quality FROM set_valuation_state WHERE set_num='P-1'`).first<any>();
    expect(state.sample_count).toBe(10);
    expect(state.completeness).toBe('sealed');
    expect(state.evidence_quality).toBeTruthy();
  });

  it('documents the aggregate provenance limit', () => {
    // source_item_id identifies a catalog/product item, not an individual sale.
    // Aggregates cannot prove that two providers did or did not share a sale.
    expect(deduplicatePricingSignals([sold({ source_item_id: 'catalog-1' }), sold({ source_item_id: 'catalog-2' })])).toHaveLength(1);
  });
});
