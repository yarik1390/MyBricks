import { recentValueMedian, recentValueMedians } from './price-trend';
import {
  buildForecastV3,
  legacySignalsFor,
  valueSignalsV3,
  type PricingSignal,
  type ValuationStateV3,
} from './valuation-v3';
import { recordPricingWrites } from './pricing-budget';

export type MarketConfidence = 'high' | 'medium' | 'low' | 'estimated';
export type MarketFreshness = 'fresh' | 'stale' | 'expired' | 'missing';

export interface MarketSource {
  id: string;
  name: string;
  value: number | null;
  condition: 'new' | 'used' | 'sold' | 'retail' | 'estimate';
  sample_count: number | null;
  last_updated: string | null;
  freshness: MarketFreshness;
  reliability: 'primary' | 'corroborating' | 'fallback';
  note: string;
}

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function isPast(value: unknown): boolean {
  const ts = text(value);
  return !!ts && Date.parse(ts) < Date.now();
}

function olderThanDays(value: unknown, days: number): boolean {
  const ts = text(value);
  if (!ts) return false;
  return Date.now() - Date.parse(ts) > days * 24 * 3600 * 1000;
}

export function marketFreshness(row: Record<string, unknown>): MarketFreshness {
  if (!num(row.current_value)) return 'missing';
  if (isPast(row.valuation_expires_at)) return 'expired';
  if (!row.cached_at) {
    return String(row.valuation_method || '') === 'formula_bulk' || String(row.source || '') === 'rebrickable'
      ? 'fresh'
      : 'stale';
  }
  if (olderThanDays(row.cached_at, 60)) return 'stale';
  return 'fresh';
}

function sourceFreshness(
  row: Record<string, unknown>,
  timestampField: string = 'cached_at',
  valueField: string = 'current_value',
): MarketFreshness {
  if (!num(row[valueField])) return 'missing';
  if (olderThanDays(row[timestampField], 60)) return 'stale';
  return row[timestampField] ? 'fresh' : marketFreshness(row);
}

export function buildMarketSources(row: Record<string, unknown>): MarketSource[] {
  const method = String(row.valuation_method || '');
  const cachedAt = text(row.cached_at);
  // Per-source timestamps when available; legacy rows fall back to cached_at.
  const blCachedAt = text(row.bl_cached_at) || cachedAt;
  const beCachedAt = text(row.be_cached_at) || cachedAt;
  const blFreshness = (valueField: string): MarketFreshness =>
    row.bl_cached_at ? sourceFreshness(row, 'bl_cached_at', valueField) : marketFreshness(row);
  const sources: MarketSource[] = [];

  if (method === 'brickeconomy' && num(row.current_value)) {
    sources.push({
      id: 'brickeconomy',
      name: 'BrickEconomy',
      value: num(row.current_value),
      condition: 'new',
      sample_count: null,
      last_updated: beCachedAt,
      freshness: row.be_cached_at ? sourceFreshness(row, 'be_cached_at', 'current_value') : marketFreshness(row),
      reliability: 'primary',
      note: 'Primary new-condition market value and forecast source.',
    });
  }

  if (method === 'market' && num(row.current_value) && !num(row.bl_new_value)) {
    sources.push({
      id: 'bricklink_new',
      name: 'BrickLink',
      value: num(row.current_value),
      condition: 'new',
      sample_count: num(row.bl_new_qty),
      last_updated: blCachedAt,
      freshness: blFreshness('current_value'),
      reliability: 'primary',
      note: 'Sold new-condition BrickLink guide value.',
    });
  }

  if (num(row.bl_new_value)) {
    sources.push({
      id: 'bricklink_new',
      name: 'BrickLink',
      value: num(row.bl_new_value),
      condition: 'new',
      sample_count: num(row.bl_new_qty),
      last_updated: blCachedAt,
      freshness: blFreshness('bl_new_value'),
      reliability: method === 'market' ? 'primary' : 'corroborating',
      note: 'Sold new-condition BrickLink guide value.',
    });
  }

  if (num(row.used_value)) {
    sources.push({
      id: 'bricklink_used',
      name: 'Used market',
      value: num(row.used_value),
      condition: 'used',
      sample_count: num(row.bl_used_qty),
      last_updated: blCachedAt,
      freshness: blFreshness('used_value'),
      reliability: 'corroborating',
      note: 'Used-condition market comparison.',
    });
  }

  const ebayNew = num(row.ebay_new_value);
  const legacyEbay = !ebayNew ? num(row.ebay_value) : null;
  if (ebayNew || legacyEbay) {
    const legacy = !ebayNew && !!legacyEbay;
    sources.push({
      id: legacy ? 'ebay_legacy' : 'ebay_sold_new',
      name: legacy ? 'Legacy eBay' : 'eBay sold new',
      value: ebayNew || legacyEbay,
      condition: 'new',
      sample_count: legacy ? null : num(row.ebay_new_qty),
      last_updated: legacy
        ? text(row.ebay_cached_at) || cachedAt
        : text(row.ebay_new_last_sold) || text(row.ebay_new_cached_at) || cachedAt,
      freshness: legacy
        ? sourceFreshness(row, 'ebay_cached_at', 'ebay_value')
        : sourceFreshness(row, 'ebay_new_cached_at', 'ebay_new_value'),
      reliability: (method === 'ebay_rss' || method === 'ebay_sold') ? 'primary' : 'corroborating',
      note: legacy
        ? 'Older single eBay value kept until sold comps refresh.'
        : 'US/USD sold-listing median for new or sealed condition.',
    });
  }

  if (num(row.ebay_used_value)) {
    sources.push({
      id: 'ebay_sold_used',
      name: 'eBay sold used',
      value: num(row.ebay_used_value),
      condition: 'used',
      sample_count: num(row.ebay_used_qty),
      last_updated: text(row.ebay_used_last_sold) || text(row.ebay_used_cached_at) || cachedAt,
      freshness: sourceFreshness(row, 'ebay_used_cached_at', 'ebay_used_value'),
      reliability: 'corroborating',
      note: 'US/USD sold-listing median for used condition.',
    });
  }

  if (num(row.ebay_ask_value)) {
    sources.push({
      id: 'ebay_ask',
      name: 'eBay asking',
      value: num(row.ebay_ask_value),
      condition: 'new',
      sample_count: num(row.ebay_ask_qty),
      last_updated: text(row.ebay_ask_cached_at) || cachedAt,
      freshness: sourceFreshness(row, 'ebay_ask_cached_at', 'ebay_ask_value'),
      reliability: 'corroborating',
      note: 'Median asking price of current eBay listings — not sold prices.',
    });
  }

  if (num(row.stockx_ask)) {
    sources.push({
      id: 'stockx_ask',
      name: 'StockX ask',
      value: num(row.stockx_ask),
      condition: 'new',
      sample_count: null,
      last_updated: text(row.stockx_cached_at) || cachedAt,
      freshness: sourceFreshness(row, 'stockx_cached_at', 'stockx_ask'),
      reliability: 'corroborating',
      note: 'StockX lowest ask — a single sealed listing price, not a sold comp.',
    });
  }

  if (num(row.bo_new_value)) {
    sources.push({
      id: 'brickowl_new',
      name: 'BrickOwl',
      value: num(row.bo_new_value),
      condition: 'new',
      sample_count: num(row.bo_new_qty),
      last_updated: text(row.bo_cached_at) || cachedAt,
      freshness: sourceFreshness(row, 'bo_cached_at', 'bo_new_value'),
      reliability: 'corroborating',
      note: 'Median new-condition BrickOwl listing price.',
    });
  }

  if (num(row.bo_used_value)) {
    sources.push({
      id: 'brickowl_used',
      name: 'BrickOwl used',
      value: num(row.bo_used_value),
      condition: 'used',
      sample_count: num(row.bo_used_qty),
      last_updated: text(row.bo_cached_at) || cachedAt,
      freshness: sourceFreshness(row, 'bo_cached_at', 'bo_used_value'),
      reliability: 'corroborating',
      note: 'Median used-condition BrickOwl listing price.',
    });
  }

  if (method === 'ai' && num(row.current_value)) {
    sources.push({
      id: 'ai_estimate',
      name: 'AI estimate',
      value: num(row.current_value),
      condition: 'estimate',
      sample_count: null,
      last_updated: cachedAt,
      freshness: marketFreshness(row),
      reliability: 'fallback',
      note: 'Fallback estimate used when market sources were unavailable.',
    });
  }

  if ((method === 'formula_bulk' || method === 'local') && num(row.current_value)) {
    sources.push({
      id: 'formula',
      name: 'Formula estimate',
      value: num(row.current_value),
      condition: 'estimate',
      sample_count: null,
      last_updated: cachedAt,
      freshness: marketFreshness(row),
      reliability: 'fallback',
      note: 'Rule-based catalog estimate until market pricing refreshes.',
    });
  }

  if (num(row.retail_price)) {
    sources.push({
      id: 'retail',
      name: 'Retail MSRP',
      value: num(row.retail_price),
      condition: 'retail',
      sample_count: null,
      last_updated: null,
      freshness: 'fresh',
      reliability: 'corroborating',
      note: 'Original retail price where known.',
    });
  }

  return sources;
}

export function marketConfidence(row: Record<string, unknown>, sources = buildMarketSources(row)): MarketConfidence {
  const method = String(row.valuation_method || '');
  const fresh = marketFreshness(row);
  if (fresh === 'missing') return 'estimated';
  if (method === 'formula_bulk' || method === 'local') return 'estimated';
  if (method === 'ai') return fresh === 'fresh' ? 'low' : 'estimated';

  const hasEbay = sources.some(s => (s.id === 'ebay_sold_new' || s.id === 'ebay_sold_used' || s.id === 'ebay_legacy') && s.value);
  const hasBrickLink = sources.some(s => s.id === 'bricklink_new' && s.value);
  const hasLots = Number(row.bl_new_qty || 0) >= 5 || Number(row.bl_used_qty || 0) >= 3;
  const isFresh = fresh === 'fresh';

  if (method === 'brickeconomy' && isFresh && (hasBrickLink || hasEbay)) return 'high';
  if (method === 'market' && isFresh && hasLots && hasEbay) return 'high';
  // Sold-comp methods carry their own market evidence; a BrickEconomy scrape
  // is "medium" only when something independent corroborates it — a lone
  // scraped figure must read as low so the UI never badges it "Market price".
  if ((method === 'market' || method === 'ebay_rss' || method === 'ebay_sold') && fresh !== 'expired') return 'medium';
  if (method === 'brickeconomy' && fresh !== 'expired') {
    const hasBrickOwl = sources.some(s => s.id === 'brickowl_new' && s.value);
    return (hasBrickLink || hasEbay || hasBrickOwl) ? 'medium' : 'low';
  }
  return 'low';
}

export function primaryValueSource(row: Record<string, unknown>): string {
  switch (String(row.valuation_method || '')) {
    case 'brickeconomy': return 'brickeconomy';
    case 'market': return 'bricklink_new';
    case 'ebay_rss': return 'ebay_legacy';
    case 'ebay_sold': return 'ebay_sold_new';
    case 'ai': return 'ai_estimate';
    case 'formula_bulk': return 'formula';
    default: return 'unknown';
  }
}

export function valuationExplanation(row: Record<string, unknown>, confidence: MarketConfidence, freshness: MarketFreshness): string {
  const method = String(row.valuation_method || '');
  const prefix = confidence === 'high'
    ? 'High confidence'
    : confidence === 'medium'
      ? 'Medium confidence'
      : confidence === 'low'
        ? 'Low confidence'
        : 'Estimated';
  const stale = freshness === 'expired' ? ' The value is due for refresh.' : freshness === 'stale' ? ' The value is older than 60 days.' : '';
  if (method === 'brickeconomy') return `${prefix}: BrickEconomy is primary, with BrickLink/eBay used when available.${stale}`;
  if (method === 'market') return `${prefix}: BrickLink sold data is primary, with eBay used as a cross-check.${stale}`;
  if (method === 'ebay_rss') return `${prefix}: legacy eBay completed-listing data is the current fallback source until sold comps refresh.${stale}`;
  if (method === 'ebay_sold') return `${prefix}: eBay US/USD sold comps are the current fallback source.${stale}`;
  if (method === 'ai') return `${prefix}: AI estimated this value because market sources were unavailable.${stale}`;
  return `${prefix}: formula valuation is used until a market refresh completes.${stale}`;
}

// ---------------------------------------------------------------------------
// Valuation v2 — multi-source blended fair value (new condition)
// ---------------------------------------------------------------------------
export interface BlendedValue {
  value: number | null;
  low: number | null;
  high: number | null;
  confidence: MarketConfidence | null;
  basis: { id: string; name: string; value: number; weight: number }[];
  // Source-anonymized plain-language note when signals materially disagree or the
  // value moved sharply off its own recent trend (per the B1 convention — never
  // names a provider). null when there's nothing noteworthy to explain.
  note: string | null;
}

// Trailing price-history summary the blend consults so a value that has jumped
// off its own recent trend can't read as trustworthy. Supplied by the caller
// (async DB read) so blendMarketValue stays pure and testable.
export interface BlendHistory {
  recentMedian: number | null;
  points: number;
  days?: number;
  firstValue?: number | null;
  lastValue?: number | null;
}

// Admin-tunable per-source weight multipliers (default 1.0 = unchanged). Set
// from the DB source-config at the start of a blend pass (lib/source-config.ts).
const sourceWeightMultipliers: Record<string, number> = {};
// Direct library callers (tests/jobs) see the v3 result. HTTP requests always
// set the deployed rollout percentage in middleware before any route runs.
let pricingV3ReadPercent = 100;

export function setPricingV3ReadPercent(value: unknown): void {
  const parsed = Number(value);
  pricingV3ReadPercent = Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.floor(parsed))) : 0;
}

export function pricingV3ReadEnabled(setNum: unknown, percent = pricingV3ReadPercent): boolean {
  const bounded = Math.min(100, Math.max(0, Math.floor(Number(percent) || 0)));
  if (bounded <= 0) return false;
  if (bounded >= 100) return true;
  let hash = 2166136261;
  for (const char of String(setNum || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < bounded;
}

export interface HoldingValuationRow {
  set_num?: unknown;
  condition?: unknown;
  current_value?: unknown;
  blended_value?: unknown;
  used_value?: unknown;
  ebay_used_value?: unknown;
  bo_used_value?: unknown;
  pc_new_value?: unknown;
  pc_complete_value?: unknown;
  v3_new_fair?: unknown;
  v3_used_fair?: unknown;
}

/** One rollout-aware value chain shared by collection, profile and snapshots. */
export function holdingValueForRollout(
  row: HoldingValuationRow,
  percent = pricingV3ReadPercent,
): number {
  const legacyNew = num(row.blended_value) || num(row.current_value) || 0;
  const legacyUsed = num(row.ebay_used_value) || num(row.used_value)
    || num(row.bo_used_value) || legacyNew;
  const isUsed = String(row.condition || '').startsWith('used');
  const quarantineOverride = !!(num(row.pc_new_value) || num(row.pc_complete_value));
  if (!pricingV3ReadEnabled(row.set_num, percent) && !quarantineOverride) {
    return isUsed ? legacyUsed : legacyNew;
  }

  const v3New = num(row.v3_new_fair) || legacyNew;
  if (!isUsed) return v3New;
  return num(row.v3_used_fair) || v3New || legacyUsed;
}
export function setSourceWeightMultipliers(m: Record<string, number>): void {
  for (const k of Object.keys(sourceWeightMultipliers)) delete sourceWeightMultipliers[k];
  for (const [k, v] of Object.entries(m)) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) sourceWeightMultipliers[k] = n;
  }
}
export function resetSourceWeightMultipliers(): void {
  for (const k of Object.keys(sourceWeightMultipliers)) delete sourceWeightMultipliers[k];
}

function sourceOwner(signal: PricingSignal): string {
  if (signal.source.startsWith('bricklink')) return 'bricklink';
  if (signal.source.startsWith('ebay')) return 'ebay';
  if (signal.source.startsWith('brickeconomy')) return 'brickeconomy';
  if (signal.source.startsWith('brickowl')) return 'brickowl';
  if (signal.source.startsWith('pricecharting')) return 'pricecharting';
  if (signal.source.startsWith('stockx')) return 'stockx';
  return signal.source;
}

function effectiveSignals(row: Record<string, unknown>, extraSignals: PricingSignal[] = []): PricingSignal[] {
  return [...legacySignalsFor(row), ...extraSignals].filter((signal) => {
    const multiplier = sourceWeightMultipliers[sourceOwner(signal)];
    return multiplier == null || multiplier > 0;
  });
}

function computeV3State(
  row: Record<string, unknown>,
  condition: 'new_sealed' | 'used_complete' | 'loose',
  history?: BlendHistory,
  extraSignals: PricingSignal[] = [],
): ValuationStateV3 {
  return valueSignalsV3(condition, effectiveSignals(row, extraSignals), history);
}

/**
 * Blend the available NEW-condition market signals into one fair value with a
 * confidence band. Sold comps (BrickLink, eBay) weigh highest, then a modeled
 * value, then live listings. A haircut eBay *asking* price is used only as a
 * soft fallback when none of those exist. Used, retail, and AI/formula
 * estimates are excluded.
 *
 * Accuracy guards (valuation v2.1):
 *  - Outlier rejection: with >=3 points, drop anything beyond [0.4, 2.5]x the
 *    median; with exactly 2 points (no median to anchor on) a gross >2.5x
 *    divergence across DIFFERENT reliability tiers resolves to the more
 *    trustworthy tier, so one bad listing/scrape can't drag the value halfway
 *    to a wrong number.
 *  - Confidence calibration: "high" is earned only when >=2 fresh sold comps
 *    actually corroborate (within ~40%); fresh comps that disagree materially
 *    are demoted to medium, and grossly (>2.2x) to low. Corroboration, not mere
 *    presence, drives the grade.
 *
 * Pure + read-side: it never writes and never mutates current_value.
 */
export function blendMarketValue(row: Record<string, unknown>, history?: BlendHistory): BlendedValue {
  const v3 = computeV3State(row, 'new_sealed', history);
  const v3Note = v3.flags.includes('history_anomaly')
    ? 'This value moved sharply away from its recent trend and is shown at low confidence until independent sales confirm it.'
    : v3.flags.includes('source_conflict')
      ? 'Market signals disagree materially; use the likely range rather than the headline alone.'
      : v3.flags.includes('identity_unverified')
        ? 'One or more source matches are quarantined and excluded from this value.'
        : null;
  return {
    value: v3.fair_value,
    low: v3.low,
    high: v3.high,
    confidence: v3.fair_value ? v3.confidence : null,
    basis: v3.basis.map((family) => ({
      id: family.provider_family,
      name: family.provider_family,
      value: family.value,
      weight: family.signal_type === 'sold' ? 1 : family.signal_type === 'modeled' ? 0.65 : 0.35,
    })),
    note: v3Note,
  };

  /* Legacy v2 implementation is retained temporarily below as unreachable code
   * for a one-release rollback diff. It will be deleted after v3 shadow data is
   * stable. All live callers return above. */
  /*
  const method = String(row.valuation_method || '');
  type P = { id: string; name: string; value: number; weight: number; sold: boolean; fresh: boolean; rank: number };
  const pts: P[] = [];
  const push = (id: string, name: string, value: number | null, qty: number | null, ts: unknown, typeF: number, sold: boolean, rank: number) => {
    if (!value || value <= 0) return;
    const mult = sourceWeightMultipliers[SOURCE_OF[id]] ?? 1;
    if (mult <= 0) return; // source weight tuned to 0 → effectively disabled
    const ff = freshnessFactor(ts);
    const w = ff * sampleFactor(qty) * typeF * mult;
    if (w <= 0) return;
    pts.push({ id, name, value, weight: w, sold, fresh: ff >= 0.7, rank });
  };

  push('bricklink_new', 'BrickLink', num(row.bl_new_value), num(row.bl_new_qty), row.bl_cached_at, 1.0, true, RANK_SOLD);
  // Weight eBay sold comps by when the items ACTUALLY sold (ebay_new_last_sold),
  // not when we fetched them — a set last sold months ago is a stale comp even
  // if refreshed today. Falls back to fetch time when no sale date was captured.
  push('ebay_sold_new', 'eBay sold', num(row.ebay_new_value), num(row.ebay_new_qty), row.ebay_new_last_sold || row.ebay_new_cached_at, 1.0, true, RANK_SOLD);
  // BrickEconomy's value is only stored as current_value when it's the method.
  if (method === 'brickeconomy') push('brickeconomy', 'BrickEconomy', num(row.current_value), null, row.be_cached_at || row.cached_at, 0.9, false, RANK_MODEL);
  push('brickowl_new', 'BrickOwl', num(row.bo_new_value), null, row.bo_cached_at, 0.7, false, RANK_LISTING);
  // PriceCharting sealed price — aggregated closed eBay auctions; an independent
  // sold comp source. When it agrees with BrickLink within ~40%, the blend reaches
  // "high" confidence without eBay Marketplace Insights approval.
  push('pc_new', 'Market data', num(row.pc_new_value), null, row.pc_cached_at, 0.95, true, RANK_SOLD);
  // PriceCharting complete-in-box — same auction source, different condition;
  // corroborating only (not a sealed comp, so sold=false for confidence gating).
  push('pc_complete', 'Market data', num(row.pc_complete_value), null, row.pc_cached_at, 0.75, false, RANK_MODEL);
  // eBay asking (median of active Browse listings) — soft FALLBACK only: used
  // when no sold/BrickEconomy/BrickOwl point exists, haircut + lowest weight, so
  // it fills the gap for unpriced sets without dragging real-comp blends upward.
  if (!pts.length) {
    const ask = num(row.ebay_ask_value);
    push('ebay_ask', 'eBay asking', ask ? Math.round(ask * EBAY_ASK_DISCOUNT * 100) / 100 : null, num(row.ebay_ask_qty), row.ebay_ask_cached_at, EBAY_ASK_TYPE_FACTOR, false, RANK_ASK);
  }

  if (!pts.length) return { value: null, low: null, high: null, confidence: null, basis: [], note: null };

  // --- Outlier / anomaly rejection -----------------------------------------
  let survivors = pts;
  if (pts.length >= 3) {
    // Drop gross outliers against the median ratio.
    const sorted = pts.map(p => p.value).sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    const kept = pts.filter(p => p.value / med <= 2.5 && p.value / med >= 0.4);
    if (kept.length) survivors = kept;
  } else if (pts.length === 2) {
    // Two points, no median to anchor on: if they grossly diverge AND sit in
    // different reliability tiers, trust the higher tier rather than averaging a
    // sold comp against a wild listing/scrape. Same-tier divergence (two sold
    // comps) is kept — it reads as low confidence below, not a silent pick.
    const [a, b] = pts;
    const ratio = Math.max(a.value, b.value) / Math.min(a.value, b.value);
    if (ratio > DIVERGENCE_RATIO && a.rank !== b.rank) survivors = [a.rank > b.rank ? a : b];
  }

  const wsum = survivors.reduce((s, p) => s + p.weight, 0);
  const value = Math.round((survivors.reduce((s, p) => s + p.value * p.weight, 0) / wsum) * 100) / 100;
  const vals = survivors.map(p => p.value);
  let low = Math.min(...vals);
  let high = Math.max(...vals);
  if (survivors.length === 1) {
    const blMin = num(row.bl_new_min);
    const blMax = num(row.bl_new_max);
    const isBl = survivors[0].id === 'bricklink_new';
    low = isBl && blMin ? blMin : Math.round(value * 0.9 * 100) / 100;
    high = isBl && blMax ? blMax : Math.round(value * 1.1 * 100) / 100;
  }

  // --- Confidence calibration ----------------------------------------------
  // High confidence is earned by CORROBORATION, not mere count: >=2 fresh sold
  // comps that agree within ~40% → high; materially apart → medium; grossly
  // apart (>2.2x) → low. A lone fresh sold comp or a fresh modeled value → medium.
  const freshSoldVals = survivors.filter(p => p.sold && p.fresh).map(p => p.value);
  const beFresh = survivors.some(p => p.id === 'brickeconomy' && p.fresh);
  let confidence: MarketConfidence;
  if (freshSoldVals.length >= 2) {
    const lo = Math.min(...freshSoldVals);
    const hi = Math.max(...freshSoldVals);
    const soldRatio = lo > 0 ? hi / lo : Number.POSITIVE_INFINITY;
    confidence = soldRatio <= 1.4 ? 'high' : soldRatio <= 2.2 ? 'medium' : 'low';
  } else if (freshSoldVals.length >= 1 || beFresh) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // --- Calibrated confidence band ------------------------------------------
  // Start from the real dispersion of the surviving signals (low/high above),
  // then widen by an uncertainty half-width keyed to confidence so the band
  // reflects how well-supported the value is. Always contains `value`.
  const anyFresh = survivors.some(p => p.fresh);
  let halfWidth = BAND_HALF_WIDTH[confidence] ?? 0.30;
  if (survivors.length === 1) halfWidth += BAND_SINGLE_SOURCE_EXTRA;
  if (!anyFresh) halfWidth += BAND_STALE_EXTRA;
  // Liquidity calibration: thin markets widen, deep markets tighten the band.
  const salesVolume = Number(row.pc_sales_volume);
  if (Number.isFinite(salesVolume) && salesVolume > 0) {
    if (salesVolume < LIQUIDITY_THIN) halfWidth += BAND_ILLIQUID_EXTRA;
    else if (salesVolume >= LIQUIDITY_DEEP) halfWidth = Math.max(BAND_HALF_WIDTH.high, halfWidth - BAND_LIQUID_TIGHTEN);
  }
  halfWidth = Math.min(halfWidth, BAND_MAX_HALF_WIDTH);
  let bandLow = Math.min(low, value * (1 - halfWidth));
  let bandHigh = Math.max(high, value * (1 + halfWidth));

  let note: string | null = null;

  // --- Disagreement transparency -------------------------------------------
  // Source-anonymized note when the surviving signals materially diverge, so the
  // user understands a wide range instead of a single confident number.
  if (survivors.length >= 2) {
    const sv = survivors.map(p => p.value);
    const lo = Math.min(...sv);
    const hi = Math.max(...sv);
    if (lo > 0 && hi / lo >= DISAGREEMENT_RATIO) {
      const gapPct = Math.round((1 - lo / hi) * 100);
      const soldIsLow = survivors.some(p => p.sold && p.value === lo);
      note = soldIsLow
        ? `Recent sales run about ${gapPct}% below listing guides — weighted toward realized sales.`
        : `Market signals disagree by about ${gapPct}% — treat the range as wide.`;
    }
  }

  // --- History anomaly guard (self-correction) -----------------------------
  // A value sharply off its own recent trend, not backed by >=2 fresh sold comps,
  // is suspicious. Keep the latest number but demote to low confidence and widen
  // the band to span the historical level so it never reads as trustworthy.
  if (history && history.recentMedian && history.recentMedian > 0 && history.points >= ANOMALY_MIN_HISTORY_POINTS) {
    const ratio = value / history.recentMedian;
    const corroborated = freshSoldVals.length >= 2;
    if (!corroborated && (ratio > ANOMALY_HIGH_RATIO || ratio < ANOMALY_LOW_RATIO)) {
      confidence = 'low';
      bandLow = Math.min(bandLow, Math.min(value, history.recentMedian) * 0.95);
      bandHigh = Math.max(bandHigh, Math.max(value, history.recentMedian) * 1.05);
      note = ratio > 1
        ? 'This value jumped above its recent trend on limited data — shown at low confidence until more sales confirm it.'
        : 'This value dropped below its recent trend on limited data — shown at low confidence until more sales confirm it.';
    }
  }

  return {
    value,
    low: Math.round(bandLow * 100) / 100,
    high: Math.round(bandHigh * 100) / 100,
    confidence,
    basis: survivors.map(p => ({ id: p.id, name: p.name, value: p.value, weight: Math.round(p.weight * 100) / 100 })),
    note,
  };
  */
}

// ---------------------------------------------------------------------------
// Deal signal (E3a) — buy / fair / premium from signals we already collect.
// ---------------------------------------------------------------------------
export type DealVerdict = 'buy' | 'fair' | 'premium';
export interface DealSignal {
  signal: DealVerdict | null;          // null when we can't responsibly assess
  available_price: number | null;       // cheapest price you can actually pay now
  available_channel: 'retail' | 'resale' | null; // INTERNAL — UI must stay source/channel-anonymized per B1
  available_merchant: string | null;    // named buy destination (e.g. "Target") when the cheapest channel is a live pricesAPI retail offer; null for anonymized channels
  discount_pct: number | null;          // % the available price sits below market (positive = below = good)
  strong: boolean;                       // extra conviction (below value AND about to retire)
  reason: string;                        // plain-language, no source names
}

// A buyable price this far below (above) the market value flips the verdict to
// buy (premium). Inside the band it reads "fair". 10% keeps noise from flipping
// the call while still catching genuine deals.
const DEAL_BUY_THRESHOLD = 0.10;
const DEAL_PREMIUM_THRESHOLD = 0.10;

/**
 * Compare the authoritative market value against the cheapest price the user
 * could actually pay right now — the live retail price when the set is in stock
 * at retail, otherwise the current resale asking price — and call it buy / fair
 * / premium. A set selling below value that is also about to retire is a
 * "strong" buy (limited window).
 *
 * Only fires against a real market blend at medium+ confidence: a directional
 * buy/premium call on an estimated or thinly-supported value would be noise, so
 * those return a null signal. Pure + read-side; never names a source to users.
 */
export function computeDealSignal(
  row: Record<string, unknown>,
  market: { value: number | null; confidence: MarketConfidence | null },
): DealSignal {
  const none: DealSignal = { signal: null, available_price: null, available_channel: null, available_merchant: null, discount_pct: null, strong: false, reason: '' };
  const mv = market.value;
  if (!mv || mv <= 0) return none;
  // Need a corroborated value to judge a deal against — skip estimated/low.
  if (market.confidence !== 'high' && market.confidence !== 'medium') return none;

  // Cheapest retail channel right now: lego.com (when in stock) vs the cheapest
  // live pricesAPI merchant offer (when in stock). lego.com is unnamed; a
  // pricesAPI offer carries its merchant so the UI can show a buy destination.
  const legoRetail = Number(row.lego_in_stock) === 1 ? num(row.retail_price) : null;
  const paInStock = Number(row.pa_in_stock) === 1;
  const paOffer = paInStock ? num(row.pa_lowest_offer) : null;
  const paMerchant = paInStock && typeof row.pa_best_merchant === 'string' ? row.pa_best_merchant : null;
  let retail: number | null = null;
  let retailMerchant: string | null = null;
  if (legoRetail != null && (paOffer == null || legoRetail <= paOffer)) { retail = legoRetail; retailMerchant = null; }
  else if (paOffer != null) { retail = paOffer; retailMerchant = paMerchant; }

  // …vs current resale asking; take the lower across retail and resale.
  const ask = num(row.ebay_ask_value);
  let availablePrice: number | null = null;
  let channel: 'retail' | 'resale' | null = null;
  let merchant: string | null = null;
  if (retail != null && (ask == null || retail <= ask)) { availablePrice = retail; channel = 'retail'; merchant = retailMerchant; }
  else if (ask != null) { availablePrice = ask; channel = 'resale'; merchant = null; }
  if (availablePrice == null) return none;

  const discount = (mv - availablePrice) / mv;          // >0 → below market
  const discountPct = Math.round(discount * 1000) / 10; // one decimal
  const retiring = Number(row.retirement_risk_score) >= 70 || !!row.lego_retiring_soon;

  let signal: DealVerdict;
  if (discount >= DEAL_BUY_THRESHOLD) signal = 'buy';
  else if (discount <= -DEAL_PREMIUM_THRESHOLD) signal = 'premium';
  else signal = 'fair';

  const strong = signal === 'buy' && retiring;
  const absPct = Math.abs(discountPct);
  let reason: string;
  if (signal === 'buy') {
    reason = channel === 'retail'
      ? `Available at retail about ${absPct}% below its market value.`
      : `Selling about ${absPct}% below its market value.`;
    if (strong) reason += ' Retiring soon — limited buying window.';
  } else if (signal === 'premium') {
    reason = channel === 'retail'
      ? 'Currently priced above its market value.'
      : 'Asking prices sit above its market value.';
  } else {
    reason = 'Priced in line with its market value.';
  }

  return { signal, available_price: availablePrice, available_channel: channel, available_merchant: merchant, discount_pct: discountPct, strong, reason };
}

// Minimum quantity-weighted price coverage before a part-out value is shown.
// A figure built from <90% of a set's pieces understates badly, so withhold it.
const PART_OUT_MIN_COVERAGE = 0.9;

export function enrichSetRecord<T extends Record<string, unknown>>(row: T, history?: BlendHistory): T {
  const sources = buildMarketSources(row);
  const freshness = marketFreshness(row);
  const storedNew = row.__valuation_new as ValuationStateV3 | undefined;
  const storedUsed = row.__valuation_used as ValuationStateV3 | undefined;
  const newState = storedNew?.model_version === 'v3' ? storedNew : computeV3State(row, 'new_sealed', history);
  const usedState = storedUsed?.model_version === 'v3' ? storedUsed : computeV3State(row, 'used_complete');
  const rolloutReadEnabled = pricingV3ReadEnabled(row.set_num);
  const quarantineOverride = !!(
    newState.fair_value && (num(row.pc_new_value) || num(row.pc_complete_value))
  );
  const v3ReadEnabled = rolloutReadEnabled || quarantineOverride;
  const legacyValue = num(row.blended_value) || num(row.current_value);
  const legacyConfidence = String(row.blended_confidence || '') as MarketConfidence;
  const confidence = v3ReadEnabled && newState.fair_value
    ? newState.confidence
    : legacyConfidence || marketConfidence(row, sources);
  const blend: BlendedValue = {
    value: newState.fair_value,
    low: newState.low,
    high: newState.high,
    confidence: newState.fair_value ? newState.confidence : null,
    basis: newState.basis.map(family => ({ id: family.provider_family, name: family.provider_family, value: family.value, weight: family.signal_type === 'sold' ? 1 : 0.5 })),
    note: newState.flags.includes('source_conflict') ? 'Market signals disagree materially; use the likely range rather than the headline alone.' : null,
  };
  const publicBlend: BlendedValue = v3ReadEnabled
    ? blend
    : {
        value: legacyValue,
        low: num(row.blended_low),
        high: num(row.blended_high),
        confidence: legacyConfidence || (legacyValue ? marketConfidence(row, sources) : null),
        basis: [],
        note: null,
      };
  const deal = computeDealSignal(row, { value: blend.value, confidence: blend.confidence });
  // Part-out (E1): expose the stored sum-of-parts value only when coverage is
  // high enough to be trustworthy; always expose coverage so the UI can explain.
  const partOutCoverage = Number(row.part_out_coverage);
  const partOutValue = num(row.part_out_value);
  const storedForecast = row.__valuation_forecast as ReturnType<typeof buildForecastV3> | undefined;
  const forecast = storedForecast || buildForecastV3(newState, history, {
    twoYear: num(row.be_forecast_2y) || num(row.forecast_2y),
    fiveYear: num(row.be_forecast_5y) || num(row.forecast_5y),
    sourceBaseline: num(row.be_value_new) || num(row.current_value),
    asOf: text(row.be_cached_at) || text(row.cached_at),
  });
  const acquisitionPrice = num(row.pa_lowest_offer)
    || (Number(row.lego_in_stock) === 1 ? num(row.retail_price) : null);
  const retailOffer = row.__retail_offer as Record<string, unknown> | undefined;
  const publicRow = { ...row } as Record<string, unknown>;
  delete publicRow.__valuation_new;
  delete publicRow.__valuation_used;
  delete publicRow.__valuation_forecast;
  delete publicRow.__retail_offer;
  for (const key of Object.keys(publicRow)) if (key.startsWith('v3_')) delete publicRow[key];
  return {
    ...publicRow,
    market_sources: sources,
    primary_value_source: primaryValueSource(row),
    confidence,
    freshness,
    valuation_explanation: valuationExplanation(row, confidence, freshness),
    // Valuation v2 (additive; current_value is unchanged).
    market_value: publicBlend.value,
    market_value_low: publicBlend.low,
    market_value_high: publicBlend.high,
    market_value_confidence: publicBlend.confidence,
    market_value_basis: publicBlend.basis,
    market_value_note: publicBlend.note,
    // Pricing v3 contract. Legacy fields stay present during the dual-write
    // window, while every new surface reads one condition-aware object.
    valuation: {
      currency: 'USD',
      model_version: 'v3',
      read_enabled: v3ReadEnabled,
      read_reason: quarantineOverride ? 'pricecharting_quarantine' : (rolloutReadEnabled ? 'rollout' : 'legacy'),
      rollout_percent: pricingV3ReadPercent,
      as_of: newState.as_of,
      new: { ...newState, independent_families: newState.independent_family_count },
      used: { ...usedState, independent_families: usedState.independent_family_count },
      forecast,
      acquisition: {
        market: String(retailOffer?.market || row.pa_market || 'FR').toUpperCase(),
        currency: String(retailOffer?.currency || 'USD').toUpperCase(),
        msrp: num(retailOffer?.msrp) || num(row.brickset_msrp) || num(row.retail_price),
        item_price: num(retailOffer?.item_price) || acquisitionPrice,
        delivered_price: num(retailOffer?.delivered_price) || acquisitionPrice,
        merchant: text(retailOffer?.merchant) || text(row.pa_best_merchant),
        offer_count: Number(retailOffer?.offer_count || row.pa_offer_count || 0),
        lowest_90d: num(retailOffer?.lowest_90d),
        all_time_low: num(retailOffer?.all_time_low),
        deal_score: deal.signal,
        checked_at: text(retailOffer?.checked_at) || text(row.pa_cached_at) || text(row.lego_checked_at),
      },
      part_out: {
        value: partOutValue != null && Number.isFinite(partOutCoverage) && partOutCoverage >= PART_OUT_MIN_COVERAGE
          ? partOutValue
          : null,
        coverage: Number.isFinite(partOutCoverage) ? partOutCoverage : null,
        source_age: text(row.part_out_cached_at),
      },
    },
    // Deal signal v1 (E3a; additive, read-side).
    deal_signal: deal.signal,
    deal_available_price: deal.available_price,
    deal_available_channel: deal.available_channel,
    deal_available_merchant: deal.available_merchant,
    deal_discount_pct: deal.discount_pct,
    deal_strong: deal.strong,
    deal_reason: deal.reason,
    // Part-out value (E1; additive, read-side). Value gated on high coverage.
    part_out_value: partOutValue != null && Number.isFinite(partOutCoverage) && partOutCoverage >= PART_OUT_MIN_COVERAGE
      ? partOutValue
      : null,
    part_out_coverage: Number.isFinite(partOutCoverage) ? partOutCoverage : null,
    // Liquidity (PriceCharting yearly units sold). Additive, read-side; the UI
    // turns this into a "sells fast / slow" badge (Phase 3).
    sales_volume: (() => { const v = Number(row.pc_sales_volume); return Number.isFinite(v) && v > 0 ? Math.round(v) : null; })(),
  } as unknown as T;
}

// ---------------------------------------------------------------------------
// Persisting the blend — Approach A (portfolio basis = blended market value).
// blendMarketValue() is pure/read-side; these helpers also store the result on
// lego_sets.blended_value so the SQL-side portfolio sums (profile stat, daily
// snapshots) and the collection total can COALESCE(blended_value, current_value)
// without re-running the JS blend. Both FAIL OPEN: a blend write must never
// break a price refresh, and they no-op gracefully if the column has not been
// migrated onto the database yet.
// ---------------------------------------------------------------------------

// Columns blendMarketValue() reads. Re-selected after a price write so the
// blend reflects the freshly stored signals (no fragile in-memory merge).
export const BLEND_INPUT_COLUMNS =
  // pieces + brickset_msrp + be_retail feed the BrickEconomy plausibility
  // quarantine in legacySignalsFor (independent anchors for an LLM-scraped
  // value; be_retail marks a retail_price as scrape-derived, not independent).
  'pieces, brickset_msrp, be_retail, ' +
  'valuation_method, current_value, used_value, bl_new_value, bl_new_qty, bl_new_min, bl_new_max, ' +
  'bl_used_qty, bl_used_min, bl_used_max, bl_cached_at, ' +
  'ebay_new_value, ebay_new_qty, ebay_new_cached_at, ebay_new_last_sold, ' +
  'ebay_used_value, ebay_used_qty, ebay_used_cached_at, ebay_used_last_sold, ' +
  'be_value_new, be_value_used, be_cached_at, cached_at, ' +
  'bo_new_value, bo_new_qty, bo_used_value, bo_used_qty, bo_cached_at, ' +
  'ebay_ask_value, ebay_ask_qty, ebay_ask_cached_at, ' +
  'pc_new_value, pc_complete_value, pc_cached_at, ' +
  // Extra inputs the deal signal needs (persisted alongside blended_value so the
  // catalog deal filter + deal alerts share one source of truth with the badge).
  'retail_price, lego_in_stock, retirement_risk_score, lego_retiring_soon';

// Extended market inputs that live in the set_market_ext side table (lego_sets is
// at D1's 100-column ceiling). LEFT JOINed into the blend reads below so the deal
// signal (pa_*) and the used/liquidity blend inputs (pc_loose/sales-volume) share
// the same row the pure functions consume.
export const BLEND_EXT_COLUMNS =
  'pc_loose_value, pc_sales_volume, pa_retail_value, pa_lowest_offer, pa_in_stock, ' +
  'pa_best_merchant, pa_offer_count, pa_market, pa_cached_at, ' +
  // StockX lowest ask (corroborating new-sealed asking signal in legacySignalsFor).
  'stockx_ask, stockx_cached_at';
const BLEND_FROM = 'lego_sets ls LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num';

// Compute the blended value AND the deal signal together, so the persisted
// deal_* columns are produced by the exact same computeDealSignal used for the
// read-time badge — no SQL re-implementation, no divergence.
function blendAndDealRow(row: Record<string, unknown>, history?: BlendHistory, extraSignals: PricingSignal[] = []): {
  blended: number | null; signal: string | null; pct: number | null; strong: number;
  confidence: string | null; low: number | null; high: number | null;
  newState: ValuationStateV3; usedState: ValuationStateV3;
} {
  const newState = computeV3State(row, 'new_sealed', history, extraSignals);
  const usedState = computeV3State(row, 'used_complete', undefined, extraSignals);
  const blend: BlendedValue = {
    value: newState.fair_value,
    low: newState.low,
    high: newState.high,
    confidence: newState.fair_value ? newState.confidence : null,
    basis: newState.basis.map(family => ({
      id: family.provider_family,
      name: family.provider_family,
      value: family.value,
      weight: family.signal_type === 'sold' ? 1 : family.signal_type === 'modeled' ? 0.65 : 0.35,
    })),
    note: null,
  };
  const deal = computeDealSignal(row, { value: blend.value, confidence: blend.confidence });
  return {
    blended: blend.value, signal: deal.signal, pct: deal.discount_pct, strong: deal.strong ? 1 : 0,
    confidence: blend.confidence, low: blend.low, high: blend.high,
    newState, usedState,
  };
}

async function loadNormalizedSignals(db: D1Database, setNums: string[]): Promise<Map<string, PricingSignal[]>> {
  const out = new Map<string, PricingSignal[]>();
  if (!setNums.length) return out;
  try {
    const placeholders = setNums.map(() => '?').join(',');
    const { results } = await db.prepare(`
      SELECT set_num, source, provider_family, condition, signal_type, currency,
             value, low, high, sample_count, sales_volume, source_observed_at,
             checked_at, match_status, flags_json
      FROM pricing_signals
      WHERE set_num IN (${placeholders})
        AND match_status IN ('verified','manual')
    `).bind(...setNums).all<Record<string, unknown>>();
    for (const row of results) {
      const setNum = String(row.set_num);
      const signal: PricingSignal = {
        source: String(row.source),
        provider_family: String(row.provider_family),
        condition: row.condition as PricingSignal['condition'],
        signal_type: row.signal_type as PricingSignal['signal_type'],
        currency: String(row.currency || 'USD'),
        value: Number(row.value),
        low: num(row.low),
        high: num(row.high),
        sample_count: row.sample_count == null ? null : Number(row.sample_count),
        sales_volume: row.sales_volume == null ? null : Number(row.sales_volume),
        source_observed_at: text(row.source_observed_at),
        checked_at: text(row.checked_at),
        match_status: row.match_status as PricingSignal['match_status'],
        flags: (() => { try { return JSON.parse(String(row.flags_json || '[]')); } catch { return []; } })(),
      };
      out.set(setNum, [...(out.get(setNum) || []), signal]);
    }
  } catch {
    // Older/local schemas keep using legacy columns until migration lands.
  }
  return out;
}

const VALUATION_STATE_UPSERT_SQL = `
  INSERT INTO set_valuation_state (
    set_num, condition, fair_value, low, high, liquidation_value, confidence,
    confidence_score, sample_count, independent_family_count, basis_json,
    flags_json, forecast_json, as_of, model_version, updated_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'v3-shadow', datetime('now'))
  ON CONFLICT(set_num, condition) DO UPDATE SET
    fair_value=excluded.fair_value, low=excluded.low, high=excluded.high,
    liquidation_value=excluded.liquidation_value, confidence=excluded.confidence,
    confidence_score=excluded.confidence_score, sample_count=excluded.sample_count,
    independent_family_count=excluded.independent_family_count,
    basis_json=excluded.basis_json, flags_json=excluded.flags_json,
    forecast_json=excluded.forecast_json, as_of=excluded.as_of,
    model_version=excluded.model_version, updated_at=datetime('now')
  WHERE set_valuation_state.fair_value IS NOT excluded.fair_value
     OR set_valuation_state.low IS NOT excluded.low
     OR set_valuation_state.high IS NOT excluded.high
     OR set_valuation_state.liquidation_value IS NOT excluded.liquidation_value
     OR set_valuation_state.confidence IS NOT excluded.confidence
     OR set_valuation_state.confidence_score IS NOT excluded.confidence_score
     OR set_valuation_state.sample_count IS NOT excluded.sample_count
     OR set_valuation_state.independent_family_count IS NOT excluded.independent_family_count
     OR set_valuation_state.basis_json IS NOT excluded.basis_json
     OR set_valuation_state.flags_json IS NOT excluded.flags_json
     OR set_valuation_state.forecast_json IS NOT excluded.forecast_json`;

function valuationStateStatement(
  db: D1Database,
  setNum: string,
  state: ValuationStateV3,
  row: Record<string, unknown>,
  history?: BlendHistory,
): D1PreparedStatement {
  const forecast = state.condition === 'new_sealed'
    ? buildForecastV3(state, history, {
      twoYear: num(row.be_forecast_2y) || num(row.forecast_2y),
      fiveYear: num(row.be_forecast_5y) || num(row.forecast_5y),
      sourceBaseline: num(row.be_value_new) || num(row.current_value),
      asOf: text(row.be_cached_at) || text(row.cached_at),
    })
    : null;
  return db.prepare(VALUATION_STATE_UPSERT_SQL).bind(
    setNum,
    state.condition,
    state.fair_value,
    state.low,
    state.high,
    state.liquidation_value,
    state.confidence,
    state.confidence_score,
    state.sample_count,
    state.independent_family_count,
    JSON.stringify(state.basis),
    JSON.stringify(state.flags),
    forecast ? JSON.stringify(forecast) : null,
    state.as_of,
  );
}

// Single UPDATE shape for both persist paths (bind order: blended, signal, pct,
// strong, confidence, low, high, set_num). deal_cached_at marks when the signal
// was last recomputed (shared by the blend + confidence band).
// Numbered params so the trailing guard can re-reference the SET values:
// IS NOT = null-safe inequality, so a recompute that lands on identical
// numbers writes nothing (lego_sets is heavily indexed; the hourly valuate
// sweep re-blends up to ~170 sets and most blends don't move run-to-run).
// deal_cached_at is display metadata, not a scheduling gate, so skipping the
// stamp on unchanged rows is safe.
const BLEND_DEAL_UPDATE_SQL =
  `UPDATE lego_sets SET blended_value=?1, deal_signal=?2, deal_discount_pct=?3, deal_strong=?4, blended_confidence=?5, blended_low=?6, blended_high=?7, deal_cached_at=datetime('now')
   WHERE set_num=?8 AND (
     blended_value IS NOT ?1 OR deal_signal IS NOT ?2 OR deal_discount_pct IS NOT ?3
     OR deal_strong IS NOT ?4 OR blended_confidence IS NOT ?5 OR blended_low IS NOT ?6
     OR blended_high IS NOT ?7)`;

// Recompute + persist blended_value for one set (on-demand detail refresh /
// revalue). Reads the post-write row so it always reflects the latest signals.
export async function persistBlendedValue(db: D1Database, setNum: string): Promise<number | null> {
  try {
    const row = await db.prepare(
      `SELECT ${BLEND_INPUT_COLUMNS}, ${BLEND_EXT_COLUMNS} FROM ${BLEND_FROM} WHERE ls.set_num=?`,
    ).bind(setNum).first<Record<string, unknown>>();
    if (!row) return null;
    const history = await recentValueMedian(db, setNum).catch(() => undefined);
    const signals = await loadNormalizedSignals(db, [setNum]);
    const r = blendAndDealRow(row, history, signals.get(setNum) || []);
    await db.prepare(BLEND_DEAL_UPDATE_SQL).bind(r.blended, r.signal, r.pct, r.strong, r.confidence, r.low, r.high, setNum).run();
    // Side-table dual-write is fail-open for local/older schemas. The legacy
    // headline was already written above, so a migration race cannot break a
    // price refresh.
    await db.batch([
      valuationStateStatement(db, setNum, r.newState, row, history),
      valuationStateStatement(db, setNum, r.usedState, row),
    ]).catch((e) => console.warn(`[pricing-v3] state write failed for ${setNum}:`, (e as Error).message));
    return r.blended;
  } catch (e) {
    console.warn(`[blend] persist failed for ${setNum}:`, (e as Error).message);
    return null;
  }
}

// Recompute blended_value for many sets in one read + chunked batched writes
// per chunk (subrequest-lean for the cron; D1 caps bound params and batch
// size). Returns the number of rows written. Fails open.
export async function recomputeBlendedValues(db: D1Database, setNums: string[]): Promise<number> {
  const ids = [...new Set(setNums.filter(Boolean))];
  if (!ids.length) return 0;
  let written = 0;
  try {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const placeholders = chunk.map(() => '?').join(',');
      const { results } = await db.prepare(
        `SELECT ls.set_num, ${BLEND_INPUT_COLUMNS}, ${BLEND_EXT_COLUMNS} FROM ${BLEND_FROM} WHERE ls.set_num IN (${placeholders})`,
      ).bind(...chunk).all<Record<string, unknown>>();
      // One history read per chunk feeds the anomaly guard (subrequest-lean).
      const medians = await recentValueMedians(db, chunk).catch(() => new Map());
      const signals = await loadNormalizedSignals(db, chunk);
      const computed = results.map(row => {
        const r = blendAndDealRow(row, medians.get(row.set_num as string), signals.get(row.set_num as string) || []);
        return { row, r, history: medians.get(row.set_num as string) };
      });
      const stmts = computed.map(({ row, r }) => db.prepare(BLEND_DEAL_UPDATE_SQL)
        .bind(r.blended, r.signal, r.pct, r.strong, r.confidence, r.low, r.high, row.set_num as string));
      if (stmts.length) {
        const legacyResults = await db.batch(stmts);
        written += legacyResults.reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
      }
      // Keep each D1 batch under 100 statements. Change-only UPSERTs make the
      // steady-state cost close to zero when the fair value has not moved.
      if (computed.length) {
        const newStates = computed.map(({ row, r, history }) => valuationStateStatement(db, row.set_num as string, r.newState, row, history));
        const usedStates = computed.map(({ row, r }) => valuationStateStatement(db, row.set_num as string, r.usedState, row));
        const stateResults = await db.batch(newStates).catch(() => []);
        const usedResults = await db.batch(usedStates).catch(() => []);
        written += [...stateResults, ...usedResults].reduce((sum, result) => sum + Number(result.meta?.changes || 0), 0);
      }
    }
    await recordPricingWrites(db, 'recompute-blends', written);
    return written;
  } catch (e) {
    console.warn('[blend] batch recompute failed:', (e as Error).message);
    return written;
  }
}
