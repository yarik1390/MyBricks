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
  const sources: MarketSource[] = [];

  if (method === 'brickeconomy' && num(row.current_value)) {
    sources.push({
      id: 'brickeconomy',
      name: 'BrickEconomy',
      value: num(row.current_value),
      condition: 'new',
      sample_count: null,
      last_updated: cachedAt,
      freshness: marketFreshness(row),
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
      last_updated: cachedAt,
      freshness: marketFreshness(row),
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
      last_updated: cachedAt,
      freshness: marketFreshness(row),
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
      last_updated: cachedAt,
      freshness: marketFreshness(row),
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
        : text(row.ebay_new_cached_at) || cachedAt,
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
      last_updated: text(row.ebay_used_cached_at) || cachedAt,
      freshness: sourceFreshness(row, 'ebay_used_cached_at', 'ebay_used_value'),
      reliability: 'corroborating',
      note: 'US/USD sold-listing median for used condition.',
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

export function enrichSetRecord<T extends Record<string, unknown>>(row: T): T {
  const sources = buildMarketSources(row);
  const freshness = marketFreshness(row);
  const confidence = marketConfidence(row, sources);
  return {
    ...row,
    market_sources: sources,
    primary_value_source: primaryValueSource(row),
    confidence,
    freshness,
    valuation_explanation: valuationExplanation(row, confidence, freshness),
  };
}
