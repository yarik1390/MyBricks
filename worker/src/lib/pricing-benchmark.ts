/**
 * TIME-FORWARD OBSERVATION PROXY, NOT a future-transaction accuracy backtest.
 * Schema/writer audit: set_value_history.current_value is the daily displayed
 * COALESCE(NULLIF(blended_value,0),current_value), with no condition/band/confidence.
 * Its ebay_value is a cached aggregate, not a dated sale. lego_sets valuations
 * and pricing_signals (PK set/source/condition) are overwritten current state;
 * *_cached_at / checked_at are refresh times, NOT transaction times.
 * set_valuation_history_v2 DOES retain condition, fair_value, low/high and
 * confidence. snapshot-set-values writes date('now'), can replace that day's
 * snapshot, and does not preserve the underlying evidence or model as_of.
 * Prefer that history; fall back to legacy history for new_sealed ONLY, with
 * unknown coverage/abstention. Never reconstruct past bands from today's model.
 *
 * Fix origin at as_of minus 30 days; take the latest snapshot on/before origin
 * (within 400 days). Compare to the earliest currently retained, verified/manual
 * USD sold aggregate whose source_observed_at is AFTER the entire snapshot day
 * and whose checked_at is >= observation and <= as_of. No checked_at fallback.
 * Observed aggregates may include pre-origin sales, source_observed_at may be a
 * provider observation/refresh date, and overwritten signals lose earlier data:
 * this is temporal aggregate agreement, not independent future-sale holdout.
 * Same-day evidence is excluded; missing history/observations are counted.
 * USD for history is the existing application's convention, not a stored field.
 * Historical low/estimated confidence is an explicit abstention PROXY, not a
 * reconstructed evidence-sufficiency decision (historical bases are not saved).
 * Liquidity means later sample_count, not ex-ante liquidity or sales velocity.
 *
 * Cost plan: lexicographic lego_sets PK keyset page, max 100 sets (+1 lookahead).
 * Each set performs 3 history-v2 PK seeks (set,condition,date), 1 legacy history
 * PK seek (set,date), and a pricing_signals PK range seek capped at 25 rows.
 * No global history/signal scan/sort/count; signal ordering follows its PK.
 * >24 signals excludes that set explicitly rather than silently picking a
 * truncated outcome. All aggregation is bounded in memory; no writes/providers.
 * Page metrics are NOT a representative catalog sample and NOT composable by
 * averaging medians. Use after_set cursor to inspect other catalog regions.
 */

export type BenchmarkPair = {
  set_num: string;
  condition: string;
  predicted: number;
  observed: number;
  low: number | null;
  high: number | null;
  confidence: string | null;
  sample_count: number | null;
};
const MIN_BUCKET = 5;
const CONDITIONS = ['new_sealed', 'used_complete', 'loose'] as const;
const positive = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.floor(s.length / 2)]) / 2;
};

export function benchmarkMetrics(pairs: BenchmarkPair[]) {
  const valid = pairs.filter(p => positive(p.predicted) && positive(p.observed));
  const errors = valid.map(p => Math.log(p.predicted) - Math.log(p.observed));
  const intervals = valid.filter(p => positive(p.low) && positive(p.high) && p.low <= p.high);
  const covered = intervals.filter(p => p.observed >= p.low! && p.observed <= p.high!).length;
  // Set-level denominator: known if any condition is insufficient, or every
  // matched condition has a recognized historical confidence. Unknown != safe.
  const sets = new Map<string, BenchmarkPair[]>();
  for (const p of valid) sets.set(p.set_num, [...(sets.get(p.set_num) ?? []), p]);
  let known = 0, abstain = 0;
  for (const ps of sets.values()) {
    const insufficient = ps.some(p => p.confidence === 'low' || p.confidence === 'estimated');
    if (insufficient || ps.every(p => p.confidence === 'high' || p.confidence === 'medium')) {
      known++;
      if (insufficient) abstain++;
    }
  }
  return {
    n_pairs: valid.length, n_sets: sets.size,
    median_absolute_log_error: errors.length >= MIN_BUCKET ? median(errors.map(Math.abs)) : null,
    median_signed_log_bias: errors.length >= MIN_BUCKET ? median(errors) : null,
    n_intervals: intervals.length, n_covered: covered,
    n_missing_intervals: valid.length - intervals.length,
    interval_coverage: intervals.length >= MIN_BUCKET ? covered / intervals.length : null,
    n_abstention_known_sets: known, n_should_abstain_sets: abstain,
    n_abstention_unknown_sets: sets.size - known,
    abstention_rate: known >= MIN_BUCKET ? abstain / known : null,
  };
}

const priceBand = (p: BenchmarkPair) => p.predicted < 50 ? 'under_50' : p.predicted < 200 ? '50_to_under_200' : '200_plus';
const liquidity = (p: BenchmarkPair) => p.sample_count == null || !Number.isFinite(p.sample_count) || p.sample_count < 0
  ? 'unknown' : p.sample_count < 5 ? '0_to_4' : p.sample_count < 20 ? '5_to_19' : '20_plus';
export function summarizeBenchmark(pairs: BenchmarkPair[]) {
  const group = (keys: readonly string[], key: (p: BenchmarkPair) => string) =>
    Object.fromEntries(keys.map(k => [k, benchmarkMetrics(pairs.filter(p => key(p) === k))]));
  return {
    overall: benchmarkMetrics(pairs),
    by_condition: group(CONDITIONS, p => p.condition),
    by_price_band_usd: group(['under_50', '50_to_under_200', '200_plus'], priceBand),
    by_later_evidence_sample_count: group(['unknown', '0_to_4', '5_to_19', '20_plus'], liquidity),
  };
}

type History = { snapshot_date: string; fair_value: number; low: number | null; high: number | null; confidence: string | null };
type Signal = { source: string; condition: string; signal_type: string; currency: string; value: number; sample_count: number | null; source_observed_at: string | null; checked_at: string; match_status: string };
type Row = { set_num: string; new_sealed: string | null; used_complete: string | null; loose: string | null; legacy: string | null; signals: string };
// Treat SQLite CURRENT_TIMESTAMP's timezone-less text as UTC, never host local time.
const stamp = (s: string | null) => s == null ? NaN : Date.parse(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);

export async function runPricingBenchmark(db: D1Database, options: { afterSet?: string; limit?: number; asOf?: string } = {}) {
  const asOf = new Date(options.asOf ?? Date.now());
  if (!Number.isFinite(asOf.getTime())) throw new Error('Invalid benchmark asOf');
  const day = 86400000;
  const origin = new Date(asOf.getTime() - 30 * day).toISOString().slice(0, 10);
  const oldest = new Date(asOf.getTime() - 400 * day).toISOString().slice(0, 10);
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.floor(options.limit!))) : 100;
  const historyQueries = CONDITIONS.map(condition => `(SELECT json_object(
    'snapshot_date',snapshot_date,'fair_value',fair_value,'low',low,'high',high,'confidence',confidence)
    FROM set_valuation_history_v2 h WHERE h.set_num=s.set_num AND condition='${condition}'
      AND snapshot_date BETWEEN ? AND ? ORDER BY snapshot_date DESC LIMIT 1) AS ${condition}`);
  const rows = await db.prepare(`SELECT s.set_num, ${historyQueries.join(',')},
    (SELECT json_object('snapshot_date',snapshot_date,'fair_value',current_value,
       'low',NULL,'high',NULL,'confidence',NULL) FROM set_value_history h
     WHERE h.set_num=s.set_num AND snapshot_date BETWEEN ? AND ?
     ORDER BY snapshot_date DESC LIMIT 1) AS legacy,
    (SELECT json_group_array(json_object('source',source,'condition',condition,
       'signal_type',signal_type,'currency',currency,'value',value,'sample_count',sample_count,
       'source_observed_at',source_observed_at,'checked_at',checked_at,'match_status',match_status))
     FROM (SELECT source,condition,signal_type,currency,value,sample_count,source_observed_at,checked_at,match_status
       FROM pricing_signals WHERE set_num=s.set_num ORDER BY source,condition LIMIT 25)) AS signals
    FROM (SELECT set_num FROM lego_sets WHERE set_num > ? ORDER BY set_num LIMIT ?) s
    ORDER BY s.set_num`).bind(oldest, origin, oldest, origin, oldest, origin, oldest, origin,
      options.afterSet ?? '', limit + 1).all<Row>();
  const page = rows.results.slice(0, limit);
  const pairs: BenchmarkPair[] = [];
  const counts = { sets_scanned: page.length, signal_cap_excluded_sets: 0, condition_slots: 0,
    missing_history: 0, invalid_history: 0, no_later_eligible_evidence: 0, v2_pairs: 0, legacy_pairs: 0 };
  for (const row of page) {
    const signals: Signal[] = JSON.parse(row.signals);
    if (signals.length > 24) { counts.signal_cap_excluded_sets++; continue; }
    for (const condition of CONDITIONS) {
      counts.condition_slots++;
      const legacy = !row[condition] && condition === 'new_sealed';
      const raw = row[condition] ?? (legacy ? row.legacy : null);
      if (!raw) { counts.missing_history++; continue; }
      const h: History = JSON.parse(raw);
      const endOfDay = stamp(h.snapshot_date + 'T00:00:00Z') + day;
      if (!positive(h.fair_value) || !Number.isFinite(endOfDay)) { counts.invalid_history++; continue; }
      const evidence = signals.filter(s => {
        const observed = stamp(s.source_observed_at), checked = stamp(s.checked_at);
        return s.condition === condition && s.signal_type === 'sold' && s.currency === 'USD'
          && ['verified', 'manual'].includes(s.match_status) && positive(s.value)
          && observed >= endOfDay && observed <= asOf.getTime()
          && checked >= observed && checked <= asOf.getTime();
      }).sort((a, b) => stamp(a.source_observed_at) - stamp(b.source_observed_at) || a.source.localeCompare(b.source))[0];
      if (!evidence) { counts.no_later_eligible_evidence++; continue; }
      counts[legacy ? 'legacy_pairs' : 'v2_pairs']++;
      pairs.push({ set_num: row.set_num, condition, predicted: h.fair_value, observed: evidence.value,
        low: h.low, high: h.high, confidence: h.confidence, sample_count: evidence.sample_count });
    }
  }
  return {
    as_of: asOf.toISOString(), origin_on_or_before: origin, oldest_snapshot: oldest,
    measurement: 'time_forward_observed_aggregate_proxy', minimum_bucket_pairs_or_sets: MIN_BUCKET,
    limitations: [
      'Not a future-sale holdout: aggregate sale windows/individual transaction IDs and dates are not retained.',
      'Observation timestamps are provider dates, not guaranteed transaction dates; rolling evidence can overlap training evidence.',
      'Latest retained signals only; missing/overwritten observations and owned/wishlisted/high-value snapshot selection bias the cohort.',
      'Legacy new-sealed assumption has no historical intervals/confidence; its coverage and abstention are unknown.',
      'Abstention is historical low/estimated confidence proxy among matched sets, not whole-catalog evidence sufficiency.',
      'History uses application USD convention; no historical currency column. Page summaries are not population estimates.',
    ],
    definitions: {
      error: 'median(abs(ln(predicted / later_observed))); one equally weighted pair per set-condition',
      bias: 'median(ln(predicted / later_observed)); positive = overpricing, negative = underpricing',
      coverage: 'inclusive low <= later_observed <= high / valid historical intervals; fraction, not percent',
      abstention: 'sets with any matched low/estimated historical confidence / sets with classifiable confidence; fraction',
      buckets: 'condition; historical predicted USD price; later evidence sample_count (not historical liquidity)',
      thin: 'metric null when its own denominator < 5; counts remain explicit',
    },
    page: { limit, after_set: options.afterSet ?? '', next_after_set: rows.results.length > limit ? page.at(-1)!.set_num : null },
    counts, ...summarizeBenchmark(pairs),
  };
}
