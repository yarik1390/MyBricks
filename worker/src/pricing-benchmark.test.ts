/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { benchmarkMetrics, runPricingBenchmark, summarizeBenchmark, type BenchmarkPair } from './lib/pricing-benchmark';
import { applyTestTables } from './test-schema';
import app from './index';
declare module 'cloudflare:test' { interface ProvidedEnv { DB: D1Database } }

const five = (overrides: Partial<BenchmarkPair> = {}): BenchmarkPair[] => Array.from({ length: 5 }, (_, i) => ({
  set_num: `S-${i}`, condition: 'new_sealed', predicted: 100, observed: 100,
  low: 80, high: 120, confidence: 'high', sample_count: 10, ...overrides,
}));

describe('benchmark metric maths', () => {
  it('known absolute log error and positive/negative signed bias', () => {
    const r = benchmarkMetrics(five({ predicted: 200 }));
    expect(r.median_absolute_log_error).toBeCloseTo(Math.log(2));
    expect(r.median_signed_log_bias).toBeCloseTo(Math.log(2));
    expect(benchmarkMetrics(five({ predicted: 50 })).median_signed_log_bias).toBeCloseTo(-Math.log(2));
  });
  it('counts inclusive coverage with its own missing-band denominator', () => {
    const pairs = five();
    pairs[0].observed = 80;
    pairs[1].observed = 120;
    pairs[2].observed = 200;
    pairs.push({ ...pairs[0], set_num: 'missing', low: null });
    const r = benchmarkMetrics(pairs);
    expect(r.n_intervals).toBe(5);
    expect(r.n_covered).toBe(4);
    expect(r.interval_coverage).toBe(0.8);
    expect(r.n_missing_intervals).toBe(1);
  });
  it('thin and empty buckets return null, not zero, with counts', () => {
    const r = benchmarkMetrics(five().slice(0, 4));
    expect(r.n_pairs).toBe(4);
    expect(r.median_absolute_log_error).toBeNull();
    expect(r.median_signed_log_bias).toBeNull();
    expect(r.interval_coverage).toBeNull();
    expect(r.abstention_rate).toBeNull();
    expect(benchmarkMetrics([]).n_pairs).toBe(0);
    expect(benchmarkMetrics([]).median_absolute_log_error).toBeNull();
  });
  it('perfect engine yields zero error, zero bias and 100% coverage', () => {
    const r = benchmarkMetrics(five({ low: 100, high: 100 }));
    expect(r.median_absolute_log_error).toBe(0);
    expect(r.median_signed_log_bias).toBe(0);
    expect(r.interval_coverage).toBe(1);
  });
  it('abstention counts sets once and does not treat unknown as sufficient', () => {
    const pairs = five();
    pairs[0].confidence = 'estimated';
    pairs.push({ ...pairs[0], condition: 'used_complete', confidence: 'low' });
    pairs.push({ ...pairs[0], set_num: 'unknown', confidence: null });
    const r = benchmarkMetrics(pairs);
    expect(r.n_sets).toBe(6);
    expect(r.n_abstention_known_sets).toBe(5);
    expect(r.n_should_abstain_sets).toBe(1);
    expect(r.n_abstention_unknown_sets).toBe(1);
    expect(r.abstention_rate).toBe(0.2);
  });
  it('breaks down condition, historical price and later sample count', () => {
    const r = summarizeBenchmark(five({ condition: 'used_complete', predicted: 300, sample_count: 2 }));
    expect(r.by_condition.used_complete.n_pairs).toBe(5);
    expect(r.by_condition.loose.median_absolute_log_error).toBeNull();
    expect(r.by_price_band_usd['200_plus'].n_pairs).toBe(5);
    expect(r.by_later_evidence_sample_count['0_to_4'].n_pairs).toBe(5);
  });
});

const db = (env as unknown as { DB: D1Database }).DB;
const asOf = '2026-06-01T00:00:00Z';
async function seed(set: string, condition = 'new_sealed') {
  await db.prepare('INSERT INTO lego_sets (set_num,name) VALUES (?,?)').bind(set, set).run();
  await db.prepare(`INSERT INTO set_valuation_history_v2 (set_num,condition,snapshot_date,fair_value,low,high,confidence)
    VALUES (?,?,'2026-05-01',100,80,120,'high')`).bind(set, condition).run();
  await db.prepare(`INSERT INTO pricing_signals (set_num,source,provider_family,condition,signal_type,currency,value,sample_count,source_observed_at,checked_at,match_status)
    VALUES (?,'test','test',?,'sold','USD',100,10,'2026-05-10T00:00:00Z','2026-05-11T00:00:00Z','verified')`).bind(set, condition).run();
}
describe('benchmark bounded D1 time-forward cohort', () => {
  beforeEach(async () => {
    await applyTestTables(db, ['lego_sets', 'set_value_history', 'set_valuation_history_v2', 'pricing_signals']);
  });
  it('exercises real SQL with perfect historical fixtures and ignores later snapshots', async () => {
    for (let i = 0; i < 5; i++) await seed(`S-${i}`);
    await db.prepare(`INSERT INTO set_valuation_history_v2 (set_num,condition,snapshot_date,fair_value)
      VALUES ('S-0','new_sealed','2026-05-20',999)`).run();
    const r = await runPricingBenchmark(db, { asOf });
    expect(r.counts.v2_pairs).toBe(5);
    expect(r.overall.median_absolute_log_error).toBe(0);
    expect(r.overall.interval_coverage).toBe(1);
    expect(r.overall.abstention_rate).toBe(0);
  });
  it('excludes same-day, absent, future, invalid, refresh-only, unverified, asking and non-USD observations', async () => {
    const updates = [
      "source_observed_at='2026-05-01T23:59:59Z'",
      'source_observed_at=NULL',
      "source_observed_at='2026-06-02T00:00:00Z'",
      "source_observed_at='bad'",
      "source_observed_at='2026-04-01T00:00:00Z'",
      "match_status='quarantined'", "signal_type='asking'", "currency='EUR'",
      "checked_at='2026-05-02T00:00:00Z'",
    ];
    for (let i = 0; i < updates.length; i++) {
      await seed(`S-${i}`);
      await db.prepare(`UPDATE pricing_signals SET ${updates[i]} WHERE set_num=?`).bind(`S-${i}`).run();
    }
    const r = await runPricingBenchmark(db, { asOf });
    expect(r.overall.n_pairs).toBe(0);
    expect(r.counts.no_later_eligible_evidence).toBe(updates.length);
  });
  it('preserves unknown legacy bands/confidence and does not fabricate used history', async () => {
    await seed('S');
    await db.prepare('DELETE FROM set_valuation_history_v2').run();
    await db.prepare("INSERT INTO set_value_history (set_num,snapshot_date,current_value) VALUES ('S','2026-05-01',200)").run();
    const r = await runPricingBenchmark(db, { asOf });
    expect(r.counts.legacy_pairs).toBe(1);
    expect(r.overall.n_intervals).toBe(0);
    expect(r.overall.interval_coverage).toBeNull();
    expect(r.overall.n_abstention_unknown_sets).toBe(1);
    expect(r.by_condition.used_complete.n_pairs).toBe(0);
  });
  it('uses earliest retained eligible evidence rather than closest-price evidence', async () => {
    await seed('S');
    await db.prepare(`INSERT INTO pricing_signals (set_num,source,provider_family,condition,signal_type,value,source_observed_at,checked_at,match_status)
      VALUES ('S','earlier','test','new_sealed','sold',50,'2026-05-03','2026-05-04','verified')`).run();
    const r = await runPricingBenchmark(db, { asOf });
    expect(r.overall.n_covered).toBe(0);
  });
  it('bounds pages with stable keyset cursor', async () => {
    await seed('A'); await seed('B');
    const first = await runPricingBenchmark(db, { asOf, limit: 1 });
    expect(first.page.next_after_set).toBe('A');
    expect(first.counts.sets_scanned).toBe(1);
    const second = await runPricingBenchmark(db, { asOf, limit: 1, afterSet: first.page.next_after_set! });
    expect(second.page.next_after_set).toBeNull();
    expect(second.overall.n_pairs).toBe(1);
  });
  it('excludes signal-cap overflow explicitly', async () => {
    await seed('S');
    for (let i = 0; i < 24; i++) {
      await db.prepare(`INSERT INTO pricing_signals (set_num,source,provider_family,condition,signal_type,value,checked_at)
        VALUES ('S',?,'test','new_sealed','sold',100,'2026-05-10')`).bind(`other-${i}`).run();
    }
    const r = await runPricingBenchmark(db, { asOf });
    expect(r.counts.signal_cap_excluded_sets).toBe(1);
    expect(r.overall.n_pairs).toBe(0);
  });
  it('route rejects guests and keeps no-store cache policy', async () => {
    const response = await app.fetch(new Request('https://example.com/api/admin/pricing/benchmark'), env);
    expect([401, 403]).toContain(response.status);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});
