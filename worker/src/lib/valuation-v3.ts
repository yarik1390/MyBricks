import { independentRetailAnchor, isPlausibleMarketValue } from './valuation';

export type PricingCondition = 'new_sealed' | 'used_complete' | 'loose';
export type PricingSignalType = 'sold' | 'modeled' | 'asking' | 'estimate';
export type PricingMatchStatus = 'verified' | 'manual' | 'quarantined' | 'rejected';
export type PricingConfidence = 'high' | 'medium' | 'low' | 'estimated';

export interface PricingSignal {
  source: string;
  provider_family: string;
  condition: PricingCondition;
  signal_type: PricingSignalType;
  currency: string;
  value: number;
  low?: number | null;
  high?: number | null;
  sample_count?: number | null;
  sales_volume?: number | null;
  source_observed_at?: string | null;
  checked_at?: string | null;
  match_status: PricingMatchStatus;
  flags?: string[];
}

export interface ValuationBasis {
  provider_family: string;
  sources: string[];
  signal_type: PricingSignalType;
  value: number;
  sample_count: number;
  fresh: boolean;
  identity_verified: boolean;
}

export interface ValuationStateV3 {
  condition: PricingCondition;
  fair_value: number | null;
  low: number | null;
  high: number | null;
  liquidation_value: number | null;
  confidence: PricingConfidence;
  confidence_score: number;
  sample_count: number;
  independent_family_count: number;
  basis: ValuationBasis[];
  flags: string[];
  as_of: string;
  model_version: 'v3';
}

export interface ValuationHistorySummary {
  recentMedian?: number | null;
  points?: number;
  days?: number;
  firstValue?: number | null;
  lastValue?: number | null;
}

export interface ForecastV3 {
  status: 'ready' | 'external' | 'insufficient_history';
  base_value: number | null;
  bear: number | null;
  base: number | null;
  bull: number | null;
  confidence: PricingConfidence;
  methodology: string;
  as_of: string;
}

const DAY_MS = 86_400_000;
const SOURCE_FRESH_DAYS = 14;
const SOLD_OBSERVATION_DAYS = 90;
const HISTORY_ANOMALY_HIGH = 2.5;
const HISTORY_ANOMALY_LOW = 0.4;

const positive = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const iso = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim() || Number.isNaN(Date.parse(value))) return null;
  return value;
};

const ageDays = (value: unknown, now: number): number => {
  const stamp = iso(value);
  return stamp ? Math.max(0, (now - Date.parse(stamp)) / DAY_MS) : Number.POSITIVE_INFINITY;
};

const roundMoney = (value: number): number => Math.round(value * 100) / 100;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

function weightedMedian(points: Array<{ value: number; weight: number }>): number {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, point) => sum + point.weight, 0);
  let running = 0;
  for (const point of sorted) {
    running += point.weight;
    if (running >= total / 2) return point.value;
  }
  return sorted.at(-1)?.value ?? 0;
}

function minimumSample(signal: PricingSignal): number {
  if (signal.signal_type !== 'sold') return 0;
  if (signal.source.startsWith('bricklink')) return 5;
  if (signal.provider_family === 'ebay_market') return 3;
  return 3;
}

function signalWeight(signal: PricingSignal, now: number): number {
  const type = signal.signal_type === 'sold' ? 1
    : signal.signal_type === 'modeled' ? 0.65
      : signal.signal_type === 'asking' ? 0.35 : 0.2;
  const sample = Math.max(1, Number(signal.sample_count || signal.sales_volume || 1));
  const sampleFactor = signal.signal_type === 'sold' ? 0.65 + Math.min(sample, 20) / 40 : 1;
  const freshness = ageDays(signal.checked_at, now) <= SOURCE_FRESH_DAYS ? 1 : 0.35;
  return type * sampleFactor * freshness;
}

function collapseFamilies(signals: PricingSignal[], now: number): ValuationBasis[] {
  const families = new Map<string, PricingSignal[]>();
  for (const signal of signals) {
    const list = families.get(signal.provider_family) || [];
    list.push(signal);
    families.set(signal.provider_family, list);
  }

  return [...families.entries()].map(([providerFamily, familySignals]) => {
    const bestType: PricingSignalType = familySignals.some(s => s.signal_type === 'sold') ? 'sold'
      : familySignals.some(s => s.signal_type === 'modeled') ? 'modeled'
        : familySignals.some(s => s.signal_type === 'asking') ? 'asking' : 'estimate';
    const selected = familySignals.filter(s => s.signal_type === bestType);
    const value = weightedMedian(selected.map(signal => ({ value: signal.value, weight: signalWeight(signal, now) })));
    // Multiple APIs can expose the same underlying marketplace. Use the largest
    // sample in a family instead of summing and pretending those sales are unique.
    const sampleCount = Math.max(0, ...selected.map(s => Number(s.sample_count || s.sales_volume || 0)));
    const fresh = selected.some(signal => {
      const checkedFresh = ageDays(signal.checked_at, now) <= SOURCE_FRESH_DAYS;
      const observedFresh = signal.signal_type !== 'sold'
        || ageDays(signal.source_observed_at || signal.checked_at, now) <= SOLD_OBSERVATION_DAYS;
      return checkedFresh && observedFresh;
    });
    return {
      provider_family: providerFamily,
      sources: [...new Set(selected.map(s => s.source))],
      signal_type: bestType,
      value: roundMoney(value),
      sample_count: sampleCount,
      fresh,
      identity_verified: selected.every(s => s.match_status === 'verified' || s.match_status === 'manual'),
    };
  });
}

/**
 * Investment-grade condition-aware valuation.
 *
 * Identity is a hard gate. Signals are first collapsed by provider family, so
 * eBay and PriceCharting can never masquerade as two independent confirmations.
 * A robust weighted median supplies the headline; modeled/listing data only
 * widens a sold-led range by at most 15%.
 */
export function valueSignalsV3(
  condition: PricingCondition,
  input: PricingSignal[],
  history: ValuationHistorySummary = {},
  now = Date.now(),
): ValuationStateV3 {
  const flags = new Set<string>();
  const relevant = input.filter(signal => signal.condition === condition && signal.currency === 'USD' && positive(signal.value));
  for (const signal of relevant) {
    if (signal.match_status !== 'verified' && signal.match_status !== 'manual') flags.add('identity_unverified');
    if (signal.signal_type === 'sold' && Number(signal.sample_count || signal.sales_volume || 0) < minimumSample(signal)) {
      flags.add('insufficient_sample');
    }
    if (ageDays(signal.checked_at, now) > SOURCE_FRESH_DAYS) flags.add('stale_source');
    for (const flag of signal.flags || []) flags.add(flag);
  }

  // Quarantined/rejected matches and undersized sold samples remain visible in
  // diagnostics but cannot influence the fair-value headline.
  const eligible = relevant.filter(signal => {
    if (signal.match_status !== 'verified' && signal.match_status !== 'manual') return false;
    if (signal.signal_type === 'sold') {
      return Number(signal.sample_count || signal.sales_volume || 0) >= minimumSample(signal);
    }
    return true;
  });
  const families = collapseFamilies(eligible, now);
  const sold = families.filter(f => f.signal_type === 'sold');
  const supporting = families.filter(f => f.signal_type === 'modeled' || f.signal_type === 'asking');
  const estimates = families.filter(f => f.signal_type === 'estimate');

  let headlineFamilies: ValuationBasis[] = [];
  let confidence: PricingConfidence = 'estimated';
  if (sold.length) {
    headlineFamilies = sold;
    confidence = 'medium';
  } else if (supporting.length >= 2) {
    const values = supporting.map(f => f.value);
    const ratio = Math.max(...values) / Math.min(...values);
    headlineFamilies = supporting;
    confidence = ratio <= 1.4 ? 'medium' : 'low';
    if (ratio > 1.4) flags.add('source_conflict');
  } else if (supporting.length === 1 && supporting[0].signal_type === 'modeled') {
    headlineFamilies = supporting;
    confidence = 'low';
  } else if (estimates.length) {
    headlineFamilies = estimates;
    confidence = 'estimated';
  } else if (supporting.length === 1) {
    // A lone asking/listing signal is not fair market value.
    flags.add('asking_only');
  }

  if (!headlineFamilies.length) {
    return {
      condition, fair_value: null, low: null, high: null, liquidation_value: null,
      confidence: 'estimated', confidence_score: 0, sample_count: 0,
      independent_family_count: 0, basis: families, flags: [...flags],
      as_of: new Date(now).toISOString(), model_version: 'v3',
    };
  }

  const fairValue = roundMoney(weightedMedian(headlineFamilies.map(family => ({
    value: family.value,
    weight: (family.signal_type === 'sold' ? 1 : family.signal_type === 'modeled' ? 0.65 : 0.25)
      * (0.7 + Math.min(family.sample_count, 20) / 50),
  }))));
  const soldValues = sold.map(f => f.value);
  const soldSampleCount = sold.reduce((sum, family) => sum + family.sample_count, 0);
  const soldDispersion = soldValues.length > 1 ? Math.max(...soldValues) / Math.min(...soldValues) : null;
  const allSoldFresh = sold.length > 0 && sold.every(f => f.fresh && f.identity_verified);

  if (sold.length >= 2 && soldSampleCount >= 8 && allSoldFresh && soldDispersion != null && soldDispersion <= 1.4) {
    confidence = 'high';
  } else if (sold.length > 1 && soldDispersion != null && soldDispersion > 1.4) {
    confidence = soldDispersion > 2.2 ? 'low' : 'medium';
    flags.add('source_conflict');
  } else if (sold.length && !allSoldFresh) {
    confidence = 'low';
  }

  const halfWidth = confidence === 'high' ? 0.06 : confidence === 'medium' ? 0.15 : confidence === 'low' ? 0.30 : 0.35;
  let low = fairValue * (1 - halfWidth);
  let high = fairValue * (1 + halfWidth);
  for (const family of headlineFamilies) {
    low = Math.min(low, family.value);
    high = Math.max(high, family.value);
  }
  // Soft signals can explain uncertainty, but never move the sold headline and
  // never widen the range by more than 15% on either side.
  if (sold.length) {
    for (const family of supporting) {
      low = Math.min(low, clamp(family.value, fairValue * 0.85, fairValue * 1.15));
      high = Math.max(high, clamp(family.value, fairValue * 0.85, fairValue * 1.15));
      const ratio = Math.max(family.value, fairValue) / Math.min(family.value, fairValue);
      if (ratio >= 1.5) flags.add('source_conflict');
    }
  }

  const recentMedian = positive(history.recentMedian);
  if (recentMedian && Number(history.points || 0) >= 5) {
    const ratio = fairValue / recentMedian;
    const independentlyConfirmed = sold.length >= 2 && sold.every(f => f.fresh);
    if (!independentlyConfirmed && (ratio > HISTORY_ANOMALY_HIGH || ratio < HISTORY_ANOMALY_LOW)) {
      confidence = 'low';
      flags.add('history_anomaly');
      low = Math.min(low, recentMedian * 0.95);
      high = Math.max(high, recentMedian * 1.05);
    }
  }

  const lowerSold = soldValues.length
    ? [...soldValues].sort((a, b) => a - b)[Math.floor((soldValues.length - 1) * 0.25)]
    : null;
  const liquidityHaircut = soldSampleCount >= 20 ? 0.05 : soldSampleCount >= 8 ? 0.10 : 0.15;
  const liquidationValue = lowerSold == null ? null : roundMoney(lowerSold * (1 - 0.13 - liquidityHaircut));
  const confidenceScore = confidence === 'high' ? 90 : confidence === 'medium' ? 70 : confidence === 'low' ? 40 : 20;
  const observedTimes = eligible
    .filter(signal => headlineFamilies.some(family => family.provider_family === signal.provider_family))
    .map(signal => Date.parse(signal.checked_at || ''))
    .filter(Number.isFinite);
  const asOf = observedTimes.length ? new Date(Math.max(...observedTimes)).toISOString() : new Date(now).toISOString();

  return {
    condition,
    fair_value: fairValue,
    low: roundMoney(low),
    high: roundMoney(high),
    liquidation_value: liquidationValue,
    confidence,
    confidence_score: Math.max(0, confidenceScore - flags.size * 5),
    sample_count: soldSampleCount,
    independent_family_count: headlineFamilies.length,
    basis: families,
    flags: [...flags],
    as_of: asOf,
    model_version: 'v3',
  };
}

/** Convert the existing columns into normalized inputs during the dual-write period. */
export function legacySignalsFor(row: Record<string, unknown>): PricingSignal[] {
  const out: PricingSignal[] = [];
  const add = (signal: Omit<PricingSignal, 'currency' | 'match_status' | 'value'> & { value: number | null; match_status?: PricingMatchStatus }) => {
    if (!signal.value) return;
    out.push({ ...signal, value: signal.value, currency: 'USD', match_status: signal.match_status ?? 'verified' });
  };
  const method = String(row.valuation_method || '');
  const cached = iso(row.cached_at);

  add({ source: 'bricklink_new', provider_family: 'bricklink', condition: 'new_sealed', signal_type: 'sold', value: positive(row.bl_new_value), low: positive(row.bl_new_min), high: positive(row.bl_new_max), sample_count: positive(row.bl_new_qty), checked_at: iso(row.bl_cached_at) || cached, source_observed_at: iso(row.bl_cached_at) || cached });
  add({ source: 'bricklink_used', provider_family: 'bricklink', condition: 'used_complete', signal_type: 'sold', value: positive(row.used_value), low: positive(row.bl_used_min), high: positive(row.bl_used_max), sample_count: positive(row.bl_used_qty), checked_at: iso(row.bl_cached_at) || cached, source_observed_at: iso(row.bl_cached_at) || cached });
  add({ source: 'ebay_sold_new', provider_family: 'ebay_market', condition: 'new_sealed', signal_type: 'sold', value: positive(row.ebay_new_value), sample_count: positive(row.ebay_new_qty), checked_at: iso(row.ebay_new_cached_at) || cached, source_observed_at: iso(row.ebay_new_last_sold) || iso(row.ebay_new_cached_at) || cached });
  add({ source: 'ebay_sold_used', provider_family: 'ebay_market', condition: 'used_complete', signal_type: 'sold', value: positive(row.ebay_used_value), sample_count: positive(row.ebay_used_qty), checked_at: iso(row.ebay_used_cached_at) || cached, source_observed_at: iso(row.ebay_used_last_sold) || iso(row.ebay_used_cached_at) || cached });
  // The BrickEconomy figure is an LLM-extracted scrape: quarantine it (visible
  // in diagnostics, ineligible for the fair-value headline) when it is not
  // plausible against INDEPENDENT anchors — real comps, or Brickset's MSRP.
  // A lone $15,000 scrape on an uncorroborated 177-piece kit must never
  // become blended_value just because nothing contradicts it.
  const beNew = positive(row.be_value_new) || (method === 'brickeconomy' ? positive(row.current_value) : null);
  const beTrusted = beNew == null ? false : isPlausibleMarketValue(beNew, {
    retailPrice: independentRetailAnchor({ brickset_msrp: positive(row.brickset_msrp), retail_price: positive(row.retail_price), be_retail: positive(row.be_retail) }),
    pieces: Number(row.pieces) || null,
    corroborators: [positive(row.bl_new_value), positive(row.ebay_new_value), positive(row.ebay_ask_value), positive(row.bo_new_value)],
  });
  add({ source: 'brickeconomy_new', provider_family: 'brickeconomy', condition: 'new_sealed', signal_type: 'modeled', value: beNew, checked_at: iso(row.be_cached_at) || cached, match_status: beTrusted ? 'verified' : 'quarantined' });
  add({ source: 'brickeconomy_used', provider_family: 'brickeconomy', condition: 'used_complete', signal_type: 'modeled', value: positive(row.be_value_used), checked_at: iso(row.be_cached_at) || cached });
  add({ source: 'brickowl_new_asking', provider_family: 'brickowl', condition: 'new_sealed', signal_type: 'asking', value: positive(row.bo_new_value), sample_count: positive(row.bo_new_qty), checked_at: iso(row.bo_cached_at) || cached });
  add({ source: 'brickowl_used_asking', provider_family: 'brickowl', condition: 'used_complete', signal_type: 'asking', value: positive(row.bo_used_value), sample_count: positive(row.bo_used_qty), checked_at: iso(row.bo_cached_at) || cached });
  add({ source: 'ebay_asking', provider_family: 'ebay_market', condition: 'new_sealed', signal_type: 'asking', value: positive(row.ebay_ask_value), sample_count: positive(row.ebay_ask_qty), checked_at: iso(row.ebay_ask_cached_at) || cached });
  // StockX lowest ask — a single new/sealed listing ceiling from an INDEPENDENT
  // marketplace (its own provider_family, so it corroborates rather than collapsing
  // into ebay_market). Asking signal (0.35 weight): with any sold family it can only
  // nudge the range ±15%, never move the headline; a lone StockX ask reads as
  // asking_only (no fair value). StockX only lists sealed, so new_sealed only.
  add({ source: 'stockx_ask', provider_family: 'stockx', condition: 'new_sealed', signal_type: 'asking', value: positive(row.stockx_ask), checked_at: iso(row.stockx_cached_at) || cached });

  // PriceCharting legacy columns are deliberately absent. Existing mappings are
  // quarantined; verified records enter through pricing_signals and collapse into
  // the same ebay_market family as eBay itself.
  if (method === 'formula_bulk' || method === 'local' || method === 'ai') {
    add({ source: method === 'ai' ? 'ai_estimate' : 'formula', provider_family: method === 'ai' ? 'ai' : 'formula', condition: 'new_sealed', signal_type: 'estimate', value: positive(row.current_value), checked_at: cached });
  }
  return out;
}

export function buildForecastV3(
  state: ValuationStateV3,
  history: ValuationHistorySummary = {},
  external?: { twoYear?: number | null; fiveYear?: number | null; sourceBaseline?: number | null; asOf?: string | null },
  now = Date.now(),
): ForecastV3 {
  const fair = state.fair_value;
  const asOf = new Date(now).toISOString();
  if (!fair) return { status: 'insufficient_history', base_value: null, bear: null, base: null, bull: null, confidence: 'estimated', methodology: 'A verified fair value is required before forecasting.', as_of: asOf };

  if (Number(history.points || 0) >= 12 && Number(history.days || 0) >= 180 && positive(history.firstValue) && positive(history.lastValue)) {
    const years = Math.max(0.5, Number(history.days) / 365.25);
    const annual = clamp(Math.pow(Number(history.lastValue) / Number(history.firstValue), 1 / years) - 1, -0.25, 0.25);
    const base = fair * Math.pow(1 + annual, 2);
    return {
      status: 'ready', base_value: fair,
      bear: roundMoney(fair * Math.pow(1 + clamp(annual - 0.08, -0.35, 0.17), 2)),
      base: roundMoney(base),
      bull: roundMoney(fair * Math.pow(1 + clamp(annual + 0.08, -0.17, 0.35), 2)),
      confidence: state.confidence === 'high' ? 'medium' : 'low',
      methodology: 'Two-year bear/base/bull scenarios from at least 180 days and 12 daily fair-value observations.',
      as_of: asOf,
    };
  }

  const sourceBaseline = positive(external?.sourceBaseline);
  const external2y = positive(external?.twoYear);
  if (external2y && sourceBaseline) {
    const ratio = clamp(external2y / sourceBaseline, 0.5, 2.5);
    const base = fair * ratio;
    return {
      status: 'external', base_value: fair,
      bear: roundMoney(base * 0.8), base: roundMoney(base), bull: roundMoney(base * 1.2),
      confidence: 'low',
      methodology: 'External growth scenario rebased to the current verified fair value; not an independent valuation.',
      as_of: external?.asOf || asOf,
    };
  }

  return {
    status: 'insufficient_history', base_value: fair, bear: null, base: null, bull: null,
    confidence: 'low', methodology: 'Forecasts unlock after 180 days and at least 12 fair-value observations.', as_of: asOf,
  };
}
