import { describe, expect, it } from 'vitest';
import { attachCatalogValuationState, CATALOG_COLS } from './routes/sets-sql';
import { valueSignalsV3, type PricingSignal } from './lib/valuation-v3';

const signal = (overrides: Partial<PricingSignal>): PricingSignal => ({
  source: 'fixture', provider_family: overrides.provider_family || 'fixture',
  condition: 'used_complete', signal_type: 'sold', currency: 'USD', value: 100,
  sample_count: 5, source_observed_at: new Date().toISOString(),
  checked_at: new Date().toISOString(), match_status: 'verified', ...overrides,
});

describe('valuation completeness eligibility contract', () => {
  it.each(['incomplete', 'completeness_unknown'])('rejects %s evidence for sealed headlines', flag => {
    const bad = signal({ condition: 'new_sealed', flags: [flag], value: 1000 });
    expect(valueSignalsV3('new_sealed', [bad]).fair_value).toBeNull();
    const result = valueSignalsV3('new_sealed', [bad, signal({ condition: 'new_sealed', provider_family: 'other', value: 110 })]);
    expect(result.fair_value).toBe(110);
    expect(result.completeness).toBe('sealed');
  });

  it('projects and hydrates both catalog states with conservative legacy defaults', () => {
    for (const alias of ['svn', 'svu']) {
      expect(CATALOG_COLS).toContain(`${alias}.completeness`);
      expect(CATALOG_COLS).toContain(`${alias}.evidence_quality`);
    }
    const row: Record<string, any> = { v3_new_fair: 100, v3_new_flags: JSON.stringify({ new_completeness: 'sealed', new_evidence_quality: 'thin' }), v3_used_fair: 80 };
    const hydrated = attachCatalogValuationState(row);
    expect(hydrated.__valuation_new.completeness).toBe('sealed');
    expect(hydrated.__valuation_new.evidence_quality).toBe('thin');
    expect(hydrated.__valuation_used.completeness).toBe('unknown');
    expect(hydrated.__valuation_used.evidence_quality).toBe('insufficient');
  });
  it('ignores rejected incomplete evidence before reporting completeness', () => {
    const result = valueSignalsV3('used_complete', [
      signal({ match_status: 'rejected', flags: ['incomplete'], value: 1_000 }),
      signal({ provider_family: 'bricklink', value: 100 }),
    ]);
    expect(result.completeness).toBe('complete');
    expect(result.fair_value).toBe(100);
  });

  it('does not let an accepted incomplete comp suppress an accepted complete comp', () => {
    const result = valueSignalsV3('used_complete', [
      signal({ provider_family: 'bricklink', flags: ['incomplete'], value: 1_000 }),
      signal({ provider_family: 'ebay_market', value: 110 }),
    ]);
    expect(result.completeness).toBe('complete');
    expect(result.fair_value).toBe(110);
    expect(result.basis.every(item => item.completeness === 'complete')).toBe(true);
  });
});
