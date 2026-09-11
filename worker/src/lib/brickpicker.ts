import type { PricingSignal } from './valuation-v3';

const BRICKPICKER_BATCH_URL = 'https://api.brickpicker.com/api/v1/catalog/batch';
const MAX_BATCH = 100;

interface RejectedRow {
  setNum: string | null;
  reason: 'variant' | 'duplicate' | 'unrequested' | 'malformed' | 'currency' | 'region' | 'calculated_at' | 'future_calculated_at' | 'no_values';
}

export interface BrickPickerSetResult {
  setNum: string;
  sourceItemId: string;
  title: string | null;
  calculatedAt: string;
  signals: PricingSignal[];
}

export interface BrickPickerBatchResult {
  results: BrickPickerSetResult[];
  misses: string[];
  rejected: RejectedRow[];
}

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function baseSetId(setNum: string): string | null {
  const match = /^(\d+)-1$/.exec(setNum.trim());
  return match?.[1] ?? null;
}

function boundedRange(value: unknown, low: unknown, high: unknown): { low: number | null; high: number | null } {
  const v = positive(value);
  const lo = positive(low);
  const hi = positive(high);
  if (v == null || lo == null || hi == null || lo > v || hi < v) return { low: null, high: null };
  return { low: lo, high: hi };
}

/**
 * Fetch modeled US/USD guide values. BrickPicker intentionally shares the
 * `ebay_market` family with eBay-derived guides; it is not an independent sold
 * data family and exposes no sales/sample counts.
 */
export async function fetchBrickPickerBatch(
  setNums: string[],
  apiKey: string,
  now = new Date(),
): Promise<BrickPickerBatchResult> {
  if (!apiKey.trim()) throw new Error('BRICKPICKER_API_KEY not set');
  if (setNums.length < 1 || setNums.length > MAX_BATCH) throw new Error(`BrickPicker batch must contain 1-${MAX_BATCH} sets`);

  const requested = new Map<string, string>();
  const rejected: RejectedRow[] = [];
  for (const setNum of setNums) {
    const base = baseSetId(setNum);
    if (!base) {
      rejected.push({ setNum, reason: 'variant' });
      continue;
    }
    if (requested.has(base)) {
      rejected.push({ setNum, reason: 'duplicate' });
      continue;
    }
    requested.set(base, setNum);
  }
  if (!requested.size) return { results: [], misses: [], rejected };

  const response = await fetch(BRICKPICKER_BATCH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sets: [...requested.keys()] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BrickPicker batch failed: ${response.status}`);
  const payload = await response.json() as { data?: { sets?: unknown } };
  const rows = payload?.data?.sets;
  if (!Array.isArray(rows)) throw new Error('BrickPicker batch malformed response');

  const byId = new Map<string, Record<string, unknown>[]>();
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') {
      rejected.push({ setNum: null, reason: 'malformed' });
      continue;
    }
    const row = raw as Record<string, unknown>;
    const id = typeof row.set_number === 'string' ? row.set_number.trim() : '';
    if (!id || !requested.has(id)) {
      rejected.push({ setNum: id || null, reason: 'unrequested' });
      continue;
    }
    const group = byId.get(id) ?? [];
    group.push(row);
    byId.set(id, group);
  }

  const results: BrickPickerSetResult[] = [];
  const misses: string[] = [];
  for (const [id, setNum] of requested) {
    const group = byId.get(id) ?? [];
    if (group.length > 1) {
      rejected.push({ setNum, reason: 'duplicate' });
      continue;
    }
    const row = group[0];
    if (!row || row.found === false) {
      misses.push(setNum);
      continue;
    }
    if (row.currency !== 'USD') {
      rejected.push({ setNum, reason: 'currency' });
      misses.push(setNum);
      continue;
    }
    if (row.market_region !== 'US') {
      rejected.push({ setNum, reason: 'region' });
      misses.push(setNum);
      continue;
    }
    const range = row.value_range;
    const calculatedAt = range && typeof range === 'object' && typeof (range as any).calculated_at === 'string'
      ? (range as any).calculated_at
      : '';
    const calculatedMs = Date.parse(calculatedAt);
    if (!calculatedAt || !Number.isFinite(calculatedMs)) {
      rejected.push({ setNum, reason: 'calculated_at' });
      continue;
    }
    if (calculatedMs > now.getTime() + 5 * 60_000) {
      rejected.push({ setNum, reason: 'future_calculated_at' });
      continue;
    }

    const newValue = positive(row.new_value_usd);
    const usedValue = positive(row.used_value_usd);
    if (newValue == null && usedValue == null) {
      rejected.push({ setNum, reason: 'no_values' });
      continue;
    }
    const rangeObj = range as Record<string, unknown>;
    const signals: PricingSignal[] = [];
    if (newValue != null) {
      const band = boundedRange(newValue, rangeObj.low, rangeObj.high);
      signals.push({
        source: 'brickpicker', provider_family: 'ebay_market', condition: 'new_sealed', signal_type: 'modeled',
        currency: 'USD', value: newValue, ...band, sample_count: null, sales_volume: null,
        source_observed_at: calculatedAt, checked_at: now.toISOString(), match_status: 'verified',
        flags: ['modeled_guide', 'correlated_ebay_family'],
      });
    }
    if (usedValue != null) {
      signals.push({
        source: 'brickpicker', provider_family: 'ebay_market', condition: 'used_complete', signal_type: 'modeled',
        currency: 'USD', value: usedValue, low: null, high: null, sample_count: null, sales_volume: null,
        source_observed_at: calculatedAt, checked_at: now.toISOString(), match_status: 'verified',
        flags: ['modeled_guide', 'correlated_ebay_family'],
      });
    }
    results.push({
      setNum,
      sourceItemId: id,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : null,
      calculatedAt,
      signals,
    });
  }
  return { results, misses, rejected };
}
