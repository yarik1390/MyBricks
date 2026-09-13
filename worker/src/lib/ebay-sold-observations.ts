export type EbaySoldCondition = 'new_sealed' | 'used_complete' | 'unknown';
export type EbaySoldDecision = 'accepted' | 'rejected' | 'review_needed' | 'no_data' | 'error';
export type EbayReferenceFreshness = 'fresh' | 'stale' | 'missing';
export type EbayReferenceStrength = 'trusted' | 'weak' | 'missing';

export interface EbaySoldListingEvidence {
  source_url: string | null;
  item_id: string | null;
  title: string | null;
  price_usd: number | null;
  condition: EbaySoldCondition;
  sold_date: string | null;
  rejection_reason: string | null;
}

export interface EbaySoldReference {
  value: number | null;
  provenance: string;
  freshness: EbayReferenceFreshness;
  strength: EbayReferenceStrength;
  condition: EbaySoldCondition;
}

export interface EbaySoldAssessment {
  decision: EbaySoldDecision;
  rejectionReason: string | null;
}

const MAX_EVIDENCE_PER_RESULT = 12;
const MAX_TITLE = 300;
const MAX_URL = 500;
const MAX_ITEM_ID = 128;
const MAX_REASON = 160;
const REFERENCE_FRESH_DAYS = 60;

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function freshness(raw: unknown, nowMs: number): EbayReferenceFreshness {
  if (typeof raw !== 'string' || !raw.trim()) return 'missing';
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return 'stale';
  const ageMs = nowMs - timestamp;
  return ageMs >= 0 && ageMs <= REFERENCE_FRESH_DAYS * 86_400_000 ? 'fresh' : 'stale';
}

function reference(
  value: unknown,
  provenance: string,
  timestamp: unknown,
  condition: EbaySoldCondition,
  strength: EbayReferenceStrength,
  nowMs: number,
): EbaySoldReference | null {
  const numeric = positive(value);
  if (numeric == null) return null;
  const observedFreshness = freshness(timestamp, nowMs);
  return {
    value: numeric,
    provenance,
    freshness: observedFreshness,
    strength: strength === 'trusted' && observedFreshness !== 'fresh' ? 'weak' : strength,
    condition,
  };
}

/** Select an explicit, condition-aware reference. Cross-condition and modeled/formula fallbacks are weak. */
export function selectEbaySoldReference(
  row: Record<string, unknown>,
  condition: Exclude<EbaySoldCondition, 'unknown'>,
  nowMs = Date.now(),
): EbaySoldReference {
  if (condition === 'new_sealed') {
    const bricklink = reference(row.bl_new_value, 'bricklink_new', row.bl_cached_at, 'new_sealed', 'trusted', nowMs);
    if (bricklink) return bricklink;
    const brickeconomy = reference(row.be_value_new, 'brickeconomy_new', row.be_cached_at, 'new_sealed', 'trusted', nowMs);
    if (brickeconomy) return brickeconomy;
    // Legacy rows may identify a BrickEconomy current value without the newer
    // condition staging columns. Keep it explicitly weak rather than treating it
    // as missing or allowing it to promote a sold median.
    if (String(row.valuation_method || '') === 'brickeconomy') {
      const legacyBrickeconomy = reference(row.current_value, 'brickeconomy_legacy_current', row.cached_at || row.be_cached_at, 'new_sealed', 'weak', nowMs);
      if (legacyBrickeconomy) return legacyBrickeconomy;
    }
  } else {
    // used_value is only attributable to BrickLink when a BrickLink used lot count accompanies it.
    if (positive(row.bl_used_qty)) {
      const bricklink = reference(row.used_value, 'bricklink_used', row.bl_cached_at, 'used_complete', 'trusted', nowMs);
      if (bricklink) return bricklink;
    }
    const brickeconomy = reference(row.be_value_used, 'brickeconomy_used', row.be_cached_at, 'used_complete', 'trusted', nowMs);
    if (brickeconomy) return brickeconomy;
    const crossCondition = reference(row.bl_new_value, 'bricklink_new_cross_condition', row.bl_cached_at, 'new_sealed', 'weak', nowMs);
    if (crossCondition) return crossCondition;
  }

  const method = String(row.valuation_method || '');
  const modeled = reference(
    row.current_value,
    method === 'formula_bulk' ? 'formula_bulk_current' : `${method || 'unknown'}_current`,
    row.cached_at,
    condition,
    'weak',
    nowMs,
  );
  if (modeled) return modeled;
  return { value: null, provenance: 'missing', freshness: 'missing', strength: 'missing', condition };
}

/** Trusted references preserve the historic inclusive 1/3x..3x gate. Weak references never promote a sold median. */
export function assessSoldObservation(observed: number, referenceValue: EbaySoldReference): EbaySoldAssessment {
  if (!Number.isFinite(observed) || observed <= 0) return { decision: 'rejected', rejectionReason: 'invalid_observed_value' };
  if (referenceValue.strength !== 'trusted') {
    let reason = 'missing_reference';
    if (referenceValue.freshness === 'stale') reason = 'stale_reference';
    else if (referenceValue.provenance === 'formula_bulk_current') reason = 'formula_reference';
    else if (referenceValue.condition !== 'unknown' && referenceValue.provenance.includes('cross_condition')) reason = 'cross_condition_reference';
    else if (referenceValue.strength === 'weak') reason = 'weak_reference';
    return { decision: 'review_needed', rejectionReason: reason };
  }
  const ref = referenceValue.value;
  if (ref == null) return { decision: 'review_needed', rejectionReason: 'missing_reference' };
  return observed >= ref / 3 && observed <= ref * 3
    ? { decision: 'accepted', rejectionReason: null }
    : { decision: 'rejected', rejectionReason: 'outside_trusted_3x_band' };
}

export function boundedEvidence(rows: EbaySoldListingEvidence[]): EbaySoldListingEvidence[] {
  return rows.slice(0, MAX_EVIDENCE_PER_RESULT).map((row) => ({
    source_url: text(row.source_url, MAX_URL),
    item_id: text(row.item_id, MAX_ITEM_ID),
    title: text(row.title, MAX_TITLE),
    price_usd: positive(row.price_usd),
    condition: row.condition === 'new_sealed' || row.condition === 'used_complete' ? row.condition : 'unknown',
    sold_date: text(row.sold_date, 10),
    rejection_reason: text(row.rejection_reason, MAX_REASON),
  }));
}

export function observationStatements(
  db: D1Database,
  input: {
    setNum: string;
    engine: 'firecrawl' | 'apify';
    observedAt: string;
    evidence: EbaySoldListingEvidence[];
    condition: Exclude<EbaySoldCondition, 'unknown'>;
    assessment: EbaySoldAssessment;
    reference: EbaySoldReference;
  },
): D1PreparedStatement[] {
  const rows = boundedEvidence(input.evidence).filter((row) => row.condition === input.condition || row.condition === 'unknown');
  // Keep an auditable attempt even when the provider returned no listing rows.
  const persisted = rows.length ? rows : [{
    source_url: null, item_id: null, title: null, price_usd: null,
    condition: input.condition, sold_date: null, rejection_reason: input.assessment.rejectionReason,
  } satisfies EbaySoldListingEvidence];
  return persisted.map((row) => db.prepare(`
    INSERT INTO ebay_sold_observations (
      set_num, engine, observed_at, condition, source_url, item_id, title, price_usd,
      sold_date, reference_value, reference_provenance, reference_freshness,
      decision, rejection_reason
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
  `).bind(
    input.setNum, input.engine, input.observedAt, row.condition,
    row.source_url, row.item_id, row.title, row.price_usd, row.sold_date,
    input.reference.value, input.reference.provenance, input.reference.freshness,
    input.assessment.decision, row.rejection_reason || input.assessment.rejectionReason,
  ));
}

export function pruneObservationStatement(db: D1Database): D1PreparedStatement {
  return db.prepare(`DELETE FROM ebay_sold_observations WHERE observed_at < datetime('now', '-180 days')`);
}
