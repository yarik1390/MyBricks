import { recentValueMedian, recentValueMedians } from './price-trend';

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

  // PriceCharting loose value — item only, no box/manual. A used-condition
  // corroborator from aggregated closed eBay auctions; kept out of the
  // new-value blend (it sits well below sealed) but surfaced as a used source.
  if (num(row.pc_loose_value)) {
    sources.push({
      id: 'pc_loose',
      name: 'Used market',
      value: num(row.pc_loose_value),
      condition: 'used',
      sample_count: null,
      last_updated: text(row.pc_cached_at) || cachedAt,
      freshness: sourceFreshness(row, 'pc_cached_at', 'pc_loose_value'),
      reliability: 'corroborating',
      note: 'Loose (incomplete) value — excludes box and manual.',
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
  if ((method === 'brickeconomy' || method === 'market' || method === 'ebay_rss' || method === 'ebay_sold') && fresh !== 'expired') return 'medium';
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
}

function ageDays(ts: unknown): number | null {
  const s = text(ts);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : (Date.now() - t) / 86_400_000;
}

// Recency weight: fresh data counts fully, older data is discounted.
function freshnessFactor(ts: unknown): number {
  const d = ageDays(ts);
  if (d == null) return 0.1;
  if (d < 7) return 1;
  if (d < 30) return 0.7;
  if (d < 90) return 0.4;
  return 0.15;
}

// Sample-size weight: a guide value backed by many lots is more trustworthy.
// Null (modeled / single-listing sources) gets a neutral mid weight.
function sampleFactor(qty: number | null): number {
  if (qty == null) return 0.7;
  return 0.5 + 0.5 * Math.min(1, qty / 8);
}

// eBay *asking* prices overstate realized value, so they're a soft FALLBACK,
// not a corroborator: used only when no sold/BrickEconomy/BrickOwl signal
// exists, with the median ask haircut by this factor (and the lowest type
// weight). Never a "sold" source, so an ask-only set stays "low" confidence.
// This keeps asks from dragging a real-comp blend upward while still giving
// otherwise-unpriced sets a market-grounded estimate. Revisit once real sold
// comps (Marketplace Insights / scrape) are available.
const EBAY_ASK_DISCOUNT = 0.85;
const EBAY_ASK_TYPE_FACTOR = 0.4;

// Reliability tiers used to arbitrate a two-signal standoff (higher = more
// trusted): fresh sold comps are the gold standard, then a modeled valuation,
// then live listings, then haircut asks. All source values arrive already
// normalized to USD at the fetch layer (BrickLink/BrickOwl are queried with
// currency=USD; eBay comps are US/USD; the modeled value is USD), so the blend
// is a single-currency mix — no per-point conversion is applied or needed here.
const RANK_SOLD = 4;
const RANK_MODEL = 3;
const RANK_LISTING = 2;
const RANK_ASK = 1;
// A two-point standoff this far apart is treated as a real disagreement, not
// noise — matches the >=3-point median outlier band so the two paths agree.
const DIVERGENCE_RATIO = 2.5;

// Confidence band ("likely range") half-width keyed to how well-supported the
// value is: corroborated → tight, thin/estimated → wide. Replaces a flat ±10%
// so the range communicates real uncertainty. Single-source / stale data widen
// it further, capped so it never becomes meaningless.
const BAND_HALF_WIDTH: Record<MarketConfidence, number> = {
  high: 0.06,
  medium: 0.15,
  low: 0.30,
  estimated: 0.35,
};
const BAND_SINGLE_SOURCE_EXTRA = 0.04;
const BAND_STALE_EXTRA = 0.05;
const BAND_MAX_HALF_WIDTH = 0.40;
// Liquidity calibration (PriceCharting yearly units sold). An illiquid set has
// noisier realized prices → widen the band; a deeply liquid one is well-supported
// → modestly tighten. These adjust the band only; they never override confidence.
const LIQUIDITY_THIN = 3;     // < this many sales/yr → illiquid
const LIQUIDITY_DEEP = 30;    // >= this many sales/yr → deep, stable market
const BAND_ILLIQUID_EXTRA = 0.06;
const BAND_LIQUID_TIGHTEN = 0.03;

// Admin-tunable per-source weight multipliers (default 1.0 = unchanged). Set
// from the DB source-config at the start of a blend pass (lib/source-config.ts).
// Maps a blend push id → its owning source so one "trust" slider scales all of a
// source's contributions (e.g. pricecharting scales both pc_new and pc_complete).
const SOURCE_OF: Record<string, string> = {
  bricklink_new: 'bricklink',
  ebay_sold_new: 'ebay', ebay_ask: 'ebay',
  brickeconomy: 'brickeconomy',
  brickowl_new: 'brickowl',
  pc_new: 'pricecharting', pc_complete: 'pricecharting',
};
const sourceWeightMultipliers: Record<string, number> = {};
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

// Surviving signals spanning at least this ratio read as a material disagreement
// worth explaining to the user.
const DISAGREEMENT_RATIO = 1.5;

// History anomaly guard: a blended value this far off its own trailing median,
// when NOT backed by >=2 fresh sold comps, is treated as suspicious — kept as the
// displayed number but demoted to low confidence with a band spanning the
// historical level. Needs a minimum history depth to avoid noise on thin series.
const ANOMALY_HIGH_RATIO = 2.5;
const ANOMALY_LOW_RATIO = 0.4;
const ANOMALY_MIN_HISTORY_POINTS = 5;

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
  const confidence = marketConfidence(row, sources);
  const blend = blendMarketValue(row, history);
  const deal = computeDealSignal(row, { value: blend.value, confidence: blend.confidence });
  // Part-out (E1): expose the stored sum-of-parts value only when coverage is
  // high enough to be trustworthy; always expose coverage so the UI can explain.
  const partOutCoverage = Number(row.part_out_coverage);
  const partOutValue = num(row.part_out_value);
  return {
    ...row,
    market_sources: sources,
    primary_value_source: primaryValueSource(row),
    confidence,
    freshness,
    valuation_explanation: valuationExplanation(row, confidence, freshness),
    // Valuation v2 (additive; current_value is unchanged).
    market_value: blend.value,
    market_value_low: blend.low,
    market_value_high: blend.high,
    market_value_confidence: blend.confidence,
    market_value_basis: blend.basis,
    market_value_note: blend.note,
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
  };
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
  'valuation_method, current_value, bl_new_value, bl_new_qty, bl_new_min, bl_new_max, ' +
  'bl_cached_at, ebay_new_value, ebay_new_qty, ebay_new_cached_at, ebay_new_last_sold, be_cached_at, ' +
  'cached_at, bo_new_value, bo_cached_at, ' +
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
  'pc_loose_value, pc_sales_volume, pa_retail_value, pa_lowest_offer, pa_in_stock, pa_best_merchant, pa_offer_count';
const BLEND_FROM = 'lego_sets ls LEFT JOIN set_market_ext ext ON ext.set_num = ls.set_num';

// Compute the blended value AND the deal signal together, so the persisted
// deal_* columns are produced by the exact same computeDealSignal used for the
// read-time badge — no SQL re-implementation, no divergence.
function blendAndDealRow(row: Record<string, unknown>, history?: BlendHistory): {
  blended: number | null; signal: string | null; pct: number | null; strong: number;
  confidence: string | null; low: number | null; high: number | null;
} {
  const blend = blendMarketValue(row, history);
  const deal = computeDealSignal(row, { value: blend.value, confidence: blend.confidence });
  return {
    blended: blend.value, signal: deal.signal, pct: deal.discount_pct, strong: deal.strong ? 1 : 0,
    confidence: blend.confidence, low: blend.low, high: blend.high,
  };
}

// Single UPDATE shape for both persist paths (bind order: blended, signal, pct,
// strong, confidence, low, high, set_num). deal_cached_at marks when the signal
// was last recomputed (shared by the blend + confidence band).
const BLEND_DEAL_UPDATE_SQL =
  `UPDATE lego_sets SET blended_value=?, deal_signal=?, deal_discount_pct=?, deal_strong=?, blended_confidence=?, blended_low=?, blended_high=?, deal_cached_at=datetime('now') WHERE set_num=?`;

// Recompute + persist blended_value for one set (on-demand detail refresh /
// revalue). Reads the post-write row so it always reflects the latest signals.
export async function persistBlendedValue(db: D1Database, setNum: string): Promise<number | null> {
  try {
    const row = await db.prepare(
      `SELECT ${BLEND_INPUT_COLUMNS}, ${BLEND_EXT_COLUMNS} FROM ${BLEND_FROM} WHERE ls.set_num=?`,
    ).bind(setNum).first<Record<string, unknown>>();
    if (!row) return null;
    const history = await recentValueMedian(db, setNum).catch(() => undefined);
    const r = blendAndDealRow(row, history);
    await db.prepare(BLEND_DEAL_UPDATE_SQL).bind(r.blended, r.signal, r.pct, r.strong, r.confidence, r.low, r.high, setNum).run();
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
      const stmts = results.map(row => {
        const r = blendAndDealRow(row, medians.get(row.set_num as string));
        return db.prepare(BLEND_DEAL_UPDATE_SQL).bind(r.blended, r.signal, r.pct, r.strong, r.confidence, r.low, r.high, row.set_num as string);
      });
      if (stmts.length) await db.batch(stmts);
      written += stmts.length;
    }
    return written;
  } catch (e) {
    console.warn('[blend] batch recompute failed:', (e as Error).message);
    return written;
  }
}
